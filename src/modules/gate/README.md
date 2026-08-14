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
{ "result": "VALID", "ticket": { "id": "uuid", "code": "A1B2C3D4", "event": { "id": "uuid", "title": "..." }, "seat": { "id": "uuid", "code": "A1" }, "usedAt": "2026-08-09T20:00:00.000Z" }, "reason": null }
```

`reason` sempre acompanha a resposta (`null` em `VALID`, texto em todo o resto) — é o mesmo motivo gravado em `GateValidation`, exposto pra o frontend diferenciar cada caso de `INVALID` sem adivinhar.

`result` também pode ser:

| `result` | Quando | `ticket` na resposta |
| --- | --- | --- |
| `VALID` | Código existe, QR autêntico (se enviado), evento bate, ainda não usado, dentro da janela de entrada — acabou de ser marcado `USED` | detalhe completo (evento + assento + `usedAt`) |
| `WRONG_EVENT` | Ticket existe e é válido, mas é de outro evento | resumo básico (`id`, `code`, `event`) — **sem** dados do dono (nome, e-mail, `customerId`) |
| `ALREADY_USED` | Ticket já estava `USED` (ou perdeu uma corrida concorrente pela mesma validação) | resumo básico, mesmo formato de `WRONG_EVENT` |
| `INVALID` | Código não encontrado, QR não autêntico (token não bate com o HMAC recalculado), ticket `CANCELLED`, ou fora da janela de entrada da sessão (`reason` diferencia: data errada, cedo demais, sessão encerrada) | `null` — não vaza se o código existe ou não |

## Janela de entrada da sessão

Além de identidade/estado do ticket, a portaria só libera a entrada dentro de uma janela em torno do horário da sessão (`Event.startsAt` + duração do filme via `ExternalCatalogItem.durationMinutes`, mesma fórmula de `computeSessionStatus` em `events/events.mappers.ts`, reaproveitada aqui):

- **Antes de 20 minutos do início**: `INVALID`. Se `now` cai no mesmo dia-calendário (UTC) do `startsAt`, o motivo é "entrada ainda não liberada"; se é um dia diferente, é "ingresso é de outra data" — a distinção é só de texto, o bloqueio é o mesmo.
- **De 20 minutos antes até o fim da sessão**: entrada liberada normalmente, sem bloqueio por entrar depois do horário exato de início.
- **Depois do fim da sessão** (`sessionStatus === "ENDED"`): `INVALID`, motivo "sessão encerrada".

## Lógica (skill `reserva-segura`: "nunca validar ticket apenas pelo frontend", "bloqueio de segundo uso na portaria")

`gate.service.ts` (`validateTicket`), nesta ordem:

1. Busca o `Ticket` por `code` (`@unique`). Não encontrado → `INVALID`.
2. Se veio `token`: recalcula `signTicketQr(ticket.id)` (`src/shared/security/ticket-qr.ts`) e compara — não bate → `INVALID` ("QR não autêntico"). Nunca confia no `token` enviado sem revalidar.
3. `ticket.eventId !== body.eventId` → `WRONG_EVENT`.
4. `ticket.status === "USED"` → `ALREADY_USED`.
5. `ticket.status === "CANCELLED"` → `INVALID`.
6. Fora da janela de entrada da sessão (ver seção acima) → `INVALID`.
7. Senão (`status === "VALID"`, dentro da janela): `gate.repository.ts` (`markUsedAndLog`) roda dentro de uma transação um `UPDATE` condicional (`WHERE id = ? AND status = 'VALID'`) para `USED` + `usedAt` — mesmo padrão de recheck-dentro-da-transação usado em `payments`/`reservations`. Se o `count` vier `0`, outra validação concorrente do mesmo ticket já venceu primeiro; o service trata como `ALREADY_USED` em vez de `VALID`.

Todo caminho grava uma linha em `GateValidation` (`ticketId` — `null` se o código nem foi encontrado —, `gateUserId`, `checkedEventId: body.eventId`, `inputMethod`: `QR_CAMERA` se veio `token`, senão `MANUAL_CODE`, `result`, `reason`), na mesma transação quando o caminho é `VALID`/corrida. É o histórico de auditoria da portaria.

## Erros comuns (`POST /validate`)

| Status | Quando |
| --- | --- |
| 400 | corpo inválido (`eventId` não é uuid, `code` vazio) |
| 401 | sem autenticação |
| 403 | autenticado mas não é `GATE` |

## `GET /api/gate/tickets/:code/event` — descobrir o evento automaticamente

`eventId` continua **obrigatório** em `POST /validate` (é o que sustenta o resultado `WRONG_EVENT`) — mas isso normalmente implica a portaria escolher manualmente o evento numa tela antes de começar a validar. Este endpoint resolve isso sem mudar aquele contrato: dado só o `code` (a leitura inicial de um turno, sem contexto nenhum ainda), devolve a qual evento aquele ingresso pertence, pra o frontend auto-selecionar o evento na tela em vez de pedir pra portaria escolher num dropdown. A partir da segunda leitura em diante, o frontend já manda o `eventId` resolvido normalmente pro `/validate`, com `WRONG_EVENT` funcionando exatamente como antes.

**Só leitura** — não verifica o `token`/HMAC (não é uma validação de autenticidade, só "a qual evento esse código pertence") e **não grava** `GateValidation` (não é uma tentativa de validação, é uma consulta).

**200 OK:**

```json
{ "event": { "id": "uuid", "title": "...", "startsAt": "...", "venue": "CINE_VERZEL_1", "room": 3 } }
```

**404** se o código não existe — `{ "message": "Ingresso nao encontrado." }`. Nunca expõe dados do dono do ticket, só o evento (já visível no próprio ingresso físico/QR).

## Estrutura interna

`route -> controller -> service -> repository -> Prisma`:

- `gate.schemas.ts` — validação Zod do corpo de `/validate` (`eventId`, `code`, `token` opcional) e do param `code` de `GET /tickets/:code/event`.
- `gate.repository.ts` — único lugar que importa `prisma` neste módulo. `findTicketByCode` (usado por `validateTicket` e por `resolveTicketEvent`), `logValidation`, `markUsedAndLog` (a transação condicional + log).
- `gate.service.ts` — `validateTicket` (os 7 passos acima) e `resolveTicketEvent` (busca por `code`, 404 se não achar, devolve o evento).
- `gate.mappers.ts` — `toValidationResponse`, `toTicketEventSummary`.
- `gate.controller.ts` — 2 handlers finos.

## Testes

`tests/gate.test.ts` cobre, em `POST /validate`: validação por QR válida marca `USED`; validar de novo o mesmo ingresso retorna `ALREADY_USED` (não `VALID` de novo); código manual (sem `token`) funciona; código inexistente → `INVALID` com `ticket: null`; `token` incorreto → `INVALID`; ingresso de outro evento → `WRONG_EVENT` (e o ticket continua `VALID` no banco); corrida de duas validações simultâneas do mesmo ingresso (só uma vira `VALID`, a outra `ALREADY_USED`); 401/403 pra quem não é `GATE`; corpo inválido; e a janela de entrada da sessão: ingresso de sessão em outra data → `INVALID`; validar mais de 20min antes do início (mesmo dia) → `INVALID`; validar depois do fim da sessão → `INVALID`. Em `GET /tickets/:code/event`: resolve o evento certo sem marcar nada; 404 pra código inexistente; 401/403 por papel.
