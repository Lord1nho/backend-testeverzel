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

// Ate 3 tentativas por reserva (UC12, decisao de produto): recusar nas
// tentativas 1 e 2 mantem a reserva PENDING_PAYMENT e o assento RESERVED
// (o cliente fica na tela de checkout e tenta de novo, sem perder o
// lugar). So a 3a recusa e definitiva -- ai sim libera o assento e fecha
// a reserva como PAYMENT_DECLINED, igual ao comportamento antigo de
// tentativa unica. Excecao deliberada a regra geral da skill
// reserva-segura ("recusou, libera o assento na hora"): aqui so libera na
// tentativa final, nunca nas intermediarias.
export const MAX_PAYMENT_ATTEMPTS = 3;

// UC12 (guiado pela skill reserva-segura): o "claim" da tentativa e um
// UPDATE condicional (status: "PENDING_PAYMENT" e paymentAttempts < MAX no
// WHERE, incrementando paymentAttempts) -- e o recheck-dentro-da-transacao
// que impede duas tentativas concorrentes de "roubarem" o mesmo numero de
// tentativa, ou de uma tentativa entrar depois que a reserva ja foi
// resolvida (aprovada ou esgotada) por outra corrida. Como o claim ja
// serializa o acesso (lock de linha do Postgres dura ate o fim da
// transacao), a atualizacao final de status depois da cobranca nao precisa
// de outro recheck -- ninguem mais consegue estar "no meio" dessa mesma
// reserva ao mesmo tempo.
export function processPayment(input: ProcessPaymentInput) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.ticketReservation.updateMany({
      where: { id: input.reservationId, status: "PENDING_PAYMENT", paymentAttempts: { lt: MAX_PAYMENT_ATTEMPTS } },
      data: { paymentAttempts: { increment: 1 } },
    });

    if (claim.count !== 1) {
      throw new AppError("Pagamento já processado ou reserva não está aguardando pagamento.", 409);
    }

    const reservation = await tx.ticketReservation.findUniqueOrThrow({
      where: { id: input.reservationId },
      select: { paymentAttempts: true },
    });
    const attempt = reservation.paymentAttempts;
    const isFinalAttempt = attempt >= MAX_PAYMENT_ATTEMPTS;

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
      // Nas tentativas 1 e 2, a reserva continua PENDING_PAYMENT e o
      // assento continua RESERVED de proposito -- so a tentativa final
      // libera o assento e fecha a reserva (ver comentario acima).
      if (!isFinalAttempt) {
        return {
          payment,
          reservationStatus: "PENDING_PAYMENT" as const,
          tickets: [],
          attempt,
          maxAttempts: MAX_PAYMENT_ATTEMPTS,
        };
      }

      await tx.ticketReservation.update({
        where: { id: input.reservationId },
        data: { status: "PAYMENT_DECLINED" },
      });
      await tx.eventSeat.updateMany({
        where: { id: { in: input.seatIds }, status: "RESERVED" },
        data: { status: "AVAILABLE" },
      });

      return {
        payment,
        reservationStatus: "PAYMENT_DECLINED" as const,
        tickets: [],
        attempt,
        maxAttempts: MAX_PAYMENT_ATTEMPTS,
      };
    }

    await tx.ticketReservation.update({ where: { id: input.reservationId }, data: { status: "PAID" } });
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

    return {
      payment,
      reservationStatus: "PAID" as const,
      tickets,
      attempt,
      maxAttempts: MAX_PAYMENT_ATTEMPTS,
    };
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
