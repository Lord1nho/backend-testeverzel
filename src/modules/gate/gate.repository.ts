import { prisma } from "../../shared/prisma/client.js";
import type { Prisma, ValidationInputMethod, ValidationResult } from "../../../generated/prisma/client.js";

const ticketWithDetailsInclude = {
  event: { include: { catalogItem: true } },
  eventSeat: true,
} satisfies Prisma.TicketInclude;

export function findTicketByCode(code: string) {
  return prisma.ticket.findUnique({
    where: { code },
    include: ticketWithDetailsInclude,
  });
}

type LogValidationInput = {
  ticketId: string | null;
  gateUserId: string;
  checkedEventId: string;
  inputMethod: ValidationInputMethod;
  result: ValidationResult;
  reason: string | null;
};

export function logValidation(input: LogValidationInput) {
  return prisma.gateValidation.create({ data: input });
}

type MarkUsedInput = {
  ticketId: string;
  gateUserId: string;
  checkedEventId: string;
  inputMethod: ValidationInputMethod;
};

// Passo final (skill reserva-segura: "bloqueio de segundo uso na
// portaria"). UPDATE condicional (WHERE status = 'VALID') + log de
// auditoria na mesma transacao -- se o count vier 0, outra validacao
// concorrente do mesmo ticket ja venceu primeiro; o service trata como
// ALREADY_USED em vez de VALID.
export function markUsedAndLog(input: MarkUsedInput) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.updateMany({
      where: { id: input.ticketId, status: "VALID" },
      data: { status: "USED", usedAt: new Date() },
    });

    if (updated.count !== 1) {
      await tx.gateValidation.create({
        data: {
          ticketId: input.ticketId,
          gateUserId: input.gateUserId,
          checkedEventId: input.checkedEventId,
          inputMethod: input.inputMethod,
          result: "ALREADY_USED",
          reason: "Ingresso já utilizado (corrida concorrente).",
        },
      });
      return { usedNow: false as const };
    }

    const ticket = await tx.ticket.findUniqueOrThrow({
      where: { id: input.ticketId },
      include: ticketWithDetailsInclude,
    });

    await tx.gateValidation.create({
      data: {
        ticketId: input.ticketId,
        gateUserId: input.gateUserId,
        checkedEventId: input.checkedEventId,
        inputMethod: input.inputMethod,
        result: "VALID",
        reason: null,
      },
    });

    return { usedNow: true as const, ticket };
  });
}
