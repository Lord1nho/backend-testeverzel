import { z } from "zod";

import { Venue } from "../../../generated/prisma/enums.js";

// Limite tecnico do esquema de codigo de assento (linhas de 10, letras A-Z):
// A1..A10, B1..B10, ..., Z1..Z10 = 260 assentos no maximo.
const MAX_CAPACITY = 260;

const isoDatetimeSchema = z
  .string()
  .datetime({ message: "startsAt deve ser uma data ISO 8601 válida." })
  .refine((value) => new Date(value).getTime() > Date.now(), {
    message: "startsAt deve ser uma data futura.",
  });

const venueSchema = z.nativeEnum(Venue, {
  message: "venue inválido. Use CINE_VERZEL_1 ou CINE_VERZEL_2.",
});

const roomSchema = z
  .number()
  .int()
  .min(1, { message: "room deve estar entre 1 e 4." })
  .max(4, { message: "room deve estar entre 1 e 4." });

// title NAO entra aqui de proposito: o nome do evento e sempre travado no
// titulo vindo do TMDB (catalogService.getMovieDetails), o organizador nao
// pode sobrescrever -- ver createEvent em events.service.ts.
export const createEventBodySchema = z.object({
  tmdbId: z.coerce.number().int().positive({ message: "tmdbId inválido." }),
  startsAt: isoDatetimeSchema,
  venue: venueSchema,
  room: roomSchema,
  capacity: z
    .number()
    .int()
    .positive({ message: "capacity deve ser um inteiro positivo." })
    .max(MAX_CAPACITY, { message: `capacity não pode ultrapassar ${MAX_CAPACITY}.` }),
  price: z.number().nonnegative({ message: "price não pode ser negativo." }),
});
export type CreateEventBody = z.infer<typeof createEventBodySchema>;

// A checagem "capacidade so editavel se o evento estiver DRAFT" e "data/venue/room
// travados com reserva paga" dependem do estado atual do evento no banco e nao
// da pra expressar aqui -- ficam no service (updateEvent).
export const updateEventBodySchema = z
  .object({
    startsAt: isoDatetimeSchema.optional(),
    venue: venueSchema.optional(),
    room: roomSchema.optional(),
    capacity: z
      .number()
      .int()
      .positive({ message: "capacity deve ser um inteiro positivo." })
      .max(MAX_CAPACITY, { message: `capacity não pode ultrapassar ${MAX_CAPACITY}.` })
      .optional(),
    price: z.number().nonnegative().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });
export type UpdateEventBody = z.infer<typeof updateEventBodySchema>;

export const eventIdParamSchema = z.object({
  id: z.string().uuid({ message: "id inválido." }),
});
export type EventIdParam = z.infer<typeof eventIdParamSchema>;
