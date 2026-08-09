# CLAUDE.md - Backend Plataforma de Eventos e Ingressos

## Objetivo

Este repositorio contem o backend da Plataforma de Eventos e Ingressos do teste tecnico Verzel.

O backend deve ser construido com Express.js, TypeScript, Prisma e Postgres. O foco e garantir regras de negocio corretas, principalmente reserva de assentos, pagamento simulado, emissao de tickets e validacao na portaria.

## Stack

- Express.js
- TypeScript
- Prisma
- Postgres
- JWT
- bcrypt
- zod
- vitest

## Arquitetura

Usar arquitetura modular em camadas:

```text
route -> controller -> service/use-case -> repository -> Prisma/Postgres
```

Estrutura:

```text
src/
  server.ts
  app.ts
  config/
  modules/
    auth/
    catalog/
    events/
    reservations/
    payments/
    tickets/
    gate/
  shared/
    errors/
    middlewares/
    prisma/
    security/
```

Regras:

- Controller nao contem regra de negocio.
- Service/use-case contem regra de negocio.
- Repository contem acesso ao banco.
- Validacao de entrada deve usar schema.
- Autorizacao por papel deve usar middleware.
- Reserva de assento deve usar transacao.

## Dominio

Papeis:

- `ORGANIZER`: cria e gerencia eventos.
- `CUSTOMER`: reserva, paga e recebe tickets.
- `GATE`: valida tickets.

Entidades principais:

- User
- ExternalCatalogItem
- Event
- EventSeat
- TicketReservation
- ReservationItem
- SimulatedPayment
- Ticket
- TicketShareLink
- GateValidation
