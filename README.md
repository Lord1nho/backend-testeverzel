# Backend Teste Verzel

Backend da Plataforma de Eventos e Ingressos do teste tecnico Verzel.

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
```

Fluxo de camadas previsto:

```text
route -> controller -> service/use-case -> repository -> Prisma/Postgres
```

Esta etapa inicial cria apenas a fundacao do projeto. Os casos de uso ainda nao foram implementados.

## Setup

1. Instale dependencias:

```bash
npm install
```

2. Copie `.env.example` para `.env` e ajuste as variaveis.

3. Suba um Postgres local com o banco `verzel_events`:

```bash
npm run db:up
```

Isso sobe um container Docker (`docker-compose.yml`) com as mesmas credenciais do `.env.example`. Se preferir não usar Docker, suba um Postgres local manualmente com o mesmo usuario/senha/porta/nome de banco.

4. Gere o Prisma Client:

```bash
npm run prisma:generate
```

5. Rode migrations quando elas forem criadas:

```bash
npm run prisma:migrate
```

6. Rode a API:

```bash
npm run dev
```

## Scripts

- `npm run dev`: roda a API em desenvolvimento.
- `npm run build`: gera Prisma Client e compila TypeScript.
- `npm start`: roda o build em producao.
- `npm run lint`: roda ESLint.
- `npm test`: roda Vitest.
- `npm run prisma:migrate`: cria/aplica migrations em desenvolvimento.
- `npm run prisma:seed`: executa seed.
- `npm run db:up`: sobe o Postgres local via Docker Compose.
- `npm run db:down`: derruba o Postgres local.

## Variaveis

Consulte `.env.example`.

O token do TMDB deve ficar apenas no backend. Se `TMDB_ACCESS_TOKEN` nao existir ou a API falhar, a implementacao futura deve tratar erro claramente e pode usar fallback mockado documentado.

## Decisoes Iniciais

- O catalogo externo do MVP sera TMDB.
- O modelo inicial usa mapa de assentos, nao venda por quantidade.
- QR Code deve representar token/codigo opaco validado no backend.
- Reserva de assento deve ser implementada com transacao no service/use-case de reservas.
- Pagamento sera simulado ou sandbox, isolado em modulo de pagamentos.

## Usuarios de Teste Planejados

Seed futuro deve criar:

- `organizer@demo.com` / `123456`
- `cliente1@demo.com` / `123456`
- `cliente2@demo.com` / `123456`
- `portaria@demo.com` / `123456`

## Deploy do Banco de Dados (Futuro)

Caminho sugerido de deploy: [Neon](https://neon.tech) (Postgres serverless).

1. Criar conta/projeto no Neon e um database `verzel_events`.
2. O Neon oferece duas connection strings: pooled (via PgBouncer, para serverless/muitas conexoes curtas) e direct. Como este backend e um servidor Express de longa duracao com pool proprio (`pg.Pool` via `@prisma/adapter-pg`), usar a **direct connection string** como `DATABASE_URL`, evitando pooling duplicado.
3. Setar `DATABASE_URL` (com `sslmode=require`, exigido pelo Neon) como variavel de ambiente na plataforma de hospedagem da API.
4. Rodar migrations de producao com `npx prisma migrate deploy` (nao `migrate dev`, que e so para desenvolvimento local).
5. Rodar `npm run prisma:seed` uma vez apos o primeiro deploy, se aplicavel ao ambiente.
6. Gerar um `JWT_SECRET` novo e forte para producao — o valor atual (`dev-secret-change-before-deploy`) e so placeholder de desenvolvimento.

## Limitacoes Atuais

- Casos de uso ainda nao foram implementados por solicitacao de escopo.
- Ainda nao ha migrations criadas.
- O seed existe apenas como placeholder de inicializacao.
- Endpoints de dominio ainda serao adicionados nas proximas etapas.
