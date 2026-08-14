# Guia de Integração Frontend — Fluxo do Organizador

Este guia cobre a jornada completa do **Organizador** (ator) na Plataforma de Eventos e Ingressos: buscar um filme no catálogo externo (TMDB), montar um evento a partir dele, configurar, publicar e gerenciar. Corresponde a **UC2, UC3, UC4, UC5 e UC6** do [documento de casos de uso](planning-back-end/teste-verzel-casos-de-uso-textual-v1.md).

> Outros papéis (Cliente, Portaria) têm guias próprios: [GUIA_INTEGRACAO_FRONTEND_CLIENTE.md](GUIA_INTEGRACAO_FRONTEND_CLIENTE.md) e [GUIA_INTEGRACAO_FRONTEND_PORTARIA.md](GUIA_INTEGRACAO_FRONTEND_PORTARIA.md).

## Base URL

```
http://localhost:3333/api
```

(porta configurável via `PORT` no `.env`; ver [README.md](README.md) para subir o projeto.)

## Autenticação

**Toda rota deste guia exige login como `ORGANIZER`** — não existe nada público no fluxo do organizador.

- Login: `POST /api/auth/login` com `{ email, password }` → devolve o usuário e entrega o token via **cookie httpOnly** (`access_token`). Não vem no corpo da resposta.
- O frontend deve mandar `credentials: "include"` (fetch) ou `withCredentials: true` (axios) em toda chamada, senão o navegador não envia o cookie.
- Alternativa sem cookie: header `Authorization: Bearer <token>`.
- Logout: `POST /api/auth/logout` limpa o cookie.
- Usuário atual: `GET /api/auth/me`.

Detalhes completos: [src/modules/auth/README.md](src/modules/auth/README.md).

Usuário de teste (criado pelo seed, `npm run prisma:seed` — ver `README.md` raiz):

```
organizer@demo.com / 123456   (role ORGANIZER, já é dono do evento semeado)
```

## Rotas públicas usadas neste fluxo (sem autenticação)

| Método | Rota |
| --- | --- |
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |

Nenhuma outra — todo o resto (catálogo TMDB e gestão de eventos) exige login como `ORGANIZER`. O organizador não usa as rotas `/api/public/*` (essas são pra o Cliente navegar); ele usa `GET /api/events` para ver os próprios eventos, publicados ou não.

## Visão geral do fluxo

```
1. POST /api/auth/login                     -> login como ORGANIZER
2. GET  /api/catalog/now-playing             -> sugestões de filme em cartaz
   ou GET /api/catalog/search?query=...      -> busca por nome
3. GET  /api/catalog/movies/:tmdbId          -> detalhes do filme escolhido (gêneros, duração)
4. POST /api/events                          -> cria o evento (DRAFT) a partir do tmdbId
5. GET  /api/events                          -> lista "meus eventos" (painel do organizador)
   GET  /api/events/:id                      -> detalhe de um evento
   GET  /api/events/:id/seats                -> mapa de assentos do evento
6. PATCH /api/events/:id                     -> ajusta data/local/sala/capacidade/preço (enquanto DRAFT)
7. POST /api/events/:id/publish              -> DRAFT -> PUBLISHED (fica visível pro Cliente)
   DELETE /api/events/:id                    -> exclui o evento (se ainda não tem reserva paga)
```

Não existe edição de título — o nome do evento é sempre o título do filme vindo do TMDB, travado na criação (ver passo 4).

---

## 1. Login

Ver seção Autenticação acima e [src/modules/auth/README.md](src/modules/auth/README.md).

## 2. `GET /api/catalog/now-playing` — sugestões de filme em cartaz

Requer login como `ORGANIZER`. Lista filmes em cartaz (TMDB `movie/now_playing`), útil pra sugerir opções sem o organizador precisar digitar nada.

```bash
curl -b cookiejar.txt "http://localhost:3333/api/catalog/now-playing?page=1"
```

**Query:** `page` (opcional, inteiro positivo, default 1).

**200 OK:**

```json
{
  "page": 1,
  "totalPages": 42,
  "totalResults": 830,
  "results": [
    {
      "tmdbId": 550,
      "title": "Clube da Luta",
      "originalTitle": "Fight Club",
      "overview": "...",
      "posterUrl": "https://image.tmdb.org/t/p/w500/poster.jpg",
      "backdropUrl": null,
      "releaseDate": "1999-10-15",
      "voteAverage": 8.4,
      "popularity": 61.2,
      "genreIds": [18]
    }
  ]
}
```

## 2.5. `GET /api/catalog/search?query=<termo>` — busca por nome

Alternativa ao passo 2, quando o organizador já sabe o nome do filme.

```bash
curl -b cookiejar.txt "http://localhost:3333/api/catalog/search?query=matrix"
```

**Query:** `query` (obrigatório, string não vazia), `page` (opcional). **200 OK:** mesmo formato do `now-playing`.

