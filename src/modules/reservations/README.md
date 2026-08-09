# Reservations

Reserva transacional de assentos pelo Cliente. Implementa UC10 (Reservar Ingresso) e UC11 (Selecionar Assento), **sem** a parte de pagamento/processamento (UC12 - Realizar Pagamento Simulado fica fora desta rodada, é um módulo futuro em `payments`). O projeto adotou mapa de assentos (não quantidade) — decisão já refletida na geração de `EventSeat` em `events`.

A reserva nasce com `status: "PENDING_PAYMENT"` e os assentos selecionados vão de `AVAILABLE` para `RESERVED` (bloqueio temporário). Confirmar a reserva como `PAID` (e emitir o `Ticket`), ou liberar os assentos de volta pra `AVAILABLE` em caso de recusa, são responsabilidade do futuro fluxo de pagamento — não implementados aqui.

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
    "seats": [{ "id": "uuid", "code": "A1" }, { "id": "uuid", "code": "A2" }]
  }
}
```

`totalAmount` é `event.price * quantity`, calculado no momento da reserva (congelado no registro, não recalculado depois se o organizador mudar o preço). `expiresAt` é só informativo (bloqueio de 15 minutos) — este módulo não roda nenhum processo de expiração automática; a liberação dos assentos de uma reserva expirada fica pro fluxo de pagamento.

## `GET /api/reservations/:id`

Detalhe de uma reserva do próprio Cliente autenticado. **404** se a reserva não existe ou pertence a outro cliente (nunca 403 por dono, mesma convenção de `events`).

**200 OK:** mesmo formato do `reservation` acima.

## Reserva segura (venda única de assento)

A checagem de disponibilidade acontece **dentro da mesma transação** que muda o status do assento (`AVAILABLE -> RESERVED`), nunca antes: `eventSeat.updateMany({ where: { id: { in: seatIds }, eventId, status: "AVAILABLE" }, data: { status: "RESERVED" } })`. Esse `UPDATE` condicional é atômico no Postgres — se outra reserva concorrente já pegou um dos assentos, o `count` retornado fica menor que `seatIds.length` e a transação lança erro e sofre rollback automático (nenhum assento fica preso em `RESERVED`, nenhuma reserva órfã é criada). Ver `reservations.repository.ts` (`createReservationWithSeats`) e a skill `reserva-segura`.

## Erros comuns

| Status | Quando |
| --- | --- |
| 400 | `seatIds` vazio/duplicado/inválido, `eventId` inválido, evento já começou/encerrou |
| 401 | sem autenticação |
| 403 | autenticado mas não é `CUSTOMER` |
| 404 | evento não existe ou não está `PUBLISHED`; ou (em `GET /:id`) reserva não existe ou pertence a outro cliente |
| 409 | um ou mais assentos não estão mais `AVAILABLE` (perdeu a corrida para outra reserva) |

## Estrutura interna

`route -> controller -> service -> repository -> Prisma`:

- `reservations.schemas.ts` — validação Zod (`eventId` UUID, `seatIds` 1-10 UUIDs sem duplicados).
- `reservations.repository.ts` — único lugar que importa `prisma` neste módulo. `createReservationWithSeats` concentra a transação (update condicional dos seats + create da `TicketReservation` + `ReservationItem`s). `findByIdAndCustomer` busca a reserva com `event` e `items.eventSeat` incluídos.
- `reservations.service.ts` — `createReservation` (valida evento via `eventsRepository.findPublishedEventForReservation`, do módulo `events`, calcula `expiresAt` e `totalAmount`) e `getReservationById`.
- `reservations.mappers.ts` — `toReservationDetail`, reusa `sortSeatsByCode` de `events.mappers.ts` pra devolver os assentos na ordem visual (`A1, A2, ..., B1, ...`).
- `reservations.controller.ts` — 2 handlers finos.
