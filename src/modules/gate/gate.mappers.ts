import { toEventBasicSummary } from "../../shared/mappers/event-basic-summary.js";
import type { Event, EventSeat, Ticket, ValidationResult } from "../../../generated/prisma/client.js";

type TicketRow = Ticket & { event: Event; eventSeat: EventSeat };

// Usado pelo "descobrir o evento" (GET /gate/tickets/:code/event) -- so o
// suficiente pra portaria auto-selecionar o evento certo na tela, nunca
// dados do dono do ticket.
export function toTicketEventSummary(ticket: Pick<TicketRow, "event">) {
  return toEventBasicSummary(ticket.event);
}

// VALID expõe o detalhe util pra portaria (evento + assento). WRONG_EVENT
// e ALREADY_USED expõem so um resumo basico (id/code/evento) -- o
// suficiente pra portaria mostrar "esse ingresso e de outro evento" ou "ja
// foi usado", sem vazar dados do dono do ticket (nome, e-mail, customerId).
// INVALID (ou ticket nao encontrado) nunca expõe nada alem do motivo.
//
// `reason` sai sempre na resposta (nao so no log de auditoria) pra o
// frontend diferenciar os varios motivos de INVALID (codigo inexistente,
// QR forjado, cancelado, fora da janela de entrada etc.) sem precisar
// adivinhar a partir so do `result`.
export function toValidationResponse(
  result: ValidationResult,
  ticket: TicketRow | null,
  reason: string | null = null,
) {
  if (result === "INVALID" || !ticket) {
    return { result, ticket: null, reason };
  }

  if (result === "VALID") {
    return {
      result,
      ticket: {
        id: ticket.id,
        code: ticket.code,
        event: { id: ticket.event.id, title: ticket.event.title },
        seat: { id: ticket.eventSeat.id, code: ticket.eventSeat.code },
        usedAt: ticket.usedAt,
      },
      reason,
    };
  }

  return {
    result,
    ticket: {
      id: ticket.id,
      code: ticket.code,
      event: { id: ticket.event.id, title: ticket.event.title },
    },
    reason,
  };
}
