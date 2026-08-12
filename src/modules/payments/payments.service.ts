import { AppError } from "../../shared/errors/app-error.js";
import * as reservationsRepository from "../reservations/reservations.repository.js";
import { toPaymentResult } from "./payments.mappers.js";
import { simulatedPaymentProvider } from "./payments.provider.js";
import * as paymentsRepository from "./payments.repository.js";
import type { PayReservationBody } from "./payments.schemas.js";

// UC12 - Realizar Pagamento Simulado. Ate MAX_PAYMENT_ATTEMPTS tentativas
// por reserva (ver payments.repository.ts): uma recusa nas tentativas 1/2
// mantem a reserva PENDING_PAYMENT e o assento RESERVED (o Cliente tenta
// de novo na mesma reserva); so a tentativa final leva a reserva pra
// PAID ou PAYMENT_DECLINED de forma definitiva, liberando o assento se
// recusada. Depois disso, so reservando de novo (UC10).
export async function payForReservation(customerId: string, body: PayReservationBody) {
  const reservation = await reservationsRepository.findByIdAndCustomer(body.reservationId, customerId);
  if (!reservation) {
    throw new AppError("Reserva não encontrada.", 404);
  }

  if (reservation.status !== "PENDING_PAYMENT") {
    throw new AppError("Reserva não está aguardando pagamento.", 400);
  }

  const seatIds = reservation.items.map((item) => item.eventSeatId);

  if (reservation.expiresAt && reservation.expiresAt.getTime() < Date.now()) {
    await paymentsRepository.expireReservationIfPastDue(reservation.id, seatIds);
    throw new AppError("Reserva expirada. Faça uma nova reserva.", 400);
  }

  const chargeResult = simulatedPaymentProvider.charge({
    amount: Number(reservation.totalAmount),
    card: body.card,
  });

  const result = await paymentsRepository.processPayment({
    reservationId: reservation.id,
    customerId,
    eventId: reservation.eventId,
    seatIds,
    amount: Number(reservation.totalAmount),
    chargeResult,
  });

  return toPaymentResult(result);
}
