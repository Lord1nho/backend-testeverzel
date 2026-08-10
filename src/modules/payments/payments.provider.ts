import { randomUUID } from "node:crypto";

export type PaymentCard = {
  number: string;
  holderName: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
};

export type PaymentChargeInput = {
  amount: number;
  card: PaymentCard;
};

export type PaymentChargeResult = {
  status: "APPROVED" | "DECLINED";
  providerReference: string;
  failureReason: string | null;
};

// Abstracao de pagamento (decisao de escopo do UC12 no doc de casos de uso):
// isola a regra de aprovar/recusar atras de uma interface, pra permitir
// trocar por um sandbox de gateway real (Stripe Test Mode, Mercado Pago)
// depois sem tocar em payments.service.ts nem no fluxo de reserva.
export type PaymentProvider = {
  charge(input: PaymentChargeInput): PaymentChargeResult;
};

// Convencao de cartao de teste (igual sandbox de gateway real): numero
// terminado em "0000" e sempre recusado, qualquer outro e aprovado. Nao ha
// verificacao real (Luhn, bandeira, etc.) -- e inteiramente simulado.
const DECLINE_CARD_SUFFIX = "0000";

export const simulatedPaymentProvider: PaymentProvider = {
  charge(input) {
    const isDeclined = input.card.number.endsWith(DECLINE_CARD_SUFFIX);

    return {
      status: isDeclined ? "DECLINED" : "APPROVED",
      providerReference: `SIMULATED-${randomUUID()}`,
      failureReason: isDeclined ? "Cartao recusado pelo emissor (simulado)." : null,
    };
  },
};
