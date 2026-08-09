import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

const TMDB_REQUEST_TIMEOUT_MS = 8000;

export class TmdbRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TmdbRequestError";
  }
}

export type TmdbMovieSummary = {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  popularity: number;
  genre_ids: number[];
};

export type TmdbMovieListResponse = {
  page: number;
  results: TmdbMovieSummary[];
  total_pages: number;
  total_results: number;
};

export type TmdbGenre = { id: number; name: string };

export type TmdbMovieDetails = Omit<TmdbMovieSummary, "genre_ids"> & {
  genres: TmdbGenre[];
  runtime: number | null;
  tagline: string | null;
};

async function tmdbFetch<T>(path: string, searchParams: Record<string, string | undefined> = {}): Promise<T> {
  if (!env.TMDB_ACCESS_TOKEN) {
    throw new AppError("TMDB_ACCESS_TOKEN nao configurado no servidor.", 500);
  }

  const url = new URL(`${env.TMDB_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.TMDB_ACCESS_TOKEN}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TMDB_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TmdbRequestError("Falha de rede ao comunicar com o TMDB.", 502);
  }

  if (!response.ok) {
    throw new TmdbRequestError(`TMDB respondeu com status ${response.status}.`, response.status);
  }

  return response.json() as Promise<T>;
}

export function fetchNowPlaying(page = 1) {
  return tmdbFetch<TmdbMovieListResponse>("/movie/now_playing", {
    language: env.TMDB_LANGUAGE,
    region: env.TMDB_REGION,
    page: String(page),
  });
}

export function searchMovies(query: string, page = 1) {
  return tmdbFetch<TmdbMovieListResponse>("/search/movie", {
    query,
    language: env.TMDB_LANGUAGE,
    region: env.TMDB_REGION,
    include_adult: "false",
    page: String(page),
  });
}

export function fetchMovieDetails(tmdbId: number) {
  return tmdbFetch<TmdbMovieDetails>(`/movie/${tmdbId}`, {
    language: env.TMDB_LANGUAGE,
  });
}