## 3. `GET /api/catalog/movies/:tmdbId` — detalhes do filme escolhido

Usa quando o organizador confirma a escolha — a listagem/busca só devolve `genreIds` numéricos, não os nomes dos gêneros nem a duração (`runtime`).

```bash
curl -b cookiejar.txt http://localhost:3333/api/catalog/movies/550
```

**200 OK:**

```json
{
  "movie": {
    "tmdbId": 550,
    "title": "Clube da Luta",
    "originalTitle": "Fight Club",
    "overview": "...",
    "posterUrl": "https://image.tmdb.org/t/p/w500/poster.jpg",
    "backdropUrl": null,
    "releaseDate": "1999-10-15",
    "voteAverage": 8.4,
    "popularity": 61.2,
    "genres": [{ "id": 18, "name": "Drama" }],
    "runtime": 139,
    "tagline": "..."
  }
}
```

Este passo é opcional pro fluxo funcionar (o `POST /api/events` do passo 4 já busca os detalhes de novo no backend), mas é o que a tela de "confirmar filme antes de configurar o evento" normalmente usa pra mostrar gêneros/duração ao organizador antes de seguir.

### Erros do catálogo (passos 2, 2.5 e 3)

| Status | Quando |
| --- | --- |
| 400 | falta `query` na busca, ou `tmdbId` não numérico |
| 401 | sem login |
| 403 | logado, mas não é `ORGANIZER` |
| 404 | filme não encontrado no TMDB |
| 429 | rate limit do TMDB atingido |
| 502 | TMDB fora do ar, erro de rede, ou qualquer status inesperado |

## 4. `POST /api/events` — UC2 + UC3 (Criar Evento / Selecionar Item do Catálogo)

Cria o evento a partir do `tmdbId` escolhido. O backend busca os dados reais do filme no TMDB de novo (nunca confia em título/descrição vindos do frontend) e gera os assentos automaticamente.

```bash
curl -b cookiejar.txt -s -X POST http://localhost:3333/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "tmdbId": 550,
    "startsAt": "2026-09-01T22:00:00.000Z",
    "venue": "CINE_VERZEL_1",
    "room": 3,
    "capacity": 40,
    "price": 35.5
  }'
```

**Body:**

| Campo | Tipo | Regra |
| --- | --- | --- |
| `tmdbId` | number | id do filme no TMDB (do passo 2/2.5/3) |
| `startsAt` | ISO 8601 | precisa ser uma data futura |
| `venue` | `"CINE_VERZEL_1"` \| `"CINE_VERZEL_2"` | enum fixo, 2 cinemas |
| `room` | number | 1 a 4 |
| `capacity` | number | até 260 |
| `price` | number | preço do ingresso |

Não existe campo `title` — o nome do evento é sempre `movie.title` do TMDB, travado, não editável nem na criação nem depois.

**201 Created:** `{ "event": {...mesmo formato do GET /events/:id, ver passo 5...} }`, nasce com `status: "DRAFT"`.

### Erros

| Status | Quando |
| --- | --- |
| 400 | campo inválido, ou `startsAt` não é data futura |
| 401 | sem login |
| 403 | logado, mas não é `ORGANIZER` |
| 404/429/502 | erro do TMDB (mesma tabela do passo 3) |

## 5. Listar e ver detalhes — UC6 (Gerenciar Eventos)

**`GET /api/events`** — painel do organizador, lista só os eventos dele (`DRAFT` e `PUBLISHED`):

```bash
curl -b cookiejar.txt http://localhost:3333/api/events
```

**200 OK:** `{ "events": [{ "id", "title", "startsAt", "venue", "room", "capacity", "price", "status", "sessionStatus", "sessionEndsAt", "seatsAvailable", "catalogItem": { "id", "title", "imageUrl" }, "createdAt" }] }`

**`GET /api/events/:id`** — detalhe completo:

```bash
curl -b cookiejar.txt http://localhost:3333/api/events/event-uuid
```

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

**`GET /api/events/:id/seats`** — mapa de assentos do evento (útil pra ver quantos já foram vendidos):

```bash
curl -b cookiejar.txt http://localhost:3333/api/events/event-uuid/seats
```

**200 OK:** `{ "seats": [{ "id", "code", "status" }, ...] }` — `status` é `"AVAILABLE"` | `"RESERVED"` | `"SOLD"`.

**404** em qualquer uma dessas três se o evento não existe **ou pertence a outro organizador** (nunca 403 por dono, pra não vazar que um ID existe).

## 6. `PATCH /api/events/:id` — UC4 (Configurar Evento)

Edita `startsAt`, `venue`, `room`, `capacity`, `price` — todos opcionais, mas pelo menos um deve vir no body. **Não existe `title`.**

```bash
curl -b cookiejar.txt -X PATCH http://localhost:3333/api/events/event-uuid \
  -H "Content-Type: application/json" \
  -d '{ "price": 40.0, "capacity": 50 }'
```

