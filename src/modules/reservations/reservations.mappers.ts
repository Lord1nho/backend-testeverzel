import { sortSeatsByCode } from "../events/events.mappers.js";
import type { Event, EventSeat, ReservationItem, TicketReservation } from "../../../generated/prisma/client.js";

type ReservationDetailRow = TicketReservation & {
  event: Event;
  items: (ReservationItem & { eventSeat: EventSeat })[];
};

export function toReservationDetail(reservation: ReservationDetailRow) {
  const seats = sortSeatsByCode(reservation.items.map((item) => item.eventSeat));

  return {
    id: reservation.id,
    status: reservation.status,
    quantity: reservation.quantity,
    totalAmount: Number(reservation.totalAmount),
    expiresAt: reservation.expiresAt,
    createdAt: reservation.createdAt,
    event: {
      id: reservation.event.id,
      title: reservation.event.title,
      startsAt: reservation.event.startsAt,
      venue: reservation.event.venue,
      room: reservation.event.room,
    },
    seats: seats.map((seat) => ({ id: seat.id, code: seat.code })),
  };
}
