import { prisma } from "../../shared/prisma/client.js";
import type { Prisma } from "../../../generated/prisma/client.js";

const ticketDetailInclude = {
  event: true,
  eventSeat: true,
} satisfies Prisma.TicketInclude;

// UC13 - Visualizar Meus Ingressos: mais proximos primeiro.
export function findManyByCustomer(customerId: string) {
  return prisma.ticket.findMany({
    where: { customerId },
    include: ticketDetailInclude,
    orderBy: { event: { startsAt: "asc" } },
  });
}

export function findByIdAndCustomer(id: string, customerId: string) {
  return prisma.ticket.findFirst({
    where: { id, customerId },
    include: ticketDetailInclude,
  });
}

export function createShareLink(ticketId: string, tokenHash: string) {
  return prisma.ticketShareLink.create({
    data: { ticketId, tokenHash },
  });
}

// UC15 - visualizacao compartilhada: nunca revela um ticket via link
// revogado ou vencido, mesmo que o hash bata.
export async function findByShareTokenHash(tokenHash: string) {
  const link = await prisma.ticketShareLink.findUnique({
    where: { tokenHash },
    include: { ticket: { include: ticketDetailInclude } },
  });

  if (!link || link.revokedAt) {
    return null;
  }

  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    return null;
  }

  return link.ticket;
}
