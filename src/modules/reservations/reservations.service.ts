import { AppError } from "../../shared/errors/app-error.js";
import * as eventsRepository from "../events/events.repository.js";
import { toReservationDetail } from "./reservations.mappers.js";
import * as reservationsRepository from "./reservations.repository.js";
import type { CreateReservationBody } from "./reservations.schemas.js";

const RESERVATION_HOLD_MINUTES = 15;

// UC10 - Reservar Ingresso (inclui UC11 - Selecionar Assento). Fica de fora
// desta rodada, por decisao de escopo: UC12 - Realizar Pagamento Simulado.
// A reserva nasce PENDING_PAYMENT com os assentos em RESERVED (bloqueio
// temporario) -- confirmar/recusar o pagamento e emitir o ticket ficam pro
// modulo payments/tickets.
export async function createReservation(customerId: string, body: CreateReservationBody) {
  const event = await eventsRepository.findPublishedEventForReservation(body.eventId);
  if (!event) {
    throw new AppError("Evento nao encontrado ou nao publicado.", 404);
  }

  if (event.startsAt.getTime() < Date.now()) {
    throw new AppError("Evento ja comecou ou encerrou, reserva nao permitida.", 400);
  }

  const expiresAt = new Date(Date.now() + RESERVATION_HOLD_MINUTES * 60 * 1000);

  const reservation = await reservationsRepository.createReservationWithSeats({
    customerId,
    eventId: event.id,
    seatIds: body.seatIds,
    unitPrice: Number(event.price),
    expiresAt,
  });

  return toReservationDetail(reservation);
}

export async function getReservationById(customerId: string, reservationId: string) {
  const reservation = await reservationsRepository.findByIdAndCustomer(reservationId, customerId);
  if (!reservation) {
    throw new AppError("Reserva nao encontrada.", 404);
  }
  return toReservationDetail(reservation);
}

// Cliente desiste ANTES de tentar pagar -- libera o assento sem precisar
// passar pelo modulo payments. So permitido enquanto PENDING_PAYMENT.
export async function cancelReservation(customerId: string, reservationId: string) {
  const reservation = await reservationsRepository.cancelReservation(reservationId, customerId);
  if (!reservation) {
    throw new AppError("Reserva nao encontrada.", 404);
  }
  return toReservationDetail(reservation);
}
