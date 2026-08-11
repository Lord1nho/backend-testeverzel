import { buildQrValue } from "../../shared/security/ticket-qr.js";
import type { Event, EventSeat, Ticket } from "../../../generated/prisma/client.js";

type TicketRow = Ticket & { event: Event; eventSeat: EventSeat };

export function toTicketSummary(ticket: TicketRow) {
  return {
    id: ticket.id,
    status: ticket.status,
    code: ticket.code,
    issuedAt: ticket.issuedAt,
    usedAt: ticket.usedAt,
    event: {
      id: ticket.event.id,
      title: ticket.event.title,
      startsAt: ticket.event.startsAt,
      venue: ticket.event.venue,
      room: ticket.event.room,
    },
    seat: { id: ticket.eventSeat.id, code: ticket.eventSeat.code },
  };
}

// qrValue e recalculado a cada chamada (HMAC deterministico sobre
// ticket.id, ver ticket-qr.ts) -- nunca lido de qrTokenHash, entao o
// Cliente sempre consegue ver o QR de novo, nao so uma vez na emissao.
export function toTicketDetail(ticket: TicketRow) {
  return {
    ...toTicketSummary(ticket),
    qrValue: buildQrValue(ticket.code, ticket.id),
  };
}

// Mesmo shape do detail -- funcao separada de proposito, pra deixar
// explicito no ponto de chamada (rota publica) que essa e a versao segura
// pra expor sem autenticacao, caso precise divergir do detail no futuro.
export function toSharedTicketView(ticket: TicketRow) {
  return toTicketDetail(ticket);
}
