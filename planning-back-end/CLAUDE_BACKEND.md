# CLAUDE.md Recomendado - Backend

Use este conteudo como base para o arquivo `CLAUDE.md` do repositorio backend.

```md
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
- vitest ou jest

## Arquitetura

Usar arquitetura modular em camadas:

```text
route -> controller -> service/use-case -> repository -> Prisma/Postgres
```

Estrutura sugerida:

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
- Service contem o caso de uso.
- Repository contem acesso ao banco.
- Validacao de entrada deve usar schema.
- Autorizacao por papel deve usar middleware.
- Reserva de assento deve usar transacao.

## Variaveis

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/verzel_events
JWT_SECRET=dev-secret-change-before-deploy
TMDB_API_TOKEN=your_tmdb_token
FRONTEND_URL=http://localhost:3000
PORT=3333
```

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
- Reservation
- ReservationItem
- Payment
- Ticket
- TicketShareLink
- TicketValidation

## Regras Criticas

### Reserva

- O mesmo assento nao pode ser vendido duas vezes.
- O backend e a fonte da verdade sobre disponibilidade.
- A selecao visual no frontend nao garante reserva.
- A compra deve revalidar o assento dentro de uma transacao.
- Pagamento aprovado gera ticket.
- Pagamento recusado nao gera ticket.
- Pagamento recusado libera o assento.

### Ticket

- Ticket deve ter codigo unico.
- QR Code deve representar codigo/token opaco.
- Nao colocar dados sensiveis dentro do QR.
- Validacao deve acontecer no backend.
- Ticket usado nao pode ser usado novamente.

### Portaria

Resultados obrigatorios:

- `VALID`: ticket existe, pertence ao evento certo e ainda nao foi usado.
- `INVALID`: codigo inexistente ou adulterado.
- `ALREADY_USED`: ticket ja usado.
- `WRONG_EVENT`: ticket existe, mas pertence a outro evento.

Toda tentativa de validacao deve ser registrada em `ticket_validations`.

### Eventos

- Evento publicado deve ter item externo, data, local, capacidade, preco e assentos.
- Organizador so gerencia seus proprios eventos.
- Evento passado nao deve ser editado.
- Evento com reservas/tickets pagos nao deve ser excluido no MVP.

## API Externa

Usar TMDb como catalogo externo.

Implementar:

- busca de filmes;
- filmes em cartaz, se util;
- snapshot local do item escolhido.

Chamadas reais ao TMDB via `TMDB_ACCESS_TOKEN`; sem fallback mockado — falha da API vira 502.

## Endpoints Sugeridos

Auth:

- `POST /auth/login`
- `GET /auth/me`

Catalogo:

- `GET /catalog/now-playing`
- `GET /catalog/search?query=<termo>`
- `GET /catalog/movies/:tmdbId`

> Detalhes de autenticacao (Bearer TMDB), parametros de cada endpoint e mapeamento de campos: ver `planning-back-end/teste-verzel-integracao-tmdb-v1.md`.

Eventos:

- `POST /events`
- `GET /events`
- `GET /events/:id`
- `GET /events/:id/seats`
- `PATCH /events/:id`
- `DELETE /events/:id`
- `POST /events/:id/publish`

Reservas:

- `POST /reservations`

Tickets:

- `GET /tickets/me`
- `GET /tickets/:code`
- `POST /tickets/:id/share-link`
- `GET /share/tickets/:token`

Portaria:

- `POST /gate/validate`
- `POST /gate/register-entry`

## Seed Obrigatorio

Criar seed com:

- organizador:
  - email: `organizer@demo.com`
  - senha: `123456`
- cliente 1:
  - email: `cliente1@demo.com`
  - senha: `123456`
- cliente 2:
  - email: `cliente2@demo.com`
  - senha: `123456`
- portaria:
  - email: `portaria@demo.com`
  - senha: `123456`
- pelo menos 1 evento publicado;
- mapa de assentos disponivel;
- opcional: 1 ticket ja emitido para teste rapido da portaria.

## Scripts Esperados

```json
{
  "dev": "rodar API em desenvolvimento",
  "build": "compilar TypeScript",
  "start": "rodar build em producao",
  "lint": "rodar lint",
  "test": "rodar testes",
  "prisma:migrate": "rodar migrations",
  "prisma:seed": "rodar seed"
}
```

## Testes Minimos

Priorizar testes de service:

- nao vender assento ja vendido;
- pagamento aprovado gera ticket;
- pagamento recusado libera assento;
- ticket valido retorna `VALID`;
- ticket ja usado retorna `ALREADY_USED`;
- codigo inexistente retorna `INVALID`;
- ticket de outro evento retorna `WRONG_EVENT`;
- role incorreta nao acessa rota protegida.

## README

O README do backend deve conter:

- requisitos;
- setup do Postgres local;
- `.env.example`;
- instalacao;
- migrations;
- seed;
- como rodar API;
- usuarios de teste;
- endpoints principais;
- decisoes de arquitetura;
- explicacao da reserva transacional;
- explicacao do pagamento fake;
- explicacao do QR/token;
- uso de IA;
- limitacoes conhecidas;
- caminho sugerido de deploy com Neon.

## Antes De Finalizar

Rodar:

```bash
npm run lint
npm run build
npm run test
```

Validar manualmente:

- seed cria usuarios e evento;
- login funciona para os tres papeis;
- reserva aprovada vende assento;
- reserva recusada libera assento;
- segundo cliente nao compra assento vendido;
- portaria valida ticket;
- portaria bloqueia segundo uso.
```

