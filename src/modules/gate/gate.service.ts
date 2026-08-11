import { AppError } from "../../shared/errors/app-error.js";
import { signTicketQr } from "../../shared/security/ticket-qr.js";
import * as gateRepository from "./gate.repository.js";
import { toTicketEventSummary, toValidationResponse } from "./gate.mappers.js";
import type { ValidateTicketBody } from "./gate.schemas.js";

type ValidateTicketInput = ValidateTicketBody & { gateUserId: string };

// Leitura pura, nao consome nada e nao grava GateValidation -- so serve
// pra portaria descobrir a qual evento um codigo pertence antes de
// escolher o evento na tela (ver gate/README.md, "descobrir o evento
// automaticamente"). eventId continua obrigatorio em validateTicket
// (mantem WRONG_EVENT funcionando); este endpoint e usado so na primeira
// leitura de um turno, pra auto-selecionar o evento certo.
export async function resolveTicketEvent(code: string) {
  const ticket = await gateRepository.findTicketByCode(code);
  if (!ticket) {
    throw new AppError("Ingresso não encontrado.", 404);
  }
  return toTicketEventSummary(ticket);
}

// UC16-20 (guiado pela skill reserva-segura: "nunca validar ticket apenas
// pelo frontend", "bloqueio de segundo uso na portaria"). Entrada
// automatica: validar como VALID ja marca USED no mesmo request, sem uma
// segunda chamada de "confirmar entrada".
export async function validateTicket(input: ValidateTicketInput) {
  const inputMethod = input.token ? "QR_CAMERA" : "MANUAL_CODE";

  const ticket = await gateRepository.findTicketByCode(input.code);

  if (!ticket) {
    await gateRepository.logValidation({
      ticketId: null,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "INVALID",
      reason: "Código não encontrado.",
    });
    return toValidationResponse("INVALID", null);
  }

  // token presente = leitura por camera do qrValue "<code>.<hmac>" (o
  // frontend ja separou); recalcula o HMAC a partir do ticket.id encontrado
  // e compara, mesmo raciocinio documentado em ticket-qr.ts.
  if (input.token && signTicketQr(ticket.id) !== input.token) {
    await gateRepository.logValidation({
      ticketId: ticket.id,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "INVALID",
      reason: "QR não autêntico.",
    });
    return toValidationResponse("INVALID", null);
  }

  if (ticket.eventId !== input.eventId) {
    await gateRepository.logValidation({
      ticketId: ticket.id,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "WRONG_EVENT",
      reason: "Ingresso de outro evento.",
    });
    return toValidationResponse("WRONG_EVENT", ticket);
  }

  if (ticket.status === "USED") {
    await gateRepository.logValidation({
      ticketId: ticket.id,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "ALREADY_USED",
      reason: "Ingresso já utilizado.",
    });
    return toValidationResponse("ALREADY_USED", ticket);
  }

  if (ticket.status === "CANCELLED") {
    await gateRepository.logValidation({
      ticketId: ticket.id,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "INVALID",
      reason: "Ingresso cancelado.",
    });
    return toValidationResponse("INVALID", null);
  }

  const marked = await gateRepository.markUsedAndLog({
    ticketId: ticket.id,
    gateUserId: input.gateUserId,
    checkedEventId: input.eventId,
    inputMethod,
  });

  if (!marked.usedNow) {
    return toValidationResponse("ALREADY_USED", ticket);
  }

  return toValidationResponse("VALID", marked.ticket);
}
