# Auth

Autenticacao (login) e consulta do usuario autenticado, via JWT entregue em cookie httpOnly (com fallback para header `Authorization: Bearer <token>`). Implementa UC1 - Autenticar-se.

Nao existe endpoint de cadastro/registro: os 3 papeis (`ORGANIZER`, `CUSTOMER`, `GATE`) sao criados via seed, nao por auto-registro.

## `POST /api/auth/login`

Autentica um usuario ja existente e entrega um token de acesso via cookie httpOnly.

**Autenticacao:** nenhuma.

**Body:**

```json
{
  "email": "cliente1@demo.com",
  "password": "123456"
}
```

**200 OK:**

```json
{
  "user": {
    "id": "bef3cf39-00ff-46a7-9840-d47622401954",
    "name": "Cliente Um",
    "email": "cliente1@demo.com",
    "role": "CUSTOMER",
    "createdAt": "2026-08-09T03:02:28.491Z"
  }
}
```

O token **nao vem no corpo da resposta** — ele e entregue automaticamente pelo header `Set-Cookie` num cookie chamado `access_token`, com `httpOnly`, `sameSite=Lax`, `secure` (true em producao) e `maxAge` de 1 dia (batendo com a expiracao do JWT). Por ser `httpOnly`, o JavaScript do frontend nao consegue ler nem manipular esse cookie diretamente — ele so anda junto automaticamente nas proximas requisicoes ao backend.

Alternativamente, rotas protegidas tambem aceitam `Authorization: Bearer <token>` — util para clientes que nao usam cookies (curl, Postman, apps mobile). Se ambos forem enviados, o **header tem prioridade** sobre o cookie.

**Erros:**

| Status | Quando | Body |
| --- | --- | --- |
| 400 | `email`/`password` ausentes ou `email` com formato invalido | `{ "message": "Erro de validacao.", "issues": [...] }` |
| 401 | e-mail nao cadastrado OU senha incorreta | `{ "message": "Credenciais invalidas." }` |

Nota de seguranca: as duas causas de 401 (e-mail inexistente vs senha errada) retornam a **mesma** mensagem generica, para nao permitir enumerar e-mails cadastrados.

### Por que o erro de formato de e-mail (400) as vezes aparece, as vezes nao

`email` é validado no schema (`auth.schemas.ts`) com `z.string().email()`, mais estrito que a validação nativa do navegador (`<input type="email">`). Isso é **comportamento esperado**, não uma inconsistência a corrigir:

- Na maioria dos casos, o próprio navegador já bloqueia o envio de um e-mail com formato claramente inválido antes da requisição sair — o usuário nunca chega a ver o 400 do backend.
- O 400 (`"Erro de validacao."`) só aparece pros casos raros que passam pela validação nativa do navegador (mais permissiva) mas não passam pela regex do Zod no backend — ex: alguns navegadores aceitam formatos que o `z.string().email()` rejeita.
- Esse 400 é semanticamente diferente do 401 (`"Credenciais invalidas."`): o 400 significa que a requisição nem chegou a comparar credenciais (formato inválido antes de tocar no banco); o 401 significa que o formato era válido mas o e-mail não existe ou a senha está errada. **Não devem ser unificados** — são dois erros de causas diferentes, e misturá-los esconderia informação útil pra depuração (ex: um typo grosseiro no domínio do e-mail vs uma senha esquecida).
- Cabe ao frontend decidir se quer tratar esse 400 como um caso à parte (ex: "formato de e-mail inválido") ou deixar cair no tratamento genérico de erro — o backend já valida o formato antes de tentar autenticar, então o frontend não precisa duplicar essa checagem pra funcionar corretamente.

## `POST /api/auth/logout`

Limpa o cookie `access_token`.

**Autenticacao:** nenhuma — funciona mesmo se o usuario ja nao estiver logado (cookie ausente/invalido), sempre retorna sucesso.

**200 OK:**

```json
{ "message": "Logout realizado com sucesso." }
```

Como o cookie e `httpOnly`, o frontend nao tem como apaga-lo sozinho via JavaScript (tipo `document.cookie = ...`) — essa rota existe justamente para isso: o backend manda um `Set-Cookie` com o mesmo nome/atributos e `maxAge` expirado, o navegador remove o cookie.

