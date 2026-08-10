import { signTicketQr } from "../../shared/security/ticket-qr.js";
import * as gateRepository from "./gate.repository.js";
import { toValidationResponse } from "./gate.mappers.js";
import type { ValidateTicketBody } from "./gate.schemas.js";

type ValidateTicketInput = ValidateTicketBody & { gateUserId: string };

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
      reason: "Codigo nao encontrado.",
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
      reason: "QR nao autentico.",
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
      reason: "Ingresso ja utilizado.",
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
