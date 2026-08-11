# Backend Teste Verzel

Backend da Plataforma de Eventos e Ingressos do teste tecnico Verzel — API REST em Express/TypeScript/Prisma/Postgres, cobrindo autenticacao por papel, criacao e publicacao de eventos, reserva transacional de assentos, pagamento simulado, emissao de ingressos com QR e validacao na portaria.

## Stack

- Node.js
- Express.js
- TypeScript
- Prisma
- Postgres
- JWT
- bcrypt
- zod
- vitest

## Estrutura

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
prisma/
  schema.prisma
  seed.ts
  migrations/
```

Fluxo de camadas em todos os modulos:

```text
route -> controller -> service/use-case -> repository -> Prisma/Postgres
```

| Modulo | O que faz | Papel | Doc |
| --- | --- | --- | --- |
| `auth` | Login (UC1) via JWT em cookie httpOnly (fallback `Authorization: Bearer`) | todos | [src/modules/auth/README.md](src/modules/auth/README.md) |
| `catalog` | Proxy de leitura pro TMDB (buscar/listar/detalhar filmes) pra usar como base de evento (UC3) | `ORGANIZER` | [src/modules/catalog/README.md](src/modules/catalog/README.md) |
| `events` | Criar/configurar/publicar/gerenciar evento (UC2, UC4-6) + navegacao publica de eventos publicados (UC7, UC9) | `ORGANIZER` + publico | [src/modules/events/README.md](src/modules/events/README.md) |
| `reservations` | Reserva transacional de assento com trava contra venda dupla (UC10, UC11) | `CUSTOMER` | [src/modules/reservations/README.md](src/modules/reservations/README.md) |
| `payments` | Pagamento simulado via cartao de teste; aprovado emite ticket, recusado libera assento (UC12) | `CUSTOMER` | [src/modules/payments/README.md](src/modules/payments/README.md) |
| `tickets` | Meus Ingressos, detalhe com QR recalculavel, compartilhamento por link (UC13-15) | `CUSTOMER` + link publico | [src/modules/tickets/README.md](src/modules/tickets/README.md) |
| `gate` | Validacao de ingresso na portaria (QR ou codigo manual), com os 4 resultados e bloqueio de reuso (UC16-20) | `GATE` | [src/modules/gate/README.md](src/modules/gate/README.md) |

UC8 (busca/filtro de eventos) fica fora de escopo por decisao consciente do time — ver os READMEs de `events`.

Guia completo do fluxo do Cliente (endpoint a endpoint, com exemplos de `curl`): [GUIA_INTEGRACAO_FRONTEND.md](GUIA_INTEGRACAO_FRONTEND.md).

## Setup local

1. Instale dependencias:

```bash
npm install
```

2. Copie `.env.example` para `.env` e ajuste as variaveis (`TICKET_QR_SECRET` e `JWT_SECRET` precisam de algum valor mesmo em dev — qualquer string serve localmente, so nao reuse o placeholder em producao).

3. Suba um Postgres local com o banco `verzel_events`:

```bash
npm run db:up
```

Isso sobe um container Docker (`docker-compose.yml`) com as mesmas credenciais do `.env.example`. Se preferir nao usar Docker, suba um Postgres local manualmente com o mesmo usuario/senha/porta/nome de banco.

4. Gere o Prisma Client:

```bash
npm run prisma:generate
```

5. Rode as migrations:

```bash
npm run prisma:migrate
```

6. Semeie os dados de teste (organizador, clientes, portaria, evento publicado com ingresso):

```bash
npm run prisma:seed
```

7. Rode a API:

```bash
npm run dev
```

## Usuarios semeados

`npm run prisma:seed` (`prisma/seed.ts`, idempotente — pode rodar de novo sem duplicar) cria:

| E-mail | Senha | Papel | Observacao |
| --- | --- | --- | --- |
| `organizer@demo.com` | `123456` | `ORGANIZER` | dono do evento semeado |
| `cliente1@demo.com` | `123456` | `CUSTOMER` | ja tem 1 ingresso pago (`PAID` + `Ticket VALID`) — testa "Meus Ingressos" e a portaria sem repetir o fluxo de compra |
| `cliente2@demo.com` | `123456` | `CUSTOMER` | sem ingressos, pra testar o fluxo de compra do zero |
| `portaria@demo.com` | `123456` | `GATE` | valida ingressos em `POST /api/gate/validate` |

Mais 1 evento `PUBLISHED` ("A Origem", TMDB id 27205, snapshot fixo — o seed nao chama o TMDB de verdade) com 30 assentos, majoritariamente `AVAILABLE`.

## Scripts

- `npm run dev`: roda a API em desenvolvimento.
- `npm run build`: gera Prisma Client e compila TypeScript.
- `npm start`: roda o build em producao.
- `npm run lint`: roda ESLint.
- `npm test`: roda Vitest (suite completa de integracao, com banco real).
- `npm run prisma:migrate`: cria/aplica migrations em desenvolvimento.
- `npm run prisma:seed`: executa o seed (idempotente).
- `npm run db:up` / `npm run db:down`: sobe/derruba o Postgres local via Docker Compose.

## Variaveis

Consulte `.env.example`. Resumo do que cada uma faz:

| Variavel | Uso |
| --- | --- |
| `DATABASE_URL` | connection string Postgres (`sslmode=require` em producao/Neon) |
| `JWT_SECRET` | assina o token de sessao (`auth`) |
| `TICKET_QR_SECRET` | assina o HMAC do QR do ingresso (`tickets`/`payments`/`gate`) — nunca reusar o placeholder de dev em producao |
| `TMDB_BASE_URL`, `TMDB_ACCESS_TOKEN`, `TMDB_LANGUAGE`, `TMDB_REGION` | integracao com o catalogo TMDB (`catalog`/`events`) — o token fica so no backend |
| `FRONTEND_URL` | origem permitida no CORS (precisa ser a URL exata do frontend em producao) |
| `PORT`, `NODE_ENV` | porta da API e ambiente (`NODE_ENV=production` liga `secure`/`sameSite: "none"` no cookie de sessao) |

## Deploy

Caminho usado neste projeto: **Neon** (Postgres) + **Render** (backend) + **Vercel** (frontend, fora deste repositorio).

### 1. Banco (Neon)

1. Criar conta/projeto no [Neon](https://neon.tech) e um database `verzel_events`.
2. O Neon oferece duas connection strings: pooled (via PgBouncer) e direct. Como este backend mantem pool proprio (`pg.Pool` via `@prisma/adapter-pg`), usar a **connection string direta** (nao a pooled) como `DATABASE_URL`, evitando pooling duplicado. `sslmode=require` (ja exigido pelo Neon).

### 2. API (Render)

Este repo tem um [`render.yaml`](render.yaml) (Blueprint) pronto na raiz — na dashboard do Render, escolha "New > Blueprint", conecte este repositorio no GitHub e clique em "Deploy Blueprint" em vez de configurar tudo manualmente.

- **Build:** `npm install && npx prisma migrate deploy && npm run build` (`migrate deploy`, nao `migrate dev` — so aplica migrations ja existentes, nao gera novas).
- **Start:** `npm start`.
- **Health check:** `/health`.
- **Env vars:** `DATABASE_URL` (Neon, direta), `JWT_SECRET`, `TICKET_QR_SECRET`, `TMDB_ACCESS_TOKEN`, `FRONTEND_URL` (URL de producao do frontend na Vercel) ficam marcadas `sync: false` no blueprint — preencha uma vez na dashboard do Render, nunca vao pro Git. `TMDB_BASE_URL`, `TMDB_LANGUAGE`, `TMDB_REGION` e `NODE_ENV=production` ja vem com valor no blueprint.

**Aviso:** o plano free do Render "dorme" apos um tempo de inatividade — o primeiro request depois de um tempo parado demora alguns segundos a mais pra acordar. Nao e bug, e uma limitacao conhecida do plano gratuito.

### 3. Seed em producao

Depois do primeiro deploy, rode o seed uma vez localmente apontando pro Neon (mais simples e controlavel que rodar dentro do Render):

```bash
DATABASE_URL="<connection-string-direta-do-neon>" npm run prisma:seed
```

(No PowerShell: `$env:DATABASE_URL="..."; npm run prisma:seed`.)

### 4. Frontend (Vercel, fora deste repositorio)

Aponte a variavel de ambiente da API do projeto Vercel para a URL de producao do backend no Render (`https://<seu-servico>.onrender.com/api`). Detalhes de integracao (autenticacao via cookie cross-site, endpoints, exemplos): [GUIA_INTEGRACAO_FRONTEND.md](GUIA_INTEGRACAO_FRONTEND.md#base-url-de-produção).

## Uso de IA neste projeto

Ver [USO_DE_IA.md](USO_DE_IA.md).
