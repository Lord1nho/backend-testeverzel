# Payments

Pagamento simulado da reserva pelo Cliente. Implementa UC12 (Realizar Pagamento Simulado). **Não é uma transação financeira real** — o `PaymentProvider` simulado decide aprovado/recusado a partir de uma convenção de cartão de teste.

**Autenticação:** todas as rotas exigem `authenticate` + `authorizeRole("CUSTOMER")`.

## `POST /api/payments`

Processa o pagamento de uma reserva `PENDING_PAYMENT` do próprio Cliente autenticado.

**Body:**

```json
{
  "reservationId": "uuid",
  "card": {
    "number": "4111111111111111",
    "holderName": "Fulano de Tal",
    "expiryMonth": 12,
    "expiryYear": 2030,
    "cvv": "123"
  }
}
```

Validação é só de formato (`number`: 13-19 dígitos, `expiryMonth`: 1-12, `expiryYear`: ano atual em diante, `cvv`: 3-4 dígitos) — sem checagem real de cartão (Luhn, bandeira etc.), é inteiramente simulado.

### Cartão de teste (regra de aprovação/recusa)

`src/modules/payments/payments.provider.ts` (`simulatedPaymentProvider`): número de cartão **terminado em `0000`** é sempre recusado; qualquer outro número é aprovado. Convenção igual à de sandbox de gateway real (Stripe Test Mode, Mercado Pago) — permite o frontend testar os dois fluxos (aprovação e recusa) de forma determinística, sem depender de aleatoriedade.

**200 OK (aprovado):**

```json
{
  "payment": { "id": "uuid", "status": "APPROVED", "amount": 71.0, "failureReason": null, "paidAt": "..." },
  "reservationStatus": "PAID",
  "tickets": [
    { "id": "uuid", "code": "A1B2C3D4", "status": "VALID" },
    { "id": "uuid", "code": "E5F6G7H8", "status": "VALID" }
  ]
}
```

**200 OK (recusado, ainda com tentativa sobrando):**

```json
{
  "payment": { "id": "uuid", "status": "DECLINED", "amount": 71.0, "failureReason": "Cartão recusado pelo emissor (simulado).", "paidAt": null },
  "reservationStatus": "PENDING_PAYMENT",
  "tickets": [],
  "attempt": 1,
  "maxAttempts": 3
}
```

**200 OK (recusado, tentativas esgotadas — 3ª recusa):**

```json
{
  "payment": { "id": "uuid", "status": "DECLINED", "amount": 71.0, "failureReason": "Cartão recusado pelo emissor (simulado).", "paidAt": null },
  "reservationStatus": "PAYMENT_DECLINED",
  "tickets": [],
  "attempt": 3,
  "maxAttempts": 3
}
```

`attempt`/`maxAttempts` dão ao frontend o que falta pra decidir a tela: `reservationStatus: "PENDING_PAYMENT"` depois de uma recusa significa que ainda há tentativa sobrando (fica no checkout, deixa tentar de novo); `"PAYMENT_DECLINED"` significa esgotado (a reserva fechou, precisa reservar de novo pra tentar outra vez).

Pra ver o QR Code de cada ticket emitido, use `GET /api/tickets/:id` (módulo `tickets`) — o `code` aqui é só um resumo.

## Regra de negócio (skill `reserva-segura`)

Até **3 tentativas de pagamento por reserva** (decisão de produto — não é o padrão geral da skill `reserva-segura`, que manda liberar o assento assim que a recusa acontece; aqui é uma exceção deliberada e restrita: só a tentativa **final** libera). Dentro de uma única transação (`payments.repository.ts`, `processPayment`):

1. "Claim" da tentativa: `UPDATE` condicional na `TicketReservation` (`WHERE status = 'PENDING_PAYMENT' AND paymentAttempts < 3`, incrementando `paymentAttempts`) — recheck atômico que impede duas tentativas concorrentes de "roubarem" o mesmo número de tentativa, ou uma tentativa entrar depois que a reserva já foi resolvida por outra corrida (quem perde recebe **409**, nem chega a criar `SimulatedPayment`). Como esse claim já serializa o acesso (o lock de linha do Postgres dura até o fim da transação), nenhum outro passo abaixo precisa de recheck próprio.
2. Cria o `SimulatedPayment` (registra a tentativa, aprovada ou recusada — toda tentativa fica registrada, mesmo as intermediárias).
3. **Aprovado** (em qualquer tentativa, 1ª a 3ª): reserva `PAID`; assentos `RESERVED -> SOLD`; cria **um `Ticket` por assento** (não um por reserva — uma reserva com 2 assentos gera 2 tickets, cada um com seu próprio `eventSeatId`, `code` e QR).
4. **Recusado, tentativa 1 ou 2**: reserva continua `PENDING_PAYMENT`, assentos continuam `RESERVED` — o Cliente fica na mesma reserva/checkout e tenta de novo, sem perder o lugar.
5. **Recusado, tentativa 3 (final)**: reserva `PAYMENT_DECLINED`, assentos `RESERVED -> AVAILABLE` (libera o bloqueio — nenhum ticket é criado). A partir daqui a reserva está fechada — o Cliente precisa reservar de novo (`POST /api/reservations`) pra ter 3 tentativas novas.

