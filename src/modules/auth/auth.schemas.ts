import { z } from "zod";

export const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: "E-mail invalido." }),
  password: z.string().min(1, { message: "Senha e obrigatoria." }),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
