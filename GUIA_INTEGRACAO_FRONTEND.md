# Guia de Integração Frontend — Fluxo do Cliente

Este guia cobre a jornada do **Cliente** (ator) na Plataforma de Eventos e Ingressos: consultar eventos publicados, ver detalhes, escolher assentos e reservar ingresso. Corresponde a **UC7, UC9, UC10 e UC11** do [documento de casos de uso](planning-back-end/teste-verzel-casos-de-uso-textual-v1.md).

> **Fora do ar por enquanto:** UC8 (busca/filtro), UC12 (pagamento simulado), UC13-15 (Meus Ingressos / QR Code / compartilhar) e UC16-20 (portaria). A reserva criada aqui fica em `PENDING_PAYMENT` — nenhum ticket é emitido ainda, porque o fluxo de pagamento é um módulo futuro.

## Base URL

```
http://localhost:3333/api
```

(porta configurável via `PORT` no `.env`; ver [README.md](README.md) para subir o projeto.)

## Autenticação

Só a etapa final (reservar) exige login. Navegar pelos eventos é público.

- Login: `POST /api/auth/login` com `{ email, password }` → devolve o usuário e entrega o token via **cookie httpOnly** (`access_token`). Não vem no corpo da resposta.
- O frontend deve mandar `credentials: "include"` (fetch) ou `withCredentials: true` (axios) em toda chamada, senão o navegador não envia o cookie.
- Alternativa sem cookie: header `Authorization: Bearer <token>` (o token não é exposto por essa rota de login — normalmente só é usado por scripts/Postman/curl, não pelo app web).
- Logout: `POST /api/auth/logout` limpa o cookie.
- Usuário atual: `GET /api/auth/me`.

Detalhes completos, atributos do cookie e exemplos de curl: [src/modules/auth/README.md](src/modules/auth/README.md).

Usuários de teste (seed ainda não implementado — criar manualmente por enquanto, ver `README.md` raiz):

```
cliente1@demo.com / 123456   (role CUSTOMER)
cliente2@demo.com / 123456   (role CUSTOMER)
```

## Visão geral do fluxo

```
1. GET  /api/public/events                 -> lista de eventos publicados (cards)
2. GET  /api/public/events/:id              -> tela de detalhe do evento
3. GET  /api/public/events/:id/seats        -> mapa de assentos (pintar disponível/ocupado)
4. POST /api/auth/login                     -> se o cliente ainda não estiver logado
5. POST /api/reservations                   -> reserva os assentos escolhidos
6. GET  /api/reservations/:id               -> tela de confirmação / status da reserva
```

Não existe carrinho: a seleção de assentos (UC11) acontece no cliente (frontend) enquanto o usuário navega pelo mapa de assentos, e é enviada de uma vez só no passo 5.

---

## 1. `GET /api/public/events` — UC7 (Consultar Eventos Publicados)

Sem autenticação. Sem paginação/busca nesta rodada (UC8 fica pra depois — trazer todos e filtrar/paginar no frontend se necessário).

```bash
curl http://localhost:3333/api/public/events
```

**200 OK:**

```json
{
  "events": [
    {
      "id": "0f5a...uuid",
      "title": "Clube da Luta",
      "startsAt": "2026-09-01T22:00:00.000Z",
      "venue": "CINE_VERZEL_1",
      "room": 3,
      "capacity": 40,
      "price": 35.5,
      "status": "PUBLISHED",
      "sessionStatus": "SCHEDULED",
      "sessionEndsAt": "2026-09-02T00:29:00.000Z",
      "seatsAvailable": 40,
      "catalogItem": { "id": "uuid", "title": "Clube da Luta", "imageUrl": "https://image.tmdb.org/t/p/w500/poster.jpg" },
      "createdAt": "..."
    }
  ]
}
```

Use `catalogItem.imageUrl` como poster do card. `seatsAvailable` já vem calculado (conta só assentos `AVAILABLE`) — dá pra mostrar "esgotado" quando for `0`, mas o backend não esconde o evento nesse caso (decisão de produto em aberto, ver `events/README.md`).

`sessionStatus` é derivado (`SCHEDULED` | `STARTED` | `ENDED`), útil pra desabilitar o botão de reservar em eventos já em cartaz/encerrados no frontend antes mesmo de tentar a reserva.

## 2. `GET /api/public/events/:id` — UC9 (Visualizar Detalhes do Evento)

Sem autenticação.

```bash
curl http://localhost:3333/api/public/events/0f5a...uuid
```

**200 OK:**

