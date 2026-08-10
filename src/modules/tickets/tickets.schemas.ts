import { z } from "zod";

export const ticketIdParamSchema = z.object({
  id: z.string().uuid({ message: "id invalido." }),
});
export type TicketIdParam = z.infer<typeof ticketIdParamSchema>;

export const shareTokenParamSchema = z.object({
  token: z.string().min(1, { message: "token invalido." }),
});
export type ShareTokenParam = z.infer<typeof shareTokenParamSchema>;
