import type { ReservationStatus, SimulatedPayment, Ticket } from "../../../generated/prisma/client.js";

type ProcessPaymentResult = {
  payment: SimulatedPayment;
  reservationStatus: ReservationStatus;
  tickets: Ticket[];
  attempt: number;
  maxAttempts: number;
};

// attempt/maxAttempts dao ao frontend o que precisa pra decidir a tela:
// reservationStatus "PENDING_PAYMENT" apos uma recusa = ainda ha tentativa
// sobrando, continua no checkout; "PAYMENT_DECLINED" = tentativas
// esgotadas (ou 3a recusa), reserva fechada, precisa reservar de novo.
export function toPaymentResult(result: ProcessPaymentResult) {
  return {
    payment: {
      id: result.payment.id,
      status: result.payment.status,
      amount: Number(result.payment.amount),
      failureReason: result.payment.failureReason,
      paidAt: result.payment.paidAt,
    },
    reservationStatus: result.reservationStatus,
    tickets: result.tickets.map((ticket) => ({ id: ticket.id, code: ticket.code, status: ticket.status })),
    attempt: result.attempt,
    maxAttempts: result.maxAttempts,
  };
}
