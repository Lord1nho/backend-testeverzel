# Guia de Integração Frontend — Fluxo da Portaria

Este guia cobre a jornada completa da **Portaria** (ator) na Plataforma de Eventos e Ingressos: validar o ingresso do cliente na entrada do evento, por QR (câmera) ou código digitado. Corresponde a **UC16, UC17, UC18, UC19 e UC20** do [documento de casos de uso](planning-back-end/teste-verzel-casos-de-uso-textual-v1.md).

> Outros papéis (Cliente, Organizador) têm guias próprios: [GUIA_INTEGRACAO_FRONTEND_CLIENTE.md](GUIA_INTEGRACAO_FRONTEND_CLIENTE.md) e [GUIA_INTEGRACAO_FRONTEND_ORGANIZADOR.md](GUIA_INTEGRACAO_FRONTEND_ORGANIZADOR.md).

## Base URL

```
http://localhost:3333/api
```

(porta configurável via `PORT` no `.env`; ver [README.md](README.md) para subir o projeto.)

## Autenticação

**Toda rota deste guia exige login como `GATE`** — não existe nada público no fluxo da portaria.

- Login: `POST /api/auth/login` com `{ email, password }` → devolve o usuário e entrega o token via **cookie httpOnly** (`access_token`). Não vem no corpo da resposta.
- O frontend deve mandar `credentials: "include"` (fetch) ou `withCredentials: true` (axios) em toda chamada, senão o navegador não envia o cookie.
- Alternativa sem cookie: header `Authorization: Bearer <token>`.
- Logout: `POST /api/auth/logout` limpa o cookie.

Detalhes completos: [src/modules/auth/README.md](src/modules/auth/README.md).

Usuário de teste (criado pelo seed, `npm run prisma:seed` — ver `README.md` raiz):

```
portaria@demo.com / 123456   (role GATE)
```

## Rotas públicas usadas neste fluxo (sem autenticação)

| Método | Rota |
| --- | --- |
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |

Nenhuma outra — as duas rotas de validação exigem login como `GATE`.

## Visão geral do fluxo

```
1. POST /api/auth/login                        -> login como GATE, no início do turno
2. GET  /api/gate/tickets/:code/event           -> (primeira leitura do turno) descobre a qual evento o código pertence
3. POST /api/gate/validate                      -> valida o ingresso (QR ou código manual), a cada leitura
```

A leitura do QR pela câmera (UC17) é responsabilidade do frontend (biblioteca de leitura de QR no navegador/app) — o backend só recebe o texto já lido. O texto do QR vem no formato `"<code>.<token>"`; separe pelo primeiro `.` antes de enviar (ver passo 3).

Entrada automática: validar como `VALID` já marca o ingresso como usado no mesmo request — **não existe uma segunda chamada pra "confirmar entrada"**.

---

## 1. Login

Ver seção Autenticação acima e [src/modules/auth/README.md](src/modules/auth/README.md).

## 2. `GET /api/gate/tickets/:code/event` — descobrir o evento automaticamente

Uso: a **primeira leitura de um turno**, sem contexto nenhum ainda sobre qual evento está sendo validado. Dado só o `code` (lido do QR ou digitado), devolve a qual evento aquele ingresso pertence, pra a tela auto-selecionar o evento em vez de pedir pra portaria escolher num dropdown manualmente.

```bash
curl -b cookiejar.txt http://localhost:3333/api/gate/tickets/A1B2C3D4/event
```

**200 OK:**

```json
{ "event": { "id": "uuid", "title": "Clube da Luta", "startsAt": "2026-09-01T22:00:00.000Z", "venue": "CINE_VERZEL_1", "room": 3 } }
```

**404** se o código não existe — `{ "message": "Ingresso não encontrado." }`.

**Importante:** este endpoint é **só leitura** — não verifica o QR/HMAC (não é uma validação de autenticidade, só "a qual evento esse código pertence") e **não conta como uma tentativa de validação** (não grava nada de auditoria, não marca nada como usado). A partir da segunda leitura em diante, a tela já tem o `eventId` resolvido e manda direto pro passo 3.

## 3. `POST /api/gate/validate` — UC16-20 (Validar Ingresso)

A rota principal — cada leitura (câmera ou manual) chama isso.

```bash
curl -b cookiejar.txt -s -X POST http://localhost:3333/api/gate/validate \
  -H "Content-Type: application/json" \
  -d '{ "eventId": "event-uuid", "code": "A1B2C3D4", "token": "9f2e...64-chars-hex" }'
```

**Body:**

