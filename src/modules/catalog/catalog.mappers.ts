import type { TmdbMovieDetails, TmdbMovieSummary } from "./catalog.tmdb-client.js";

const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";

function buildImageUrl(path: string | null): string | null {
  return path ? `${TMDB_IMAGE_BASE_URL}${path}` : null;
}

export function toMovieSummary(movie: TmdbMovieSummary) {
  return {
    tmdbId: movie.id,
    title: movie.title,
    originalTitle: movie.original_title,
    overview: movie.overview,
    posterUrl: buildImageUrl(movie.poster_path),
    backdropUrl: buildImageUrl(movie.backdrop_path),
    releaseDate: movie.release_date || null,
    voteAverage: movie.vote_average,
    popularity: movie.popularity,
    genreIds: movie.genre_ids,
  };
}

export function toMovieDetails(movie: TmdbMovieDetails) {
  return {
    tmdbId: movie.id,
    title: movie.title,
    originalTitle: movie.original_title,
    overview: movie.overview,
    posterUrl: buildImageUrl(movie.poster_path),
    backdropUrl: buildImageUrl(movie.backdrop_path),
    releaseDate: movie.release_date || null,
    voteAverage: movie.vote_average,
    popularity: movie.popularity,
    genres: movie.genres,
    runtime: movie.runtime,
    tagline: movie.tagline || null,
  };
}
