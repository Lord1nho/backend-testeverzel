# Catalog

Proxy de leitura pro TMDB (The Movie Database) — deixa o Organizador buscar/listar/detalhar filmes pra usar como base de um evento. Implementa UC3 - Selecionar Item do Catalogo Externo.

**Esse modulo nao persiste nada no banco.** Salvar o snapshot do filme escolhido em `ExternalCatalogItem` e vincular a um `Event` e responsabilidade do modulo `events` (ver [src/modules/events/README.md](../events/README.md)) — aqui e so consulta.

**Autenticacao:** todas as rotas exigem `authenticate` + `authorizeRole("ORGANIZER")` — e ferramenta exclusiva do fluxo de criacao de evento, nenhum outro papel usa isso.

## `GET /api/catalog/now-playing`

Lista os filmes em cartaz (TMDB `movie/now_playing`).

**Query:** `page` (opcional, inteiro positivo, default 1 no TMDB).

**200 OK:**

```json
{
  "page": 1,
  "totalPages": 42,
  "totalResults": 830,
  "results": [
    {
      "tmdbId": 550,
      "title": "Clube da Luta",
      "originalTitle": "Fight Club",
      "overview": "...",
      "posterUrl": "https://image.tmdb.org/t/p/w500/poster.jpg",
      "backdropUrl": null,
      "releaseDate": "1999-10-15",
      "voteAverage": 8.4,
      "popularity": 61.2,
      "genreIds": [18]
    }
  ]
}
```

## `GET /api/catalog/search?query=<termo>`

Busca filmes por titulo (TMDB `search/movie`).

**Query:** `query` (obrigatorio, string nao vazia), `page` (opcional).

**200 OK:** mesmo formato do `now-playing`.

## `GET /api/catalog/movies/:tmdbId`

Detalhes completos de um filme especifico (TMDB `movie/{id}`) — usado quando o Organizador confirma a escolha, ja que a listagem/busca so devolve `genreIds` numericos, nao os nomes dos generos.

**Params:** `tmdbId` (numerico).

**200 OK:**

```json
{
  "movie": {
    "tmdbId": 550,
    "title": "Clube da Luta",
    "originalTitle": "Fight Club",
    "overview": "...",
    "posterUrl": "https://image.tmdb.org/t/p/w500/poster.jpg",
    "backdropUrl": null,
    "releaseDate": "1999-10-15",
    "voteAverage": 8.4,
    "popularity": 61.2,
    "genres": [{ "id": 18, "name": "Drama" }],
    "runtime": 139,
    "tagline": "..."
  }
}
```

## Erros

| Status | Quando | Body |
| --- | --- | --- |
| 400 | falta `query` na busca, ou `tmdbId` nao numerico | `{ "message": "Erro de validacao.", "issues": [...] }` |
| 401 | sem cookie/header de autenticacao | `{ "message": "Token de autenticacao ausente." }` |
| 403 | autenticado mas nao e `ORGANIZER` | `{ "message": "Usuario sem permissao..." }` |
| 404 | filme nao encontrado no TMDB | `{ "message": "Filme nao encontrado no TMDB." }` |
| 429 | rate limit do TMDB atingido | `{ "message": "Limite de requisicoes ao TMDB atingido. Tente novamente em instantes." }` |
| 502 | TMDB fora do ar, erro de rede, ou qualquer status inesperado (incl. 401 do proprio TMDB) | `{ "message": "Catalogo externo (TMDB) indisponivel no momento." }` |

## Sem cache, sem fallback mockado

Nao ha cache nesta rodada (documento de integracao TMDB marca como opcional/futuro). Nao ha fallback mockado quando `TMDB_ACCESS_TOKEN` falta ou a API falha — exige um token real configurado em `.env` (`.env.example` mantem so o placeholder). Se o token faltar, a chamada falha com `500` ("TMDB_ACCESS_TOKEN nao configurado no servidor").

## Exemplo (curl)

```bash
curl -c cookiejar.txt -s -X POST http://localhost:3333/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"organizer@demo.com","password":"123456"}'

curl -b cookiejar.txt http://localhost:3333/api/catalog/now-playing
curl -b cookiejar.txt "http://localhost:3333/api/catalog/search?query=matrix"
curl -b cookiejar.txt http://localhost:3333/api/catalog/movies/603
```

## Estrutura interna

`route -> controller -> service -> client -> TMDB`, mesmo padrao de camadas do modulo `auth` (ver `CLAUDE.md` na raiz), so que sem repository/Prisma (nao ha persistencia aqui):

- `catalog.tmdb-client.ts` — wrapper fino sobre `fetch` nativo. Monta `Authorization: Bearer` + `Accept: application/json`, timeout de 8s (`AbortSignal.timeout`). Lanca `TmdbRequestError` (carrega o `status` HTTP) pra respostas nao-2xx/rede.
- `catalog.schemas.ts` — validacao Zod de `query`/`page`/`tmdbId`.
- `catalog.mappers.ts` — `toMovieSummary`/`toMovieDetails`, traduz o payload bruto do TMDB (snake_case) pro formato de resposta (camelCase), monta as URLs de imagem.
- `catalog.service.ts` — chama o client, mapeia a resposta, converte `TmdbRequestError` em `AppError` com o status HTTP certo (404/429/502).
- `catalog.controller.ts` — 3 handlers finos.

## Correcao relacionada

`src/shared/middlewares/validate-request.ts`: no Express 5, `request.query` e um getter sem setter (`request.query = ...` lanca `TypeError: Cannot set property query...`). So foi descoberto agora porque `catalog` e o primeiro modulo a validar `query` (o `auth` so valida `body`). Corrigido usando `Object.defineProperty` pra redefinir a propriedade na instancia em vez de reatribuir.

## Testes

`tests/catalog.test.ts` (vitest + supertest) mocka `catalog.tmdb-client.ts` via `vi.mock` — nao chama o TMDB de verdade nem depende de Postgres. Cobre: sucesso dos 3 endpoints com mapeamento correto, 401/403 por papel, 400 de validacao, e os erros do TMDB (404/429/502) via client mockado lancando `TmdbRequestError`.

## Referencias

`planning-back-end/teste-verzel-integracao-tmdb-v1.md` — guia completo de integracao (auth Bearer, endpoints TMDB, mapeamento de campos, checklist).
