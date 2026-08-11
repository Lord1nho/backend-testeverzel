# Gate

Validação de ingresso na portaria pelo usuário `GATE`. Implementa UC16 (Validar Ingresso), UC17 (leitura por câmera) e UC18 (código digitado) — a origem do dado é decisão do frontend, aqui ambos batem no mesmo endpoint, variando um campo do body —, UC19 (feedback dos 4 resultados) e UC20 (registro/bloqueio de reuso).

**Autenticação:** todas as rotas exigem `authenticate` + `authorizeRole("GATE")`.

## Decisão de escopo: entrada automática

Validar como `VALID` já marca o ingresso como `USED` no mesmo request — não existe uma segunda chamada de "confirmar entrada". Mais simples de operar na portaria (um único endpoint, um único scan) e uma das opções explicitamente aceitáveis para UC20.

## `POST /api/gate/validate`

**Body:**

```json
{ "eventId": "uuid", "code": "A1B2C3D4", "token": "hex-opcional" }
```

- `code`: sempre obrigatório — o `code` curto do `Ticket` (`@unique`, mesmo valor exibido em `GET /api/tickets/:id`).
- `token`: **presente** = leitura por câmera. O `qrValue` que o ticket expõe hoje é `"<code>.<token>"` (ver [tickets/README.md](../tickets/README.md)); o frontend separa as duas partes pelo primeiro `.` antes de enviar. **Ausente** = código digitado manualmente (UC18) — só o `code`.

**200 OK — sempre.** Os 4 resultados de UC19 são respostas válidas do domínio, não erros HTTP:

```json
{ "result": "VALID", "ticket": { "id": "uuid", "code": "A1B2C3D4", "event": { "id": "uuid", "title": "..." }, "seat": { "id": "uuid", "code": "A1" }, "usedAt": "2026-08-09T20:00:00.000Z" } }
```

`result` também pode ser:

| `result` | Quando | `ticket` na resposta |
| --- | --- | --- |
| `VALID` | Código existe, QR autêntico (se enviado), evento bate, ainda não usado — acabou de ser marcado `USED` | detalhe completo (evento + assento + `usedAt`) |
| `WRONG_EVENT` | Ticket existe e é válido, mas é de outro evento | resumo básico (`id`, `code`, `event`) — **sem** dados do dono (nome, e-mail, `customerId`) |
| `ALREADY_USED` | Ticket já estava `USED` (ou perdeu uma corrida concorrente pela mesma validação) | resumo básico, mesmo formato de `WRONG_EVENT` |
| `INVALID` | Código não encontrado, QR não autêntico (token não bate com o HMAC recalculado), ou ticket `CANCELLED` | `null` — não vaza se o código existe ou não |

## Lógica (skill `reserva-segura`: "nunca validar ticket apenas pelo frontend", "bloqueio de segundo uso na portaria")

`gate.service.ts` (`validateTicket`), nesta ordem:

1. Busca o `Ticket` por `code` (`@unique`). Não encontrado → `INVALID`.
2. Se veio `token`: recalcula `signTicketQr(ticket.id)` (`src/shared/security/ticket-qr.ts`) e compara — não bate → `INVALID` ("QR não autêntico"). Nunca confia no `token` enviado sem revalidar.
3. `ticket.eventId !== body.eventId` → `WRONG_EVENT`.
4. `ticket.status === "USED"` → `ALREADY_USED`.
5. `ticket.status === "CANCELLED"` → `INVALID`.
6. Senão (`status === "VALID"`): `gate.repository.ts` (`markUsedAndLog`) roda dentro de uma transação um `UPDATE` condicional (`WHERE id = ? AND status = 'VALID'`) para `USED` + `usedAt` — mesmo padrão de recheck-dentro-da-transação usado em `payments`/`reservations`. Se o `count` vier `0`, outra validação concorrente do mesmo ticket já venceu primeiro; o service trata como `ALREADY_USED` em vez de `VALID`.

Todo caminho grava uma linha em `GateValidation` (`ticketId` — `null` se o código nem foi encontrado —, `gateUserId`, `checkedEventId: body.eventId`, `inputMethod`: `QR_CAMERA` se veio `token`, senão `MANUAL_CODE`, `result`, `reason`), na mesma transação quando o caminho é `VALID`/corrida. É o histórico de auditoria da portaria.

## Erros comuns

| Status | Quando |
| --- | --- |
| 400 | corpo inválido (`eventId` não é uuid, `code` vazio) |
| 401 | sem autenticação |
| 403 | autenticado mas não é `GATE` |

## Estrutura interna

`route -> controller -> service -> repository -> Prisma`:

- `gate.schemas.ts` — validação Zod do corpo (`eventId`, `code`, `token` opcional).
- `gate.repository.ts` — único lugar que importa `prisma` neste módulo. `findTicketByCode`, `logValidation`, `markUsedAndLog` (a transação condicional + log).
- `gate.service.ts` — `validateTicket`, os 6 passos acima.
- `gate.mappers.ts` — `toValidationResponse`.
- `gate.controller.ts` — 1 handler fino.

## Testes

`tests/gate.test.ts` cobre: validação por QR válida marca `USED`; validar de novo o mesmo ingresso retorna `ALREADY_USED` (não `VALID` de novo); código manual (sem `token`) funciona; código inexistente → `INVALID` com `ticket: null`; `token` incorreto → `INVALID`; ingresso de outro evento → `WRONG_EVENT` (e o ticket continua `VALID` no banco); corrida de duas validações simultâneas do mesmo ingresso (só uma vira `VALID`, a outra `ALREADY_USED`); 401/403 pra quem não é `GATE`; corpo inválido.