```json
{
  "event": {
    "id": "uuid",
    "title": "Clube da Luta",
    "startsAt": "2026-09-01T22:00:00.000Z",
    "venue": "CINE_VERZEL_1",
    "room": 3,
    "capacity": 40,
    "price": 35.5,
    "status": "PUBLISHED",
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

**404** se o `id` não existir **ou** o evento não estiver `PUBLISHED` (rascunho nunca aparece pro cliente — trate 404 aqui como "evento não encontrado", não precisa distinguir os dois casos na UI).

## 3. `GET /api/public/events/:id/seats` — mapa de assentos (apoio a UC9/UC11)

Sem autenticação. Retorna **todos** os assentos, com status, pra pintar o mapa (verde = disponível, cinza = ocupado):

```bash
curl http://localhost:3333/api/public/events/0f5a...uuid/seats
```

**200 OK:**

```json
{
  "seats": [
    { "id": "seat-uuid-1", "code": "A1", "status": "AVAILABLE" },
    { "id": "seat-uuid-2", "code": "A2", "status": "RESERVED" },
    { "id": "seat-uuid-3", "code": "A3", "status": "SOLD" }
  ]
}
```

Já vem ordenado visualmente (`A1, A2, ..., A10, B1, ...`). Só `status: "AVAILABLE"` pode ser selecionado pelo cliente; `RESERVED` (alguém reservando/pagando) e `SOLD` (venda concluída — ainda não alcançável nesta rodada, pois depende do módulo de pagamento) devem aparecer desabilitados.

`seat.id` é o valor que vai em `seatIds` no passo 5 — **não use `code`**.

Importante: **este endpoint não é a fonte de verdade no momento da reserva.** O backend sempre reconfere a disponibilidade dentro de uma transação no banco quando o `POST /api/reservations` chega — então mesmo que o mapa mostre "disponível", a reserva pode falhar com `409` se outro cliente reservou o mesmo assento um instante antes. Trate esse 409 recarregando o mapa de assentos.

## 4. Login (se necessário)

Ver seção Autenticação acima e [src/modules/auth/README.md](src/modules/auth/README.md). Só é obrigatório antes do passo 5.

## 5. `POST /api/reservations` — UC10 + UC11 (Reservar Ingresso / Selecionar Assento)

Requer login como `CUSTOMER` (cookie ou `Authorization: Bearer`).

```bash
curl -b cookiejar.txt -s -X POST http://localhost:3333/api/reservations \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "0f5a...uuid",
    "seatIds": ["seat-uuid-1", "seat-uuid-2"]
  }'
```

**Body:**

| Campo | Tipo | Regra |
| --- | --- | --- |
| `eventId` | uuid | evento precisa existir e estar `PUBLISHED` |
| `seatIds` | uuid[] | 1 a 10 assentos, sem duplicados, todos `AVAILABLE` nesse exato momento |

**201 Created:**

```json
{
  "reservation": {
    "id": "reservation-uuid",
    "status": "PENDING_PAYMENT",
    "quantity": 2,
    "totalAmount": 71.0,
    "expiresAt": "2026-09-01T21:45:00.000Z",
    "createdAt": "...",
    "event": {
      "id": "uuid",
      "title": "Clube da Luta",
      "startsAt": "2026-09-01T22:00:00.000Z",
      "venue": "CINE_VERZEL_1",
      "room": 3
    },
    "seats": [
      { "id": "seat-uuid-1", "code": "A1" },
      { "id": "seat-uuid-2", "code": "A2" }
    ]
  }
}
```

Depois do `201`, os assentos escolhidos já saem do mapa como `RESERVED` (bloqueio temporário) — nenhum outro cliente consegue reservá-los enquanto essa reserva existir. `status` sempre volta `PENDING_PAYMENT`: **não existe fluxo de pagamento ainda**, então a tela pós-reserva deve deixar isso explícito pro usuário (algo como "reserva confirmada, pagamento em breve") em vez de simular uma confirmação de compra.

`expiresAt` é só informativo (janela de 15 minutos) — o backend **não** expira/libera o assento automaticamente ainda (isso é responsabilidade do futuro módulo de pagamento). Não construa lógica de contagem regressiva que dependa do backend liberar o assento sozinho.

### Erros

| Status | Quando | O que fazer na UI |
| --- | --- | --- |
| 400 | `seatIds` vazio, duplicado, mais de 10, ou `eventId`/`seatId` mal formado | validação de formulário |
| 400 | evento já começou/encerrou | avisar e voltar pra listagem |
| 401 | sem login | redirecionar pro login |
| 403 | logado, mas não é `CUSTOMER` | não deveria acontecer no app do cliente |
| 404 | evento não existe ou não está `PUBLISHED` | recarregar detalhe/listagem |
| 409 | um ou mais assentos não estão mais disponíveis (perdeu a corrida pra outro cliente) | recarregar `GET /api/public/events/:id/seats` e pedir nova seleção |

## 6. `GET /api/reservations/:id` — conferir/retomar a reserva

Requer login como o mesmo `CUSTOMER` dono da reserva.

```bash
curl -b cookiejar.txt http://localhost:3333/api/reservations/reservation-uuid
```

**200 OK:** mesmo formato do `reservation` do passo 5.

**404** se a reserva não existir **ou** pertencer a outro cliente (o backend nunca diferencia os dois casos, pra não vazar que um ID existe).

---

## Referência rápida de endpoints

| Método | Rota | Autenticação | Caso de uso |
| --- | --- | --- | --- |
| GET | `/api/public/events` | nenhuma | UC7 |
| GET | `/api/public/events/:id` | nenhuma | UC9 |
| GET | `/api/public/events/:id/seats` | nenhuma | apoio a UC9/UC11 |
| POST | `/api/auth/login` | nenhuma | UC1 |
| POST | `/api/reservations` | `CUSTOMER` | UC10 + UC11 |
| GET | `/api/reservations/:id` | `CUSTOMER` (dono) | UC10 |

Documentação completa de cada módulo (incluindo o lado do Organizador, que o app do cliente não usa): [src/modules/events/README.md](src/modules/events/README.md) e [src/modules/reservations/README.md](src/modules/reservations/README.md).
