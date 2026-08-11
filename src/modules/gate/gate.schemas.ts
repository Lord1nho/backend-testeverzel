import { z } from "zod";

export const validateTicketBodySchema = z.object({
  eventId: z.string().uuid({ message: "eventId inválido." }),
  code: z.string().min(1, { message: "code obrigatório." }),
  token: z.string().min(1).optional(),
});
export type ValidateTicketBody = z.infer<typeof validateTicketBodySchema>;

export const ticketCodeParamSchema = z.object({
  code: z.string().min(1, { message: "code obrigatório." }),
});
export type TicketCodeParam = z.infer<typeof ticketCodeParamSchema>;
