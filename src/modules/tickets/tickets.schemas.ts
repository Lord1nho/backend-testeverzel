import { z } from "zod";

export const ticketIdParamSchema = z.object({
  id: z.string().uuid({ message: "id inválido." }),
});
export type TicketIdParam = z.infer<typeof ticketIdParamSchema>;

export const shareTokenParamSchema = z.object({
  token: z.string().min(1, { message: "token inválido." }),
});
export type ShareTokenParam = z.infer<typeof shareTokenParamSchema>;
