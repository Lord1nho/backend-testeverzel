# Tickets

Visualização e compartilhamento de ingressos pelo Cliente. Implementa UC13 (Visualizar Meus Ingressos), UC14 (Visualizar Ingresso) e UC15 (Compartilhar Ingresso por Link). A **emissão** do ingresso acontece no módulo `payments` (pagamento aprovado) — ver [src/modules/payments/README.md](../payments/README.md).

**Autenticação:** `GET /api/tickets`, `GET /api/tickets/:id` e `POST /api/tickets/:id/share` exigem `authenticate` + `authorizeRole("CUSTOMER")`, escopadas ao próprio Cliente. `GET /api/public/tickets/:token` (visualização compartilhada) **não exige autenticação** — é o ponto de entrada de UC15, feito pra ser aberto por qualquer pessoa que receba o link.

## `GET /api/tickets`

UC13. Lista os ingressos do Cliente autenticado, ordenados pelo evento mais próximo primeiro (`event.startsAt asc`).

**200 OK:**

```json
{
  "tickets": [
    {
      "id": "uuid",
      "status": "VALID",
      "code": "A1B2C3D4",
      "issuedAt": "...",
      "usedAt": null,
      "event": { "id": "uuid", "title": "Clube da Luta", "startsAt": "...", "venue": "CINE_VERZEL_1", "room": 3 },
      "seat": { "id": "uuid", "code": "A1" }
    }
  ]
}
```

## `GET /api/tickets/:id`

UC14. Detalhe de um ingresso do próprio Cliente, incluindo o QR. **404** se não existe ou pertence a outro cliente.

**200 OK:** mesmo formato do item acima, mais `"qrValue": "A1B2C3D4.9f2e...<64 hex>"`.

## `POST /api/tickets/:id/share`

UC15. Gera um link de compartilhamento pro ingresso. **404** se o ingresso não é do Cliente autenticado.

**201 Created:**

```json
{ "shareLink": { "token": "aB3d...", "expiresAt": null } }
```

O `token` só existe **nesta resposta** — o banco guarda só o hash (`TicketShareLink.tokenHash`), nunca o valor puro (mesmo padrão de `password_hash`). Se o Cliente perder o token, gera outro (cada chamada cria um novo link independente; não existe endpoint de revogação nesta rodada). Nasce sem expiração (`expiresAt: null`).

## `GET /api/public/tickets/:token`

UC15 (lado de quem recebe o link). Sem autenticação. Usa o `token` puro devolvido por `POST /:id/share`.

**200 OK:** mesmo formato de `GET /api/tickets/:id` (inclui `qrValue` — é o ponto de sharing, quem recebe o link precisa conseguir usar o ingresso). **404** se o token não existe, já foi revogado, ou expirou.

## Por que o QR é uma assinatura recalculável, não um segredo revelado uma vez

`Ticket.qrTokenHash` é escrito na emissão (`payments`), mas ao contrário de `TicketShareLink.tokenHash` (onde só existe um "revelar uma vez" aceitável), o QR precisa aparecer **toda vez** que o Cliente abre `GET /api/tickets/:id` — não só na hora da compra. Por isso o valor não é um segredo aleatório guardado só como hash (que seria irreversível): é uma **assinatura HMAC-SHA256 determinística** sobre o `ticket.id`, usando o segredo do servidor `TICKET_QR_SECRET` (`src/shared/security/ticket-qr.ts`, `signTicketQr`). Recalculável a qualquer momento a partir do `ticket.id`, e ainda assim não forjável por quem não tem `TICKET_QR_SECRET` — mesmo raciocínio de um JWT assinado, não de um hash de senha.

`qrValue` = `` `${code}.${hmac}` `` (`buildQrValue`). `code` (curto, `@unique`) permite achar o ingresso rápido; o HMAC garante autenticidade.

**Formato consumido pelo módulo `gate` (UC16-20, ver [src/modules/gate/README.md](../gate/README.md)):** ler o QR, separar `code` do HMAC, achar o `Ticket` pelo `code`, recalcular `signTicketQr(ticket.id)` e comparar com o HMAC lido — se bater, autêntico; se não, `INVALID`. Validação manual (`código digitado na portaria`) usa só o `code`.

## Erros comuns

| Status | Quando |
| --- | --- |
| 401 | sem autenticação (rotas autenticadas) |
| 403 | autenticado mas não é `CUSTOMER` |
| 404 | ingresso não existe/pertence a outro cliente; ou link de compartilhamento inválido/revogado/expirado |

## Estrutura interna

`route -> controller -> service -> repository -> Prisma`:

- `tickets.schemas.ts` — `ticketIdParamSchema` (uuid), `shareTokenParamSchema` (string não vazia).
- `tickets.repository.ts` — único lugar que importa `prisma` neste módulo. `findManyByCustomer`, `findByIdAndCustomer`, `createShareLink`, `findByShareTokenHash` (já filtra revogado/expirado, devolve `null` se inválido).
- `tickets.service.ts` — `listMyTickets`, `getTicketById`, `createShareLink` (gera token com `generateSecureToken()`/`hashToken()` de `shared/security/secure-token.ts`), `getSharedTicket`.
- `tickets.mappers.ts` — `toTicketSummary`, `toTicketDetail` (recalcula `qrValue` com `buildQrValue`), `toSharedTicketView`.
- `tickets.controller.ts` / `tickets.routes.ts` — 3 rotas autenticadas.
- `tickets.public.controller.ts` / `tickets.public.routes.ts` — 1 rota pública (`GET /:token`), mesmo padrão de `events.public.routes.ts`.

## Testes

`tests/tickets.test.ts` cobre o fluxo ponta a ponta (evento -> reserva -> pagamento aprovado -> `GET /api/tickets` lista -> `GET /api/tickets/:id` mostra `qrValue` e o assento certo), 404 pra ingresso de outro cliente, `POST /:id/share` + `GET /api/public/tickets/:token` funcionando sem autenticação, e token inexistente/inválido retornando 404. O cenário "ingresso usado não pode ser usado de novo" (skill `reserva-segura`) é coberto em `tests/gate.test.ts`, no módulo `gate` — é lá que a ação de "marcar como usado" acontece.
