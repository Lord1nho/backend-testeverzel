# Teste Verzel - Integracao TMDB - Versao 1

Este artefato define o minimo necessario para integrar o TMDB ao projeto da Plataforma de Eventos e Ingressos.

Fontes oficiais consultadas:

- https://developer.themoviedb.org/docs/getting-started
- https://developer.themoviedb.org/docs/authentication-application
- https://developer.themoviedb.org/reference/movie-now-playing-list
- https://developer.themoviedb.org/reference/search-movie
- https://developer.themoviedb.org/reference/movie-details
- https://developer.themoviedb.org/reference/configuration-details
- https://developer.themoviedb.org/reference/movie-images

## Objetivo no Projeto

No desafio, o Organizador precisa montar um evento a partir de um catalogo externo de shows ou filmes. Para o MVP, o TMDB sera usado como catalogo externo de filmes.

O TMDB nao sera responsavel por criar eventos, reservas ou ingressos. Ele sera usado apenas para fornecer dados base de filmes que o Organizador pode selecionar ao criar um evento.

## O Que Precisa Ter

### Conta e Credenciais

1. Criar conta no TMDB.
2. Acessar as configuracoes da conta.
3. Solicitar acesso de API.
4. Usar o token de leitura da API.

Variaveis de ambiente recomendadas:

```env
TMDB_BASE_URL=https://api.themoviedb.org/3
TMDB_ACCESS_TOKEN=coloque_o_token_aqui
TMDB_LANGUAGE=pt-BR
TMDB_REGION=BR
```

Use o token apenas no back-end. Nunca exponha `TMDB_ACCESS_TOKEN` no front-end.

## Autenticacao

A documentacao oficial recomenda autenticar com Bearer Token no header `Authorization`.

Exemplo:

```http
Authorization: Bearer {TMDB_ACCESS_TOKEN}
```

Exemplo com `fetch`:

```ts
async function tmdbFetch<T>(path: string, searchParams?: Record<string, string>) {
  const baseUrl = process.env.TMDB_BASE_URL ?? "https://api.themoviedb.org/3";
  const url = new URL(`${baseUrl}${path}`);

  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.TMDB_ACCESS_TOKEN}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
```

## Endpoints Recomendados para o MVP

### 1. Listar Filmes em Cartaz

Usar na tela do Organizador para sugerir filmes que podem virar eventos.

```http
GET /movie/now_playing
```

Parametros uteis:

```text
language=pt-BR
region=BR
page=1
```

Exemplo:

```ts
const movies = await tmdbFetch("/movie/now_playing", {
  language: "pt-BR",
  region: "BR",
  page: "1",
});
```

### 2. Buscar Filmes por Texto

Usar quando o Organizador digitar o nome de um filme.

```http
GET /search/movie
```

Parametros uteis:

```text
query=matrix
language=pt-BR
include_adult=false
page=1
region=BR
```

Exemplo:

```ts
const result = await tmdbFetch("/search/movie", {
  query,
  language: "pt-BR",
  include_adult: "false",
  page: "1",
  region: "BR",
});
```

### 3. Buscar Detalhes de um Filme

Usar quando o Organizador seleciona um filme antes de configurar o evento.

```http
GET /movie/{movie_id}
```

Parametros uteis:

```text
language=pt-BR
```

Exemplo:

```ts
const movie = await tmdbFetch(`/movie/${movieId}`, {
  language: "pt-BR",
});
```

### 4. Configuracao de Imagens

Usar para montar URLs corretas de posters/backdrops.

```http
GET /configuration
```

A resposta informa o `secure_base_url` e tamanhos validos de imagem.

Para o MVP, pode-se usar a URL conhecida:

```text
https://image.tmdb.org/t/p/w500{poster_path}
```

Exemplo:

