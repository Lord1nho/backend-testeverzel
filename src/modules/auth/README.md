# Auth

Autenticacao (login) e consulta do usuario autenticado, via JWT (Bearer token). Implementa UC1 - Autenticar-se.

Nao existe endpoint de cadastro/registro: os 3 papeis (`ORGANIZER`, `CUSTOMER`, `GATE`) sao criados via seed, nao por auto-registro.

## `POST /api/auth/login`

Autentica um usuario ja existente e retorna um token de acesso.

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
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "bef3cf39-00ff-46a7-9840-d47622401954",
    "name": "Cliente Um",
    "email": "cliente1@demo.com",
    "role": "CUSTOMER",
    "createdAt": "2026-08-09T03:02:28.491Z"
  }
}
```

O token expira em 1 dia e deve ser enviado nas rotas protegidas como `Authorization: Bearer <token>`.

**Erros:**

| Status | Quando | Body |
| --- | --- | --- |
| 400 | `email`/`password` ausentes ou `email` com formato invalido | `{ "message": "Erro de validacao.", "issues": [...] }` |
| 401 | e-mail nao cadastrado OU senha incorreta | `{ "message": "Credenciais invalidas." }` |

Nota de seguranca: as duas causas de 401 (e-mail inexistente vs senha errada) retornam a **mesma** mensagem generica, para nao permitir enumerar e-mails cadastrados.

## `GET /api/auth/me`

Retorna os dados do usuario autenticado pelo token enviado.

**Autenticacao:** obrigatoria (`Authorization: Bearer <token>`).

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
| 401 | sem header `Authorization` | `{ "message": "Token de autenticacao ausente." }` |
| 401 | token malformado, invalido ou expirado | `{ "message": "Token invalido ou expirado." }` |
| 401 | token valido mas o usuario nao existe mais no banco | `{ "message": "Usuario nao encontrado." }` |

## Exemplo (curl)

```bash
TOKEN=$(curl -s -X POST http://localhost:3333/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"cliente1@demo.com","password":"123456"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl http://localhost:3333/api/auth/me -H "Authorization: Bearer $TOKEN"
```

## Estrutura interna

`route -> controller -> service -> repository -> Prisma`, seguindo o padrao do projeto (ver `CLAUDE.md` na raiz):

- `auth.schemas.ts` — validacao Zod do body de login.
- `auth.routes.ts` — `POST /login` (publica, validada) e `GET /me` (protegida por `authenticate`).
- `auth.controller.ts` — le request, chama o service, monta a resposta HTTP.
- `auth.service.ts` — regra de negocio: comparar senha (`comparePassword`), gerar token (`signAccessToken`), decidir mensagens de erro.
- `auth.repository.ts` — unica camada que acessa o Prisma (`findUserByEmail`, `findUserById`).
- `auth.mappers.ts` — `toPublicUser`, unico lugar que decide quais campos do `User` sao seguros expor (nunca `passwordHash`).

## Correcao relacionada

Durante a implementacao foi corrigido um bug em `src/shared/middlewares/authenticate.ts`: um token invalido/expirado fazia `jwt.verify` lancar um erro que nao era `AppError` nem `ZodError`, caindo no handler generico do `error-handler.ts` e retornando `500` em vez de `401`. Agora e capturado e convertido em `AppError("Token invalido ou expirado.", 401)`.

## Testes

`tests/auth.test.ts` (vitest + supertest) cobre: login com sucesso, senha errada, e-mail inexistente, validacao de body, e `/me` com token valido/ausente/invalido/expirado. Requer Postgres local no ar (`npm run db:up`) e migrations aplicadas (`npm run prisma:migrate`).