Uma nova chamada em `POST /api/payments` com um `reservationId` já `PAID` ou `PAYMENT_DECLINED` (esgotado) sempre falha (400 ou 409, dependendo da corrida).

## Expiração preguiçosa (lazy) da reserva

A reserva nasce com `expiresAt` (bloqueio de 15 minutos, ver `reservations`), mas nada expira sozinho em segundo plano — não há cron/job. A checagem acontece aqui, no momento em que alguém tenta pagar: se `expiresAt` já passou, `payments.service.ts` chama `expireReservationIfPastDue` (mesmo padrão de `UPDATE` condicional + liberação de assentos, mas sem criar `SimulatedPayment` — nenhuma tentativa de pagamento de fato aconteceu) e responde **400**.

## Geração do ingresso (QR)

Cada `Ticket` aprovado recebe:

- `code`: código curto aleatório (`generateTicketCode()`, `src/shared/security/secure-token.ts`), texto puro, digitável na portaria.
- `qrTokenHash`: assinatura HMAC-SHA256 determinística do próprio `ticket.id` (`signTicketQr()`, `src/shared/security/ticket-qr.ts`), usando o segredo `TICKET_QR_SECRET`. Por ser determinística (não um segredo aleatório revelado só uma vez), o módulo `tickets` consegue recalcular o mesmo valor toda vez que o Cliente abre o ingresso — ver [src/modules/tickets/README.md](../tickets/README.md) pra detalhes de por que essa escolha foi necessária.

## Erros comuns

| Status | Quando |
| --- | --- |
| 400 | corpo inválido (cartão/validade/CVV mal formatados); reserva não está `PENDING_PAYMENT`; reserva expirada |
| 401 | sem autenticação |
| 403 | autenticado mas não é `CUSTOMER` |
| 404 | reserva não existe ou pertence a outro cliente |
| 409 | pagamento concorrente já processou a mesma reserva primeiro (corrida) |

## Estrutura interna

`route -> controller -> service -> repository -> Prisma`:

- `payments.provider.ts` — abstração `PaymentProvider` + `simulatedPaymentProvider` (regra do cartão terminado em `0000`).
- `payments.schemas.ts` — validação Zod do corpo (`reservationId` + `card`).
- `payments.repository.ts` — único lugar que importa `prisma` neste módulo. `processPayment` concentra a transação completa (claim da tentativa + pagamento + assentos + tickets), `MAX_PAYMENT_ATTEMPTS` (3) é a constante do limite. `expireReservationIfPastDue` concentra a transação de expiração preguiçosa.
- `payments.service.ts` — `payForReservation`: busca a reserva via `reservationsRepository.findByIdAndCustomer` (módulo `reservations`), valida estado/expiração, chama o provider e o repository.
- `payments.mappers.ts` — `toPaymentResult`.
- `payments.controller.ts` — 1 handler fino.

## Testes

`tests/payments.test.ts` cobre: aprovação (reserva `PAID`, assentos `SOLD`, um ticket por assento com o `eventSeatId` certo), 1ª recusa por cartão terminado em `0000` (reserva continua `PENDING_PAYMENT`, assento continua `RESERVED`, `attempt: 1`), aprovar numa tentativa posterior a uma recusa sem o assento nunca ter sido liberado no meio, esgotar as 3 tentativas (só a 3ª recusa fecha a reserva e libera o assento, reservável de novo por outro cliente), 4ª tentativa depois de esgotado (400), corrida de duas tentativas de pagamento simultâneas numa reserva nova (só uma vence, 409 na outra), corrida de duas recusas simultâneas disputando a tentativa final (só uma fecha a reserva, `paymentAttempts` fica em 3, nunca ultrapassa), reserva expirada (400, assentos liberados), 404 pra reserva de outro cliente/inexistente, validação de corpo, e 401/403 por papel.
