import { z } from "zod";

export const validateTicketBodySchema = z.object({
  eventId: z.string().uuid({ message: "eventId invalido." }),
  code: z.string().min(1, { message: "code obrigatorio." }),
  token: z.string().min(1).optional(),
});
export type ValidateTicketBody = z.infer<typeof validateTicketBodySchema>;