```ts
function buildTmdbImageUrl(path: string | null) {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/w500${path}`;
}
```

## Campos que Devem Ser Aproveitados

Ao selecionar um filme, salve um snapshot em `external_catalog_items`.

Campos recomendados:

```text
provedor: TMDB
id_externo: movie.id
tipo: FILME
titulo: movie.title
imagem_url: poster montado com poster_path
descricao: movie.overview
payload_original: JSON original do TMDB
```

Campos uteis retornados pelo TMDB em filmes:

```text
id
title
original_title
overview
poster_path
backdrop_path
release_date
vote_average
genre_ids
popularity
```

## Fluxo no Caso de Uso Criar Evento

1. Organizador acessa Criar evento.
2. Sistema carrega filmes em cartaz via `/movie/now_playing`.
3. Organizador pode buscar por nome via `/search/movie`.
4. Organizador seleciona um filme.
5. Sistema busca detalhes via `/movie/{movie_id}`.
6. Sistema salva snapshot em `external_catalog_items`.
7. Organizador configura data, local, capacidade e preco.
8. Sistema cria o evento vinculado ao item de catalogo selecionado.

## Interface Recomendada para o Organizador

Na tela de selecao de catalogo, exibir:

- poster;
- titulo;
- data de lancamento;
- resumo curto;
- nota/media, se desejar;
- botao "Selecionar filme".

Depois da selecao, abrir formulario de configuracao:

- data e horario do evento;
- local;
- capacidade;
- preco;
- modo de venda: assento ou quantidade.

## Tratamento de Erros

Casos que precisam ser tratados:

- token ausente ou invalido;
- TMDB indisponivel;
- busca sem resultados;
- filme selecionado nao encontrado;
- imagem ausente;
- limite/rate limit da API.

Fallback recomendado para o MVP:

- Se o TMDB falhar, exibir mensagem clara.
- Opcionalmente, manter 3 a 5 filmes mockados apenas para desenvolvimento local.
- Registrar no README se houver fallback mockado.

## Onde Chamar o TMDB

Chame o TMDB apenas no back-end.

Exemplos:

```text
GET /api/catalog/movies/now-playing
GET /api/catalog/movies/search?query=...
GET /api/catalog/movies/:tmdbId
```

O front-end chama sua API interna, e sua API interna chama o TMDB.

Motivos:

- protege o token;
- centraliza tratamento de erro;
- permite cache;
- evita acoplar o front-end diretamente ao formato do TMDB.

## Service Sugerido

```ts
export class TmdbCatalogService {
  async listNowPlaying(page = 1) {
    return tmdbFetch("/movie/now_playing", {
      language: process.env.TMDB_LANGUAGE ?? "pt-BR",
      region: process.env.TMDB_REGION ?? "BR",
      page: String(page),
    });
  }

  async searchMovies(query: string, page = 1) {
    return tmdbFetch("/search/movie", {
      query,
      language: process.env.TMDB_LANGUAGE ?? "pt-BR",
      region: process.env.TMDB_REGION ?? "BR",
      include_adult: "false",
      page: String(page),
    });
  }

  async getMovieDetails(movieId: string) {
    return tmdbFetch(`/movie/${movieId}`, {
      language: process.env.TMDB_LANGUAGE ?? "pt-BR",
    });
  }
}
```

## Cache Recomendado

Para o MVP, nao e obrigatorio, mas e uma boa melhoria.

Sugestoes:

- cache curto para busca e filmes em cartaz: 5 a 30 minutos;
- salvar snapshot definitivo do filme selecionado;
- nao depender do TMDB para renderizar eventos ja criados.

## Impacto no DER

Entidade envolvida:

```text
external_catalog_items
```

Relacionamento:

```text
external_catalog_items 1 -> N events
```

Isso permite que:

- o mesmo filme possa ser usado em mais de um evento;
- o evento continue funcionando mesmo se o TMDB estiver indisponivel;
- o sistema tenha rastreabilidade sobre a origem externa do evento.

## Checklist de Integracao

- [ ] Criar conta no TMDB.
- [ ] Obter API Read Access Token.
- [ ] Adicionar `TMDB_ACCESS_TOKEN` no `.env`.
- [ ] Criar `TmdbCatalogService`.
- [ ] Criar endpoint interno para filmes em cartaz.
- [ ] Criar endpoint interno para busca de filmes.
- [ ] Criar endpoint interno para detalhes do filme.
- [ ] Criar tela do Organizador para selecionar filme.
- [ ] Salvar snapshot do filme selecionado.
- [ ] Vincular evento criado ao item de catalogo.
- [ ] Documentar no README como configurar a chave.

## Decisao Recomendada

Para o teste tecnico, use apenas TMDB no MVP e trate os eventos como sessoes de cinema.

Essa decisao reduz escopo, atende ao requisito de API externa e combina bem com o requisito de assentos, QR Code e portaria.
