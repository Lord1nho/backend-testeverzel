import { z } from "zod";

export const nowPlayingQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
});
export type NowPlayingQuery = z.infer<typeof nowPlayingQuerySchema>;

export const searchMoviesQuerySchema = z.object({
  query: z.string().trim().min(1, { message: "Parametro 'query' e obrigatorio." }),
  page: z.coerce.number().int().positive().optional(),
});
export type SearchMoviesQuery = z.infer<typeof searchMoviesQuerySchema>;

export const movieIdParamSchema = z.object({
  tmdbId: z.coerce.number().int().positive({ message: "tmdbId invalido." }),
});
export type MovieIdParam = z.infer<typeof movieIdParamSchema>;
