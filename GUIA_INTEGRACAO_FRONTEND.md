# Guia de Integração Frontend — Fluxo do Cliente

Este guia cobre a jornada completa do **Cliente** (ator) na Plataforma de Eventos e Ingressos: consultar eventos publicados, ver detalhes, escolher assentos, reservar, pagar (simulado), ver o ingresso e compartilhar por link. Corresponde a **UC7, UC9, UC10, UC11, UC12, UC13, UC14 e UC15** do [documento de casos de uso](planning-back-end/teste-verzel-casos-de-uso-textual-v1.md).

> **Fora do ar por enquanto:** só UC8 (busca/filtro), que ficou fora de escopo. Todo o resto do fluxo do Cliente, da navegação até o ingresso com QR, já está implementado. UC16-20 (portaria) também já existe (`POST /api/gate/validate`, ver [src/modules/gate/README.md](src/modules/gate/README.md)), mas é usado pelo app da portaria, não pelo app do Cliente que este guia cobre.

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

Usuários de teste (criados pelo seed, `npm run prisma:seed` — ver `README.md` raiz):

```
cliente1@demo.com / 123456   (role CUSTOMER, já com 1 ingresso pago)
cliente2@demo.com / 123456   (role CUSTOMER)
```

## Visão geral do fluxo

```
1. GET  /api/public/events                 -> lista de eventos publicados (cards)
2. GET  /api/public/events/:id              -> tela de detalhe do evento
3. GET  /api/public/events/:id/seats        -> mapa de assentos (pintar disponível/ocupado)
4. POST /api/auth/login                     -> se o cliente ainda não estiver logado
5. POST /api/reservations                   -> reserva os assentos escolhidos
   ├─ POST /api/reservations/:id/cancel     -> desistiu antes de pagar? libera os assentos
6. GET  /api/reservations/:id               -> tela de checkout / status da reserva
7. POST /api/payments                       -> paga a reserva (aprovado ou recusado)
8. GET  /api/tickets                        -> Meus Ingressos
9. GET  /api/tickets/:id                    -> tela do ingresso com QR
10. POST /api/tickets/:id/share             -> gera link pra compartilhar
    GET  /api/public/tickets/:token         -> quem recebe o link abre sem login
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
    ],
    "tickets": []
  }
}
```

Depois do `201`, os assentos escolhidos já saem do mapa como `RESERVED` (bloqueio temporário) — nenhum outro cliente consegue reservá-los enquanto essa reserva existir. `status` sempre volta `PENDING_PAYMENT`; a tela seguinte é o checkout (passo 7 — pagar). `tickets` vem vazio aqui e só se popula depois do pagamento aprovado.

`expiresAt` é a janela do bloqueio (15 minutos) — checada no momento em que o Cliente tenta pagar (passo 7), não por um timer em segundo plano. Se o Cliente demorar demais no checkout, o `POST /api/payments` retorna `400` (reserva expirada) e os assentos já voltam a aparecer como `AVAILABLE`; a tela deve tratar isso mandando o Cliente reservar de novo.

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

**200 OK:** mesmo formato do `reservation` do passo 5 — reflete `status`/`tickets` atualizados depois de um pagamento.

**404** se a reserva não existir **ou** pertencer a outro cliente (o backend nunca diferencia os dois casos, pra não vazar que um ID existe).

## 6.5. `POST /api/reservations/:id/cancel` — desistir antes de pagar

Requer login como o mesmo `CUSTOMER` dono da reserva. Usa quando o Cliente sai da tela de checkout sem pagar (botão "cancelar"/"voltar") — libera os assentos na hora, sem precisar esperar nada expirar.

```bash
curl -b cookiejar.txt -X POST http://localhost:3333/api/reservations/reservation-uuid/cancel
```

**200 OK:** mesmo formato do `reservation`, com `status: "CANCELLED"`. **400** se a reserva já não está `PENDING_PAYMENT` (já paga, recusada, expirada ou já cancelada). **404** mesma regra de dono do passo 6.

## 7. `POST /api/payments` — UC12 (Realizar Pagamento Simulado)

Requer login como `CUSTOMER`. **Não é uma transação financeira real.**

```bash
curl -b cookiejar.txt -s -X POST http://localhost:3333/api/payments \
  -H "Content-Type: application/json" \
  -d '{
    "reservationId": "reservation-uuid",
    "card": {
      "number": "4111111111111111",
      "holderName": "Fulano de Tal",
      "expiryMonth": 12,
      "expiryYear": 2030,
      "cvv": "123"
    }
  }'
```

### Regra de aprovação/recusa (pra testar os dois fluxos)

Número de cartão **terminado em `0000`** → sempre **recusado**. Qualquer outro número (formato válido: 13-19 dígitos) → sempre **aprovado**. Não há checagem real de cartão — é só essa convenção, pra dar controle determinístico no teste do checkout.

**200 OK (aprovado):**

```json
{
  "payment": { "id": "uuid", "status": "APPROVED", "amount": 71.0, "failureReason": null, "paidAt": "..." },
  "reservationStatus": "PAID",
  "tickets": [
    { "id": "ticket-uuid-1", "code": "A1B2C3D4", "status": "VALID" },
    { "id": "ticket-uuid-2", "code": "E5F6G7H8", "status": "VALID" }
  ]
}
```

