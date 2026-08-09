import type { RequestHandler } from "express";

import * as catalogService from "./catalog.service.js";
import type { MovieIdParam, NowPlayingQuery, SearchMoviesQuery } from "./catalog.schemas.js";

export const nowPlayingController: RequestHandler = async (request, response) => {
  const { page } = request.query as unknown as NowPlayingQuery;

  const result = await catalogService.getNowPlaying(page);

  response.status(200).json(result);
};

export const searchMoviesController: RequestHandler = async (request, response) => {
  const { query, page } = request.query as unknown as SearchMoviesQuery;

  const result = await catalogService.searchMovies(query, page);

  response.status(200).json(result);
};

export const movieDetailsController: RequestHandler = async (request, response) => {
  const { tmdbId } = request.params as unknown as MovieIdParam;

  const movie = await catalogService.getMovieDetails(tmdbId);

  response.status(200).json({ movie });
};
