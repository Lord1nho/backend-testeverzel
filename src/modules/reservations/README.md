# Reservations

Reserva transacional de assentos pelo Cliente. Implementa UC10 (Reservar Ingresso) e UC11 (Selecionar Assento). A confirmação (pagamento aprovado -> `PAID` + emissão de `Ticket`) e a recusa (`PAYMENT_DECLINED`) ficam no módulo `payments` — ver [src/modules/payments/README.md](../payments/README.md).

A reserva nasce com `status: "PENDING_PAYMENT"` e os assentos selecionados vão de `AVAILABLE` para `RESERVED` (bloqueio temporário). A partir daí, três coisas podem acontecer com o bloqueio: pagamento aprovado (`payments`, assentos viram `SOLD`), pagamento recusado ou reserva expirada (`payments`, assentos voltam `AVAILABLE`), ou o Cliente cancela antes mesmo de tentar pagar (`POST /:id/cancel` abaixo, assentos voltam `AVAILABLE`).

**Autenticação:** todas as rotas exigem `authenticate` + `authorizeRole("CUSTOMER")`.

## `POST /api/reservations`

Cria uma reserva para um evento publicado, selecionando um ou mais assentos.

**Body:**

```json
{
  "eventId": "uuid",
  "seatIds": ["uuid-do-assento-1", "uuid-do-assento-2"]
}
```

`seatIds`: 1 a 10 assentos, sem duplicados.

**201 Created:**

```json
{
  "reservation": {
    "id": "uuid",
    "status": "PENDING_PAYMENT",
    "quantity": 2,
    "totalAmount": 71.0,
    "expiresAt": "2026-09-01T21:45:00.000Z",
    "createdAt": "...",
    "event": { "id": "uuid", "title": "Clube da Luta", "startsAt": "...", "venue": "CINE_VERZEL_1", "room": 3 },
    "seats": [{ "id": "uuid", "code": "A1" }, { "id": "uuid", "code": "A2" }],
    "tickets": []
  }
}
```

`totalAmount` é `event.price * quantity`, calculado no momento da reserva (congelado no registro, não recalculado depois se o organizador mudar o preço). `expiresAt` é o prazo do bloqueio (15 minutos) — checado de forma preguiçosa (lazy) pelo módulo `payments` no momento em que alguém tenta pagar (sem cron/job separado); este módulo em si não expira nada sozinho. `tickets` vem vazio aqui e só se popula (`[{ "id", "code", "status" }]`) depois que o pagamento é aprovado — ver `payments`.

## `GET /api/reservations/:id`

Detalhe de uma reserva do próprio Cliente autenticado. **404** se a reserva não existe ou pertence a outro cliente (nunca 403 por dono, mesma convenção de `events`).

**200 OK:** mesmo formato do `reservation` acima — reflete `status`/`tickets` atualizados depois de um pagamento.

## `POST /api/reservations/:id/cancel`

Cancela uma reserva **antes** de qualquer tentativa de pagamento, liberando os assentos de volta pra `AVAILABLE`. É o único jeito do Cliente desistir sem passar pelo checkout — sem essa rota, o assento só voltaria a ficar livre via recusa de pagamento ou expiração (ambos em `payments`).

**200 OK:** mesmo formato acima, com `status: "CANCELLED"`.

**400** se a reserva não estiver mais `PENDING_PAYMENT` (já paga, recusada, expirada ou já cancelada — mensagem: "Reserva nao pode ser cancelada nesse estado."). **404** se não existe ou pertence a outro cliente.

## Reserva segura (venda única de assento)

A checagem de disponibilidade acontece **dentro da mesma transação** que muda o status do assento (`AVAILABLE -> RESERVED`), nunca antes: `eventSeat.updateMany({ where: { id: { in: seatIds }, eventId, status: "AVAILABLE" }, data: { status: "RESERVED" } })`. Esse `UPDATE` condicional é atômico no Postgres — se outra reserva concorrente já pegou um dos assentos, o `count` retornado fica menor que `seatIds.length` e a transação lança erro e sofre rollback automático (nenhum assento fica preso em `RESERVED`, nenhuma reserva órfã é criada). Ver `reservations.repository.ts` (`createReservationWithSeats`) e a skill `reserva-segura`.

## Erros comuns

| Status | Quando |
| --- | --- |
| 400 | `seatIds` vazio/duplicado/inválido, `eventId` inválido, evento já começou/encerrou; ou (em `POST /:id/cancel`) reserva não está `PENDING_PAYMENT` |
| 401 | sem autenticação |
| 403 | autenticado mas não é `CUSTOMER` |
| 404 | evento não existe ou não está `PUBLISHED`; ou (em `GET /:id`/`POST /:id/cancel`) reserva não existe ou pertence a outro cliente |
| 409 | um ou mais assentos não estão mais `AVAILABLE` (perdeu a corrida para outra reserva) |

## Estrutura interna

`route -> controller -> service -> repository -> Prisma`:

- `reservations.schemas.ts` — validação Zod (`eventId` UUID, `seatIds` 1-10 UUIDs sem duplicados; `reservationIdParamSchema` reusado por `GET /:id` e `POST /:id/cancel`).
- `reservations.repository.ts` — único lugar que importa `prisma` neste módulo. `createReservationWithSeats` concentra a transação de criação (update condicional dos seats + create da `TicketReservation` + `ReservationItem`s). `cancelReservation` concentra a transação de cancelamento (recheck `status: "PENDING_PAYMENT"` dentro da transação, mesmo padrão de recheck da reserva-segura, + libera os seats). `findByIdAndCustomer` busca a reserva com `event`, `items.eventSeat` e `tickets` incluídos.
- `reservations.service.ts` — `createReservation` (valida evento via `eventsRepository.findPublishedEventForReservation`, do módulo `events`, calcula `expiresAt` e `totalAmount`), `getReservationById` e `cancelReservation`.
- `reservations.mappers.ts` — `toReservationDetail`, reusa `sortSeatsByCode` de `events.mappers.ts` pra devolver os assentos na ordem visual (`A1, A2, ..., B1, ...`), inclui os `tickets` (vazio até pagamento aprovado).
- `reservations.controller.ts` — 3 handlers finos.
