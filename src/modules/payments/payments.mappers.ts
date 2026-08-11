import type { ReservationStatus, SimulatedPayment, Ticket } from "../../../generated/prisma/client.js";

type ProcessPaymentResult = {
  payment: SimulatedPayment;
  reservationStatus: ReservationStatus;
  tickets: Ticket[];
};

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
  };
}
