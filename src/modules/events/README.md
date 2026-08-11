# Events

Criação, configuração, publicação e gerenciamento de eventos pelo Organizador, e navegação pública de eventos publicados pelo Cliente. Implementa UC2 (Criar Evento), o restante de UC3 (persistir o snapshot do item de catálogo — a busca em si é do módulo `catalog`), UC4 (Configurar Evento), UC5 (Publicar Evento), UC6 (Gerenciar Eventos), UC7 (Consultar Eventos Publicados) e UC9 (Visualizar Detalhes do Evento).

**Autenticação:** as rotas de gerenciamento (`/api/events/*`) exigem `authenticate` + `authorizeRole("ORGANIZER")` e só retornam os eventos do próprio organizador. As rotas públicas (`/api/public/events/*`, ator Cliente) não exigem autenticação — o caso de uso textual não lista "Cliente autenticado" como pré-condição de UC7/UC8/UC9 (só UC10 - Reservar Ingresso exige). UC8 (Buscar e Filtrar Eventos) fica fora desta rodada por decisão de escopo.

## `POST /api/events`

Cria um evento a partir de um filme do TMDB. O backend busca os dados reais do filme no TMDB (`catalogService.getMovieDetails`, nunca confia em título/descrição/duração vindos do request) e faz upsert em `ExternalCatalogItem` (incluindo a duração do filme, `durationMinutes`). Gera os assentos automaticamente (`capacity` linhas de 10: `A1..A10`, `B1..B10`, ...), todos `AVAILABLE`. Tudo numa única transação.

**Body:**

```json
{
  "tmdbId": 603,
  "startsAt": "2026-09-01T22:00:00.000Z",
  "venue": "CINE_VERZEL_1",
  "room": 3,
  "capacity": 40,
  "price": 35.5
}
```

Não existe campo `title` no body — de propósito. O nome do evento é **sempre** o título do filme retornado pelo TMDB (`movie.title`), travado no `createEvent` (`events.service.ts`). O organizador não escolhe/edita o nome do evento, nem na criação nem depois via `PATCH` (ver abaixo). `startsAt` precisa ser uma data futura. `venue` é `"CINE_VERZEL_1"` ou `"CINE_VERZEL_2"` (enum fixo — o projeto tem 2 cinemas, 4 salas cada, sem tabela de lookup por ser um dado fixo que não muda durante o teste). `room` é o número da sala, `1` a `4`. `capacity` até 260 (limite do esquema de código de assento).

**201 Created:** `{ "event": {...detalhe, ver abaixo...} }`

## `GET /api/events`

Lista os eventos do organizador autenticado (resumo, sem a lista de assentos).

**200 OK:** `{ "events": [{ "id", "title", "startsAt", "venue", "room", "capacity", "price", "status", "sessionStatus", "sessionEndsAt", "seatsAvailable", "catalogItem": { "id", "title", "imageUrl" }, "createdAt" }] }`

## `GET /api/events/:id`

Detalhe completo de um evento do organizador autenticado.

**200 OK:**

