import { AppError } from "../../shared/errors/app-error.js";
import { prisma } from "../../shared/prisma/client.js";
import type { Prisma } from "../../../generated/prisma/client.js";

const reservationDetailInclude = {
  event: true,
  items: { include: { eventSeat: true } },
  tickets: true,
} satisfies Prisma.TicketReservationInclude;

type CreateReservationInput = {
  customerId: string;
  eventId: string;
  seatIds: string[];
  unitPrice: number;
  expiresAt: Date;
};

// UC10/UC11 - o coracao da reserva segura: a checagem de disponibilidade
// PRECISA acontecer dentro da mesma transacao que muda o status do
// assento, nunca antes (senao duas reservas concorrentes passariam pela
// checagem e venderiam o mesmo assento duas vezes). O UPDATE condicional
// (status: "AVAILABLE" no WHERE) e atomico no Postgres -- se outra
// transacao ja reservou um dos assentos, o count fica menor que
// seatIds.length e a gente aborta lancando aqui dentro, o que faz o Prisma
// dar rollback automatico (nenhum assento fica preso em RESERVED).
export function createReservationWithSeats(input: CreateReservationInput) {
  return prisma.$transaction(async (tx) => {
    const seatsUpdate = await tx.eventSeat.updateMany({
      where: {
        id: { in: input.seatIds },
        eventId: input.eventId,
        status: "AVAILABLE",
      },
      data: { status: "RESERVED" },
    });

    if (seatsUpdate.count !== input.seatIds.length) {
      throw new AppError("Um ou mais assentos selecionados não estão mais disponíveis.", 409);
    }

    const reservation = await tx.ticketReservation.create({
      data: {
        customerId: input.customerId,
        eventId: input.eventId,
        status: "PENDING_PAYMENT",
        quantity: input.seatIds.length,
        totalAmount: input.unitPrice * input.seatIds.length,
        expiresAt: input.expiresAt,
        items: {
          createMany: {
            data: input.seatIds.map((eventSeatId) => ({
              eventSeatId,
              unitPrice: input.unitPrice,
            })),
          },
        },
      },
    });

    return tx.ticketReservation.findUniqueOrThrow({
      where: { id: reservation.id },
      include: reservationDetailInclude,
    });
  });
}

export function findByIdAndCustomer(id: string, customerId: string) {
  return prisma.ticketReservation.findFirst({
    where: { id, customerId },
    include: reservationDetailInclude,
  });
}

// Libera o assento pro Cliente que desiste ANTES de tentar pagar (sem essa
// rota, o unico jeito do assento voltar pra AVAILABLE era via recusa de
// pagamento ou expiracao -- ver payments.repository.ts). Mesmo recheck
// dentro da transacao da reserva-segura: o UPDATE condicional
// (status: "PENDING_PAYMENT" no WHERE) protege contra corrida com um
// pagamento concorrente pra mesma reserva.
export async function cancelReservation(id: string, customerId: string) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.ticketReservation.findFirst({
      where: { id, customerId },
      include: { items: true },
    });

    if (!reservation) {
      return null;
    }

    if (reservation.status !== "PENDING_PAYMENT") {
      throw new AppError("Reserva não pode ser cancelada nesse estado.", 400);
    }

    const cancelled = await tx.ticketReservation.updateMany({
      where: { id, status: "PENDING_PAYMENT" },
      data: { status: "CANCELLED" },
    });

    if (cancelled.count !== 1) {
      throw new AppError("Reserva não pode ser cancelada nesse estado.", 400);
    }

    await tx.eventSeat.updateMany({
      where: { id: { in: reservation.items.map((item) => item.eventSeatId) }, status: "RESERVED" },
      data: { status: "AVAILABLE" },
    });

    return tx.ticketReservation.findUniqueOrThrow({
      where: { id },
      include: reservationDetailInclude,
    });
  });
}
