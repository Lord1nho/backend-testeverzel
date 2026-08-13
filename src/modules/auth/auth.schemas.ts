import { z } from "zod";

export const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: "E-mail inválido." }),
  password: z
    .string()
    .min(1, { message: "Senha é obrigatória." })
    .refine((value) => !/\s/.test(value), {
      message: "Senha não pode conter espaços.",
    }),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
