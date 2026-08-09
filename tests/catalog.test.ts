import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { signAccessToken } from "../src/shared/security/token-service.js";

vi.mock("../src/modules/catalog/catalog.tmdb-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/modules/catalog/catalog.tmdb-client.js")>();
  return {
    ...actual,
    fetchNowPlaying: vi.fn(),
    searchMovies: vi.fn(),
    fetchMovieDetails: vi.fn(),
  };
});

import {
  fetchMovieDetails,
  fetchNowPlaying,
  searchMovies,
  TmdbRequestError,
} from "../src/modules/catalog/catalog.tmdb-client.js";

const app = createApp();

const organizerToken = signAccessToken({ sub: "organizer-id", role: "ORGANIZER" });
const customerToken = signAccessToken({ sub: "customer-id", role: "CUSTOMER" });

const RAW_MOVIE_LIST = {
  page: 1,
  total_pages: 10,
  total_results: 200,
  results: [
    {
      id: 550,
      title: "Clube da Luta",
      original_title: "Fight Club",
      overview: "...",
      poster_path: "/poster.jpg",
      backdrop_path: null,
      release_date: "1999-10-15",
      vote_average: 8.4,
      popularity: 61.2,
      genre_ids: [18],
    },
  ],
};

const RAW_MOVIE_DETAILS = {
  id: 550,
  title: "Clube da Luta",
  original_title: "Fight Club",
  overview: "...",
  poster_path: "/poster.jpg",
  backdrop_path: null,
  release_date: "1999-10-15",
  vote_average: 8.4,
  popularity: 61.2,
  genres: [{ id: 18, name: "Drama" }],
  runtime: 139,
  tagline: "...",
};

describe("catalog", () => {
  beforeEach(() => {
    vi.mocked(fetchNowPlaying).mockResolvedValue(RAW_MOVIE_LIST);
    vi.mocked(searchMovies).mockResolvedValue(RAW_MOVIE_LIST);
    vi.mocked(fetchMovieDetails).mockResolvedValue(RAW_MOVIE_DETAILS);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/catalog/now-playing", () => {
    it("retorna filmes em cartaz mapeados para ORGANIZER", async () => {
      const response = await request(app)
        .get("/api/catalog/now-playing")
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.results[0]).toMatchObject({
        tmdbId: 550,
        title: "Clube da Luta",
        posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
        backdropUrl: null,
      });
    });

    it("retorna 401 sem token", async () => {
      const response = await request(app).get("/api/catalog/now-playing");

      expect(response.status).toBe(401);
    });

    it("retorna 403 para CUSTOMER", async () => {
      const response = await request(app)
        .get("/api/catalog/now-playing")
        .set("Authorization", `Bearer ${customerToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/catalog/search", () => {
    it("busca filmes por texto", async () => {
      const response = await request(app)
        .get("/api/catalog/search?query=matrix")
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(200);
      expect(searchMovies).toHaveBeenCalledWith("matrix", 1);
      expect(response.body.results).toHaveLength(1);
    });

    it("retorna 400 quando falta query", async () => {
      const response = await request(app)
        .get("/api/catalog/search")
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/catalog/movies/:tmdbId", () => {
    it("retorna detalhes completos, incluindo genres/runtime/tagline", async () => {
      const response = await request(app)
        .get("/api/catalog/movies/550")
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.movie).toMatchObject({
        tmdbId: 550,
        genres: [{ id: 18, name: "Drama" }],
        runtime: 139,
      });
    });

    it("retorna 400 para tmdbId nao numerico", async () => {
      const response = await request(app)
        .get("/api/catalog/movies/abc")
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(400);
    });

    it("retorna 404 quando o client lanca TmdbRequestError(404)", async () => {
      vi.mocked(fetchMovieDetails).mockRejectedValue(new TmdbRequestError("nao encontrado", 404));

      const response = await request(app)
        .get("/api/catalog/movies/999999")
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe("erros do TMDB", () => {
    it("mapeia 429 do TMDB para 429", async () => {
      vi.mocked(fetchNowPlaying).mockRejectedValue(new TmdbRequestError("rate limit", 429));

      const response = await request(app)
        .get("/api/catalog/now-playing")
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(429);
    });

    it("mapeia 5xx/rede do TMDB para 502", async () => {
      vi.mocked(fetchNowPlaying).mockRejectedValue(new TmdbRequestError("fora do ar", 503));

      const response = await request(app)
        .get("/api/catalog/now-playing")
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(502);
    });
  });
});
