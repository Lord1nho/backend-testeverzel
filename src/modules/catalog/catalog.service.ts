import { AppError } from "../../shared/errors/app-error.js";
import { toMovieDetails, toMovieSummary } from "./catalog.mappers.js";
import {
  fetchMovieDetails,
  fetchNowPlaying,
  searchMovies as tmdbSearchMovies,
  TmdbRequestError,
} from "./catalog.tmdb-client.js";

function mapTmdbError(error: unknown): never {
  if (error instanceof TmdbRequestError) {
    if (error.status === 404) {
      throw new AppError("Filme não encontrado no TMDB.", 404);
    }
    if (error.status === 429) {
      throw new AppError("Limite de requisições ao TMDB atingido. Tente novamente em instantes.", 429);
    }
    throw new AppError("Catálogo externo (TMDB) indisponível no momento.", 502);
  }

  throw error;
}

export async function getNowPlaying(page = 1) {
  try {
    const data = await fetchNowPlaying(page);
    return {
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map(toMovieSummary),
    };
  } catch (error) {
    mapTmdbError(error);
  }
}

export async function searchMovies(query: string, page = 1) {
  try {
    const data = await tmdbSearchMovies(query, page);
    return {
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map(toMovieSummary),
    };
  } catch (error) {
    mapTmdbError(error);
  }
}

export async function getMovieDetails(tmdbId: number) {
  try {
    const movie = await fetchMovieDetails(tmdbId);
    return toMovieDetails(movie);
  } catch (error) {
    mapTmdbError(error);
  }
}