**200 OK:** mesmo formato do `GET /events/:id`.

### Regras (importante pra desenhar a UI de edição)

- Evento com `startsAt` já passado não pode ser editado.
- `capacity` só muda enquanto o evento está `DRAFT` — mudar `capacity` apaga e regera todos os assentos. Depois de `PUBLISHED`, o campo fica travado na UI.
- `startsAt`, `venue`, `room` e `price` ficam travados assim que existir **alguma reserva paga** vinculada ao evento — a UI deve desabilitar esses campos (ou mostrar aviso) quando `seatsAvailable < seatsTotal` já sugerir que houve venda.
- Se o evento já é `PUBLISHED` e o PATCH muda `startsAt`/`venue`/`room`, o backend verifica conflito de horário contra outros eventos `PUBLISHED` na mesma sala (ver erro 409 abaixo).

### Erros

| Status | Quando |
| --- | --- |
| 400 | validação de campo; `capacity` alterada em evento `PUBLISHED`; `startsAt`/`venue`/`room`/`price` travados por reserva paga; `startsAt` já passou |
| 401 | sem login |
| 403 | logado, mas não é `ORGANIZER` |
| 404 | evento não existe ou pertence a outro organizador |
| 409 | conflito de horário: outra sessão `PUBLISHED` já ocupa a mesma sala no período |

## 7. `POST /api/events/:id/publish` — UC5 (Publicar Evento)

Transiciona `DRAFT -> PUBLISHED`. A partir daqui o evento aparece pro Cliente em `GET /api/public/events`.

```bash
curl -b cookiejar.txt -X POST http://localhost:3333/api/events/event-uuid/publish
```

**200 OK:** mesmo formato do `GET /events/:id`, com `status: "PUBLISHED"`.

### Erros

| Status | Quando |
| --- | --- |
| 400 | evento já publicado, cancelado, ou `startsAt` no passado |
| 401 | sem login |
| 403 | logado, mas não é `ORGANIZER` |
| 404 | evento não existe ou pertence a outro organizador |
| 409 | conflito de horário: outra sessão `PUBLISHED` já ocupa a mesma `venue`+`room` no período — mostrar a mensagem de erro, que já cita o título/horário do evento conflitante |

## 7.5. `DELETE /api/events/:id` — exclusão

Exclusão definitiva. Só permitida se `startsAt` ainda não passou e não existe nenhuma reserva paga vinculada ao evento.

```bash
curl -b cookiejar.txt -X DELETE http://localhost:3333/api/events/event-uuid
```

**204 No Content** (sem corpo).

### Erros

| Status | Quando |
| --- | --- |
| 400 | evento com `startsAt` já passado, ou com reserva paga vinculada |
| 401 | sem login |
| 403 | logado, mas não é `ORGANIZER` |
| 404 | evento não existe ou pertence a outro organizador |
| 409 | conflito de concorrência raro (um pagamento aprovou ou uma reserva nova entrou no exato momento da exclusão) — tentar de novo resolve |

---

## Referência rápida de endpoints

| Método | Rota | Autenticação | Caso de uso |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | **nenhuma (pública)** | UC1 |
| POST | `/api/auth/logout` | **nenhuma (pública)** | — |
| GET | `/api/catalog/now-playing` | `ORGANIZER` | apoio a UC3 |
| GET | `/api/catalog/search` | `ORGANIZER` | apoio a UC3 |
| GET | `/api/catalog/movies/:tmdbId` | `ORGANIZER` | UC3 |
| POST | `/api/events` | `ORGANIZER` | UC2 + UC3 |
| GET | `/api/events` | `ORGANIZER` (dono) | UC6 |
| GET | `/api/events/:id` | `ORGANIZER` (dono) | UC6 |
| GET | `/api/events/:id/seats` | `ORGANIZER` (dono) | UC6 |
| PATCH | `/api/events/:id` | `ORGANIZER` (dono) | UC4 |
| POST | `/api/events/:id/publish` | `ORGANIZER` (dono) | UC5 |
| DELETE | `/api/events/:id` | `ORGANIZER` (dono) | UC6 |

Documentação completa de cada módulo: [src/modules/catalog/README.md](src/modules/catalog/README.md) e [src/modules/events/README.md](src/modules/events/README.md).

## Base URL de produção

Depois do deploy (ver seção "Deploy" do `README.md` raiz), a API roda no Render em `https://<seu-servico>.onrender.com/api`. O plano free do Render "dorme" após inatividade: a primeira requisição depois de um tempo parado pode demorar alguns segundos a mais para responder (não é bug).

O cookie de sessão só atravessa domínios diferentes (frontend na Vercel, backend no Render) porque em produção ele sai com `sameSite: "none"` + `secure: true` — o frontend precisa mandar `credentials: "include"` (fetch) ou `withCredentials: true` (axios) em toda chamada.
