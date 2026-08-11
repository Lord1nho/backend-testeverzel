import { randomUUID } from "node:crypto";

import { AppError } from "../../shared/errors/app-error.js";
import { prisma } from "../../shared/prisma/client.js";
import { generateTicketCode } from "../../shared/security/secure-token.js";
import { signTicketQr } from "../../shared/security/ticket-qr.js";
import type { PaymentChargeResult } from "./payments.provider.js";

type ProcessPaymentInput = {
  reservationId: string;
  customerId: string;
  eventId: string;
  seatIds: string[];
  amount: number;
  chargeResult: PaymentChargeResult;
};

// UC12 (guiado pela skill reserva-segura): o UPDATE condicional da reserva
// (status: "PENDING_PAYMENT" no WHERE) e o recheck-dentro-da-transacao que
// impede duas tentativas de pagamento concorrentes na mesma reserva de
// ambas "vencerem" -- se o count nao bater, outra ja processou primeiro, a
// gente aborta (rollback automatico, nenhum SimulatedPayment orfao).
export function processPayment(input: ProcessPaymentInput) {
  return prisma.$transaction(async (tx) => {
    const newReservationStatus: "PAID" | "PAYMENT_DECLINED" =
      input.chargeResult.status === "APPROVED" ? "PAID" : "PAYMENT_DECLINED";

    const reservationUpdate = await tx.ticketReservation.updateMany({
      where: { id: input.reservationId, status: "PENDING_PAYMENT" },
      data: { status: newReservationStatus },
    });

    if (reservationUpdate.count !== 1) {
      throw new AppError("Pagamento ja processado ou reserva nao esta aguardando pagamento.", 409);
    }

    const payment = await tx.simulatedPayment.create({
      data: {
        reservationId: input.reservationId,
        provider: "SIMULATED",
        providerReference: input.chargeResult.providerReference,
        status: input.chargeResult.status,
        amount: input.amount,
        failureReason: input.chargeResult.failureReason,
        paidAt: input.chargeResult.status === "APPROVED" ? new Date() : null,
      },
    });

    if (input.chargeResult.status === "DECLINED") {
      // Regra explicita do UC12/skill: pagamento recusado nao emite ticket
      // e libera o bloqueio do assento.
      await tx.eventSeat.updateMany({
        where: { id: { in: input.seatIds }, status: "RESERVED" },
        data: { status: "AVAILABLE" },
      });

      return { payment, reservationStatus: newReservationStatus, tickets: [] };
    }

    await tx.eventSeat.updateMany({
      where: { id: { in: input.seatIds }, status: "RESERVED" },
      data: { status: "SOLD" },
    });

    // Um ticket por assento (reserva aprovada gera "um ou mais ingressos").
    // O id e gerado antes do create pra poder assinar o QR (HMAC sobre o
    // ticket.id) na mesma escrita, sem precisar de um update posterior.
    const tickets = [];
    for (const eventSeatId of input.seatIds) {
      const ticketId = randomUUID();
      const ticket = await tx.ticket.create({
        data: {
          id: ticketId,
          reservationId: input.reservationId,
          customerId: input.customerId,
          eventId: input.eventId,
          eventSeatId,
          code: generateTicketCode(),
          qrTokenHash: signTicketQr(ticketId),
        },
      });
      tickets.push(ticket);
    }

    return { payment, reservationStatus: newReservationStatus, tickets };
  });
}

// Checagem preguicosa do bloqueio de 15min da reserva (expiresAt setado na
// criacao, nunca antes aplicado -- sem cron/job separado). So dispara
// quando alguem de fato tenta pagar uma reserva ja vencida. Mesmo recheck
// condicional de status; se outra requisicao ja mudou o estado, e um no-op
// seguro (nao ha SimulatedPayment envolvido, nenhuma tentativa aconteceu).
export function expireReservationIfPastDue(reservationId: string, seatIds: string[]) {
  return prisma.$transaction(async (tx) => {
    const expired = await tx.ticketReservation.updateMany({
      where: { id: reservationId, status: "PENDING_PAYMENT" },
      data: { status: "EXPIRED" },
    });

    if (expired.count !== 1) {
      return;
    }

    await tx.eventSeat.updateMany({
      where: { id: { in: seatIds }, status: "RESERVED" },
      data: { status: "AVAILABLE" },
    });
  });
}