**200 OK (recusado):**

```json
{
  "payment": { "id": "uuid", "status": "DECLINED", "amount": 71.0, "failureReason": "Cartao recusado pelo emissor (simulado).", "paidAt": null },
  "reservationStatus": "PAYMENT_DECLINED",
  "tickets": []
}
```

Se recusado, os assentos voltam pra `AVAILABLE` — o Cliente precisa reservar de novo (passo 5) pra tentar outra vez; **não dá pra reenviar pagamento na mesma reserva**. `tickets` aqui é só o resumo (`id`/`code`/`status`) — use `GET /api/tickets/:id` (passo 9) pra ver o QR de cada um.

### Erros

| Status | Quando | O que fazer na UI |
| --- | --- | --- |
| 400 | corpo inválido (cartão/validade/CVV mal formatados) | validação de formulário |
| 400 | reserva não está `PENDING_PAYMENT`, ou expirou | mandar reservar de novo |
| 401 | sem login | redirecionar pro login |
| 403 | logado, mas não é `CUSTOMER` | não deveria acontecer no app do cliente |
| 404 | reserva não existe ou pertence a outro cliente | recarregar |
| 409 | outra tentativa de pagamento na mesma reserva já processou primeiro | recarregar `GET /api/reservations/:id` pra ver o resultado real |

## 8. `GET /api/tickets` — UC13 (Visualizar Meus Ingressos)

Requer login como `CUSTOMER`. Lista os ingressos do Cliente, mais próximos primeiro.

```bash
curl -b cookiejar.txt http://localhost:3333/api/tickets
```

**200 OK:**

```json
{
  "tickets": [
    {
      "id": "ticket-uuid",
      "status": "VALID",
      "code": "A1B2C3D4",
      "issuedAt": "...",
      "usedAt": null,
      "event": { "id": "uuid", "title": "Clube da Luta", "startsAt": "...", "venue": "CINE_VERZEL_1", "room": 3 },
      "seat": { "id": "seat-uuid", "code": "A1" }
    }
  ]
}
```

## 9. `GET /api/tickets/:id` — UC14 (Visualizar Ingresso)

Requer login como o dono. **404** se não é do Cliente autenticado.

```bash
curl -b cookiejar.txt http://localhost:3333/api/tickets/ticket-uuid
```

**200 OK:** mesmo formato do item da lista, mais `"qrValue": "A1B2C3D4.9f2e...<64 chars hex>"`.

`qrValue` é a string a codificar num QR Code **no frontend** (o backend não gera imagem — ver `tickets/README.md` pra entender o formato `codigo.assinatura` e por que ele é recalculável a cada chamada, não um segredo que só existe uma vez).

## 10. Compartilhar ingresso (UC15)

**`POST /api/tickets/:id/share`** (autenticado, dono do ingresso):

```bash
curl -b cookiejar.txt -X POST http://localhost:3333/api/tickets/ticket-uuid/share
```

**201 Created:** `{ "shareLink": { "token": "aB3d...", "expiresAt": null } }` — o `token` só aparece **nesta resposta**; monte a URL de compartilhamento no frontend (ex: `https://seu-app.com/ingressos/compartilhado/<token>`) apontando pro passo seguinte.

**`GET /api/public/tickets/:token`** (sem autenticação — é a tela que quem recebe o link abre):

```bash
curl http://localhost:3333/api/public/tickets/aB3d...
```

**200 OK:** mesmo formato do passo 9 (inclui `qrValue`). **404** se o token não existe, foi revogado ou expirou.

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
| POST | `/api/reservations/:id/cancel` | `CUSTOMER` (dono) | UC10 (desistir antes de pagar) |
| POST | `/api/payments` | `CUSTOMER` | UC12 |
| GET | `/api/tickets` | `CUSTOMER` | UC13 |
| GET | `/api/tickets/:id` | `CUSTOMER` (dono) | UC14 |
| POST | `/api/tickets/:id/share` | `CUSTOMER` (dono) | UC15 |
| GET | `/api/public/tickets/:token` | nenhuma | UC15 (view compartilhada) |

Documentação completa de cada módulo (incluindo o lado do Organizador, que o app do cliente não usa): [src/modules/events/README.md](src/modules/events/README.md), [src/modules/reservations/README.md](src/modules/reservations/README.md), [src/modules/payments/README.md](src/modules/payments/README.md) e [src/modules/tickets/README.md](src/modules/tickets/README.md).

## Base URL de produção

Depois do deploy (ver seção "Deploy" do `README.md` raiz), a API roda no Render em `https://<seu-servico>.onrender.com/api` — troque a Base URL da seção 1 deste guia por essa URL no build de produção do frontend (variável de ambiente do projeto na Vercel). O plano free do Render "dorme" após inatividade: a primeira requisição depois de um tempo parado pode demorar alguns segundos a mais para responder (não é bug).

O cookie de sessão só atravessa domínios diferentes (frontend na Vercel, backend no Render) porque em produção ele sai com `sameSite: "none"` + `secure: true` (ver `src/modules/auth/auth.controller.ts`) — o frontend precisa mandar `credentials: "include"` (fetch) ou `withCredentials: true` (axios) em toda chamada, como já indicado na seção "Autenticação".