| Campo | Tipo | Regra |
| --- | --- | --- |
| `eventId` | uuid | evento que a portaria está validando neste turno (resolvido no passo 2, ou escolhido manualmente na tela) |
| `code` | string | sempre obrigatório — o código curto do ingresso |
| `token` | string | **opcional.** Presente = leitura por câmera (UC17). Ausente = código digitado manualmente (UC18) |

O `qrValue` que sai do QR Code é `"<code>.<token>"` — separe as duas partes pelo primeiro `.` antes de montar o body:

```js
const [code, token] = qrValue.split(/\.(.*)/s, 2);
// ou: const separatorIndex = qrValue.indexOf("."); code = qrValue.slice(0, separatorIndex); token = qrValue.slice(separatorIndex + 1);
```

Se o operador digitar o código manualmente em vez de escanear, mande só `code`, sem `token`.

**200 OK — sempre** (os 4 resultados de UC19 são respostas válidas do domínio, não erros HTTP):

```json
{
  "result": "VALID",
  "ticket": {
    "id": "uuid",
    "code": "A1B2C3D4",
    "event": { "id": "uuid", "title": "Clube da Luta" },
    "seat": { "id": "uuid", "code": "A1" },
    "usedAt": "2026-09-01T21:58:00.000Z"
  },
  "reason": null
}
```

### Os 4 resultados (UC19)

| `result` | Quando | `ticket` na resposta | Sugestão de UI |
| --- | --- | --- | --- |
| `VALID` | Código existe, QR autêntico (se enviado), evento bate, dentro da janela de entrada, ainda não usado — acabou de ser marcado usado | detalhe completo (evento + assento + `usedAt`) | tela verde, "Entrada liberada", mostrar o assento |
| `WRONG_EVENT` | Ticket existe e é válido, mas é de outro evento | resumo básico (`id`, `code`, `event`) | tela amarela/vermelha, "Ingresso de outro evento", mostrar qual é o evento certo |
| `ALREADY_USED` | Ticket já estava usado (ou perdeu uma corrida de duas leituras simultâneas do mesmo código) | resumo básico | tela vermelha, "Ingresso já utilizado" |
| `INVALID` | Código não encontrado, QR não autêntico, ingresso cancelado, ou fora da janela de entrada da sessão | `null` (nunca vaza se o código existe ou não) | tela vermelha, usar `reason` pra dar o motivo específico |

`reason` (string ou `null`) sempre acompanha a resposta — é o motivo específico, útil principalmente pra diferenciar os vários casos de `INVALID`:

- `"Código não encontrado."`
- `"QR não autêntico."`
- `"Ingresso cancelado."`
- `"Ingresso é para outra data de sessão."`
- `"Entrada ainda não liberada. Aguarde até 20 minutos antes do início da sessão."`
- `"Sessão encerrada. Entrada não é mais permitida."`

### Janela de entrada da sessão

Além de checar identidade/estado do ingresso, a portaria só libera a entrada dentro de uma janela em torno do horário da sessão:

- **Mais de 20 minutos antes do início:** `INVALID` (a UI deve tratar isso mostrando quanto falta, se der pra calcular a partir do evento resolvido no passo 2).
- **De 20 minutos antes até o fim da sessão:** liberado normalmente — não há bloqueio por entrar depois do horário exato de início.
- **Depois do fim da sessão:** `INVALID`, "sessão encerrada".

### Erros HTTP (diferente dos 4 resultados de domínio, que sempre voltam 200)

| Status | Quando |
| --- | --- |
| 400 | corpo inválido (`eventId` não é uuid, `code` vazio) |
| 401 | sem login |
| 403 | logado, mas não é `GATE` |

---

## Referência rápida de endpoints

| Método | Rota | Autenticação | Caso de uso |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | **nenhuma (pública)** | UC1 |
| POST | `/api/auth/logout` | **nenhuma (pública)** | — |
| GET | `/api/gate/tickets/:code/event` | `GATE` | apoio a UC16 (descobrir o evento) |
| POST | `/api/gate/validate` | `GATE` | UC16-20 |

Documentação completa do módulo: [src/modules/gate/README.md](src/modules/gate/README.md).

## Base URL de produção

Depois do deploy (ver seção "Deploy" do `README.md` raiz), a API roda no Render em `https://<seu-servico>.onrender.com/api`. O plano free do Render "dorme" após inatividade: a primeira requisição depois de um tempo parado pode demorar alguns segundos a mais para responder (não é bug).

O cookie de sessão só atravessa domínios diferentes (frontend na Vercel, backend no Render) porque em produção ele sai com `sameSite: "none"` + `secure: true` — o frontend precisa mandar `credentials: "include"` (fetch) ou `withCredentials: true` (axios) em toda chamada.
