import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  TICKET_QR_SECRET: z.string().min(1),
  TMDB_BASE_URL: z.string().url().default("https://api.themoviedb.org/3"),
  TMDB_ACCESS_TOKEN: z.string().optional(),
  TMDB_LANGUAGE: z.string().default("pt-BR"),
  TMDB_REGION: z.string().default("BR"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3333),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = envSchema.parse(process.env);
