import { z } from "zod";

// Limite arbitrario de negocio pra evitar reservas gigantes numa unica
// requisicao (o projeto adotou mapa de assentos, nao quantidade -- ver
// UC11 e a decisao de escopo em events/README.md).
const MAX_SEATS_PER_RESERVATION = 10;

export const createReservationBodySchema = z.object({
  eventId: z.string().uuid({ message: "eventId inválido." }),
  seatIds: z
    .array(z.string().uuid({ message: "seatId inválido." }))
    .min(1, { message: "Selecione ao menos um assento." })
    .max(MAX_SEATS_PER_RESERVATION, {
      message: `Selecione no máximo ${MAX_SEATS_PER_RESERVATION} assentos por reserva.`,
    })
    .refine((seatIds) => new Set(seatIds).size === seatIds.length, {
      message: "seatIds não pode conter assentos duplicados.",
    }),
});
export type CreateReservationBody = z.infer<typeof createReservationBodySchema>;

export const reservationIdParamSchema = z.object({
  id: z.string().uuid({ message: "id inválido." }),
});
export type ReservationIdParam = z.infer<typeof reservationIdParamSchema>;