## `GET /api/auth/me`

Retorna os dados do usuario autenticado pelo token enviado.

**Autenticacao:** obrigatoria — cookie `access_token` OU header `Authorization: Bearer <token>`.

**200 OK:**

```json
{
  "user": {
    "id": "bef3cf39-00ff-46a7-9840-d47622401954",
    "name": "Cliente Um",
    "email": "cliente1@demo.com",
    "role": "CUSTOMER",
    "createdAt": "2026-08-09T03:02:28.491Z"
  }
}
```

**Erros:**

| Status | Quando | Body |
| --- | --- | --- |
| 401 | sem cookie `access_token` e sem header `Authorization` | `{ "message": "Token de autenticacao ausente." }` |
| 401 | token malformado, invalido ou expirado | `{ "message": "Token invalido ou expirado." }` |
| 401 | token valido mas o usuario nao existe mais no banco | `{ "message": "Usuario nao encontrado." }` |

## Exemplo (curl)

Via cookie (fluxo real do frontend):

```bash
curl -c cookiejar.txt -s -X POST http://localhost:3333/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"cliente1@demo.com","password":"123456"}'

curl -b cookiejar.txt http://localhost:3333/api/auth/me

curl -b cookiejar.txt -X POST http://localhost:3333/api/auth/logout
```

Via header (fallback, sem lidar com cookie jar):

```bash
curl http://localhost:3333/api/auth/me -H "Authorization: Bearer <token-obtido-de-outra-forma>"
```

## Nota para o frontend

O frontend deve mandar `credentials: "include"` (fetch) ou `withCredentials: true` (axios) em toda chamada pra API, senao o navegador nao envia o cookie. O backend so aceita isso de `FRONTEND_URL` (CORS com `credentials: true` e origin explicito, nao aberto).

## Estrutura interna

`route -> controller -> service -> repository -> Prisma`, seguindo o padrao do projeto (ver `CLAUDE.md` na raiz):

- `auth.schemas.ts` — validacao Zod do body de login.
- `auth.routes.ts` — `POST /login` (publica, validada), `POST /logout` (publica) e `GET /me` (protegida por `authenticate`).
- `auth.controller.ts` — le request, chama o service, seta/limpa o cookie `access_token`, monta a resposta HTTP.
- `auth.service.ts` — regra de negocio: comparar senha (`comparePassword`), gerar token (`signAccessToken`), decidir mensagens de erro. Agnostico de transporte (nao sabe de cookie/header, so retorna o token puro).
- `auth.repository.ts` — unica camada que acessa o Prisma (`findUserByEmail`, `findUserById`).
- `auth.mappers.ts` — `toPublicUser`, unico lugar que decide quais campos do `User` sao seguros expor (nunca `passwordHash`).
- `src/shared/security/token-service.ts` — fonte unica das constantes de transporte do token (`ACCESS_TOKEN_COOKIE_NAME`, `ACCESS_TOKEN_MAX_AGE_MS`), derivadas do mesmo TTL usado no `jwt.sign`, pra nunca dessincronizar.

## Correcoes relacionadas

- `src/shared/middlewares/authenticate.ts`: um token invalido/expirado fazia `jwt.verify` lancar um erro que nao era `AppError` nem `ZodError`, caindo no handler generico do `error-handler.ts` e retornando `500` em vez de `401`. Agora e capturado e convertido em `AppError("Token invalido ou expirado.", 401)`.
- `src/config/env.ts`: adicionado `NODE_ENV` (`development`/`test`/`production`, default `development`) — usado para decidir a flag `secure` do cookie (`true` so em producao, senao o cookie nao seria enviado em `http://localhost` durante o desenvolvimento).

## Testes

`tests/auth.test.ts` (vitest + supertest) cobre: login com sucesso (sem token no body, cookie httpOnly com os atributos corretos), senha errada, e-mail inexistente, validacao de body, logout (limpa o cookie e libera de novo, funciona mesmo deslogado), e `/me` via cookie, via header (fallback), e os casos de erro (ausente/invalido/expirado). Requer Postgres local no ar (`npm run db:up`) e migrations aplicadas (`npm run prisma:migrate`).
