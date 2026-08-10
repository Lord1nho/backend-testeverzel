import { z } from "zod";

const currentYear = new Date().getFullYear();

// Validacao e so de formato -- e um checkout simulado, sem verificacao real
// (Luhn, bandeira, etc.). A decisao de aprovar/recusar mora em
// payments.provider.ts, olhando so pro numero do cartao.
const cardSchema = z.object({
  number: z.string().regex(/^\d{13,19}$/, { message: "Numero de cartao invalido." }),
  holderName: z.string().trim().min(1, { message: "Nome do titular obrigatorio." }),
  expiryMonth: z.number().int().min(1).max(12, { message: "Mes de validade invalido." }),
  expiryYear: z.number().int().min(currentYear, { message: "Ano de validade invalido." }),
  cvv: z.string().regex(/^\d{3,4}$/, { message: "CVV invalido." }),
});

export const payReservationBodySchema = z.object({
  reservationId: z.string().uuid({ message: "reservationId invalido." }),
  card: cardSchema,
});
export type PayReservationBody = z.infer<typeof payReservationBodySchema>;