```json
{
  "event": {
    "id": "uuid",
    "organizerId": "uuid",
    "title": "Clube da Luta",
    "startsAt": "2026-09-01T22:00:00.000Z",
    "venue": "CINE_VERZEL_1",
    "room": 3,
    "capacity": 40,
    "price": 35.5,
    "status": "DRAFT",
    "sessionStatus": "SCHEDULED",
    "sessionEndsAt": "2026-09-02T00:29:00.000Z",
    "seatsTotal": 40,
    "seatsAvailable": 40,
    "catalogItem": {
      "id": "uuid",
      "provider": "TMDB",
      "externalId": "550",
      "type": "MOVIE",
      "title": "Clube da Luta",
      "imageUrl": "https://image.tmdb.org/t/p/w500/poster.jpg",
      "description": "...",
      "durationMinutes": 139
    },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

## `GET /api/events/:id/seats`

Lista os assentos do evento, ordenados por linha e número (`A1, A2, ..., A10, B1, ...`).

**200 OK:** `{ "seats": [{ "id", "code", "status" }, ...] }`

## `PATCH /api/events/:id`

Edita campos do evento: `startsAt`, `venue`, `room`, `capacity`, `price`. Todos opcionais, mas pelo menos um deve ser informado. **Não existe `title`** — nome do evento é travado no título do TMDB, não editável (ver `POST /api/events` acima).

**Regras:**
- Evento com `startsAt` já passado não pode ser editado (400).
- `capacity` só pode mudar enquanto o evento estiver `DRAFT` (400 se já `PUBLISHED`) — mudar `capacity` apaga e regera todos os assentos (seguro, pois `DRAFT` nunca teve venda).
- `startsAt`, `venue` e `room` ficam travados (400) se existir alguma `TicketReservation` com `status: "PAID"` vinculada ao evento — são os campos que representam o "contrato" com quem já pagou (quando e onde a sessão acontece). `price` continua livre mesmo com reserva paga: é seguro porque `TicketReservation.totalAmount` já congela o valor pago no momento da compra (campo próprio no schema, não recalculado a partir de `Event.price`).
- Se o evento **já está `PUBLISHED`** e o PATCH muda `startsAt`/`venue`/`room` (e não há reserva paga bloqueando primeiro), verifica **conflito de horário** contra outros eventos `PUBLISHED` na mesma `venue`+`room` (409 se colidir — ver seção abaixo). Evento ainda `DRAFT` nunca é checado aqui — rascunho é livre.

**200 OK:** mesmo formato de `GET /events/:id`.

## `POST /api/events/:id/publish`

Transiciona `DRAFT -> PUBLISHED`. Erros: evento já publicado, evento cancelado, `startsAt` no passado (todos 400), ou **conflito de horário** com outro evento `PUBLISHED` na mesma `venue`+`room` (409 — ver seção abaixo).

**200 OK:** mesmo formato de `GET /events/:id`, com `status: "PUBLISHED"`.

## Conflito de horário

Dois eventos **`PUBLISHED`** não podem ter janelas de sessão sobrepostas na mesma `venue`+`room`. A janela é a mesma fórmula de `sessionStatus` (`[startsAt, startsAt + duração + 10min)`, mesmo fallback de 120min). **Só evento `PUBLISHED` "ocupa" a sala** — `DRAFT` nunca bloqueia nem é bloqueado, então dois rascunhos podem coexistir livremente no mesmo horário/sala; o conflito só é detectado no momento em que um evento vira (ou continua) `PUBLISHED` naquele horário. A checagem é **global** (não depende de quem é o organizador) — fisicamente só pode haver uma sessão por vez na mesma sala.

Checado em: `POST /events/:id/publish` (sempre) e `PATCH /events/:id` (só se o evento já é `PUBLISHED` e o body muda `startsAt`/`venue`/`room`). Resposta de erro: `409`, mensagem cita o título e horário da sessão conflitante.

## `DELETE /api/events/:id`

Exclusão definitiva (hard delete). Bloqueada se `startsAt` já passou, ou se existe alguma `TicketReservation` com `status: "PAID"` vinculada ao evento (400). Se permitida, apaga os assentos e o evento numa transação (a FK de `event_seats` é `ON DELETE RESTRICT`, então os assentos precisam ser removidos primeiro).

**204 No Content** (sem corpo).

## Rotas públicas (ator Cliente)

Sem autenticação. Mesmos mappers/formato de resposta das rotas do Organizador (`toEventSummary`/`toEventDetail`/`toEventSeat`), mas filtradas por `status: "PUBLISHED"` e sem checagem de dono (qualquer evento publicado, de qualquer organizador).

### `GET /api/public/events`

UC7 - Consultar Eventos Publicados. Lista todos os eventos `PUBLISHED`, ordenados por `startsAt`.

**200 OK:** `{ "events": [...mesmo formato de GET /api/events...] }`

### `GET /api/public/events/:id`

UC9 - Visualizar Detalhes do Evento. Detalhe de um evento publicado.

**200 OK:** mesmo formato de `GET /api/events/:id`. **404** se o evento não existe ou não está `PUBLISHED` (rascunho não deve vazar pro Cliente).

### `GET /api/public/events/:id/seats`

Mapa de assentos do evento publicado (suporte visual a UC9/UC11 — o Cliente vê quais assentos estão disponíveis antes de reservar). **404** se o evento não existe ou não está `PUBLISHED`.

**200 OK:** `{ "seats": [{ "id", "code", "status" }, ...] }`

## Status de sessão (derivado)

`sessionStatus` e `sessionEndsAt` **não são armazenados** — são calculados a cada resposta a partir de `startsAt` + a duração do filme (`catalogItem.durationMinutes`) + **10 minutos fixos** (simulando o tempo de trailers antes do filme começar de fato):

- `SCHEDULED` — agora ainda não chegou em `startsAt`.
- `STARTED` — `startsAt <= agora < sessionEndsAt`.
- `ENDED` — agora já passou de `sessionEndsAt`.

Se a TMDB não informar duração pro filme (`durationMinutes` fica `null`/`0` em alguns títulos), o cálculo usa um fallback de **120 minutos** — só pro cálculo, nunca gravado no banco (`catalogItem.durationMinutes` continua `null` na resposta, é só o `sessionStatus`/`sessionEndsAt` que usam o fallback). Função: `computeSessionStatus` em `events.mappers.ts`.

## Erros comuns

| Status | Quando |
| --- | --- |
| 400 | validação de campo, regra de negócio (capacidade em evento publicado, data/venue/sala travados por reserva paga, data passada, evento já publicado) |
| 401 | sem autenticação |
| 403 | autenticado mas não é `ORGANIZER` |
| 404 | evento não existe **ou pertence a outro organizador** (nunca 403 por dono — evita vazar que um ID existe) |
| 404/429/502 | erro do TMDB propagado por `catalogService.getMovieDetails` (só em `POST /events`) |
| 409 | conflito de horário: outra sessão `PUBLISHED` já ocupa a mesma `venue`+`room` no período (`POST /publish` ou `PATCH` de evento já `PUBLISHED`) |

## Estrutura interna

`route -> controller -> service -> repository -> Prisma`:

- `events.schemas.ts` — validação Zod (`venue` via `z.nativeEnum(Venue)`, `room` 1-4). Regras que dependem do estado atual do evento no banco ("capacidade só em DRAFT", "campos travados com reserva paga") não dá pra expressar aqui, ficam no service.
- `events.repository.ts` — único lugar que importa `prisma`. Concentra as transações: criação (upsert do `ExternalCatalogItem`, incluindo `durationMinutes`, + create do `Event` + `createMany` dos `EventSeat`), regeneração de assentos ao mudar capacidade, e exclusão (apaga `EventSeat`s antes do `Event`, por causa do `ON DELETE RESTRICT`). `findPublishedEventsInVenueRoom` busca os candidatos a conflito de horário (índice `@@index([venue, room, status])` em `Event` pra essa query).
- `events.service.ts` — os 7 casos de uso, `generateSeatCodes(capacity)` (linhas de 10), `findOwnedEventOrThrow` (checagem de dono, reusada por get/update/publish/delete/seats), e `assertNoScheduleConflict` (checagem de conflito de horário, chamada por `publishEvent` sempre e por `updateEvent` quando o evento já é `PUBLISHED`).
- `events.mappers.ts` — `toEventSummary`/`toEventDetail`/`toEventSeat` + `sortSeatsByCode` (ordena `A10` depois de `A9`, não como string) + `computeSessionStatus`.
- `events.controller.ts` — 7 handlers finos (Organizador).
- `events.public.routes.ts` / `events.public.controller.ts` — 3 rotas públicas (Cliente), sem autenticação. Handlers finos que chamam `listPublishedEvents`/`getPublishedEventById`/`getPublishedEventSeats` em `events.service.ts`, que por sua vez usam `findManyPublished`/`findPublishedById`/`findPublishedRawById` em `events.repository.ts` (sempre filtrando `status: "PUBLISHED"`). `findPublishedEventForReservation` também mora em `events.repository.ts` e é consumida pelo módulo `reservations` (UC10) pra validar o evento sem puxar a lista de seats inteira.

## Convenção: `EventSeat.status`

No schema Prisma, `EventSeat.status` é `varchar` livre (não enum). Convenção adotada: `"AVAILABLE"` | `"RESERVED"` | `"SOLD"`. Assentos nascem `"AVAILABLE"` na criação do evento (não na publicação) — futuro módulo `reservations` é quem transiciona pra `RESERVED`/`SOLD`.

## Testes

`tests/events.test.ts` usa Postgres real (mesmo padrão de `tests/auth.test.ts`) — testa a escrita de verdade (transações, upsert, geração de assentos). Só a chamada externa ao TMDB é mockada (`fetchMovieDetails` de `catalog.tmdb-client.ts`, mesmo ponto que `catalog.test.ts` já mocka), pra não depender de rede/token nos testes automatizados. Cobre: criação com geração correta de assentos, reuso do `catalogItem` em criações repetidas, título sempre travado no do TMDB (ignora qualquer `title` enviado no body), validações (`venue`/`room`/`capacity`/`startsAt`), erro do TMDB propagado, isolamento por organizador (404 pra quem não é dono), regeneração de assentos ao mudar capacidade em `DRAFT`, bloqueio de mudança de capacidade após publicar, bloqueio de edição/publicação/exclusão com data passada, publicar duas vezes, exclusão com reserva paga vinculada, exclusão normal sem erro de FK, trava de `startsAt`/`venue`/`room` com reserva paga (e liberação de `price`), `sessionStatus` nos 3 estados (`SCHEDULED`/`STARTED`/`ENDED`), o fallback de 120min, e o conflito de horário (dois `DRAFT` coexistindo sem erro, publicar contra outro `PUBLISHED` colidente → 409, sala/venue diferente ou fora da janela → sem erro, `PATCH` de evento `PUBLISHED` pra horário colidente → 409, `PATCH` de `DRAFT` pra horário colidente → sem erro, `PATCH` que não toca campos de agenda nunca dispara a checagem).

Nota de isolamento de teste: como o conflito de horário é checado **globalmente** (sem filtro de organizador — fisicamente só uma sessão por vez na mesma sala), o helper `createTestEvent` usa um `startsAt` padrão único por chamada (contador incremental bem no futuro) pra eventos publicados por testes diferentes nunca colidirem sem querer entre si. Os testes de conflito passam `startsAt`/`venue`/`room` explícitos, cada cenário com um dia bem separado dos outros.
