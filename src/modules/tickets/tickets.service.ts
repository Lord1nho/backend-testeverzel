import { AppError } from "../../shared/errors/app-error.js";
import { generateSecureToken, hashToken } from "../../shared/security/secure-token.js";
import { toSharedTicketView, toTicketDetail, toTicketSummary } from "./tickets.mappers.js";
import * as ticketsRepository from "./tickets.repository.js";

// UC13 - Visualizar Meus Ingressos.
export async function listMyTickets(customerId: string) {
  const tickets = await ticketsRepository.findManyByCustomer(customerId);
  return tickets.map(toTicketSummary);
}

// UC14 - Visualizar Ingresso.
export async function getTicketById(customerId: string, ticketId: string) {
  const ticket = await ticketsRepository.findByIdAndCustomer(ticketId, customerId);
  if (!ticket) {
    throw new AppError("Ingresso nao encontrado.", 404);
  }
  return toTicketDetail(ticket);
}

// UC15 - Compartilhar Ingresso por Link. O token puro so existe nesta
// resposta -- so o hash e persistido (mesmo padrao de password_hash).
export async function createShareLink(customerId: string, ticketId: string) {
  const ticket = await ticketsRepository.findByIdAndCustomer(ticketId, customerId);
  if (!ticket) {
    throw new AppError("Ingresso nao encontrado.", 404);
  }

  const rawToken = generateSecureToken();
  const shareLink = await ticketsRepository.createShareLink(ticket.id, hashToken(rawToken));

  return { token: rawToken, expiresAt: shareLink.expiresAt };
}

// UC15 - visualizacao publica via link compartilhado, sem autenticacao.
export async function getSharedTicket(rawToken: string) {
  const ticket = await ticketsRepository.findByShareTokenHash(hashToken(rawToken));
  if (!ticket) {
    throw new AppError("Link de compartilhamento invalido ou expirado.", 404);
  }
  return toSharedTicketView(ticket);
}
