import { AppError } from "../../shared/errors/app-error.js";
import { computeSessionStatus } from "../events/events.mappers.js";
import { signTicketQr } from "../../shared/security/ticket-qr.js";
import * as gateRepository from "./gate.repository.js";
import { toTicketEventSummary, toValidationResponse } from "./gate.mappers.js";
import type { ValidateTicketBody } from "./gate.schemas.js";

type ValidateTicketInput = ValidateTicketBody & { gateUserId: string };

// Portaria so libera a entrada a partir de 20min antes do inicio -- fora
// disso (regras de janela de sessao, nao regra de UC16-20 original).
const EARLY_ENTRY_WINDOW_MINUTES = 20;

function isSameCalendarDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

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
    const reason = "Código não encontrado.";
    await gateRepository.logValidation({
      ticketId: null,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "INVALID",
      reason,
    });
    return toValidationResponse("INVALID", null, reason);
  }

  // token presente = leitura por camera do qrValue "<code>.<hmac>" (o
  // frontend ja separou); recalcula o HMAC a partir do ticket.id encontrado
  // e compara, mesmo raciocinio documentado em ticket-qr.ts.
  if (input.token && signTicketQr(ticket.id) !== input.token) {
    const reason = "QR não autêntico.";
    await gateRepository.logValidation({
      ticketId: ticket.id,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "INVALID",
      reason,
    });
    return toValidationResponse("INVALID", null, reason);
  }

  if (ticket.eventId !== input.eventId) {
    const reason = "Ingresso de outro evento.";
    await gateRepository.logValidation({
      ticketId: ticket.id,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "WRONG_EVENT",
      reason,
    });
    return toValidationResponse("WRONG_EVENT", ticket, reason);
  }

  if (ticket.status === "USED") {
    const reason = "Ingresso já utilizado.";
    await gateRepository.logValidation({
      ticketId: ticket.id,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "ALREADY_USED",
      reason,
    });
    return toValidationResponse("ALREADY_USED", ticket, reason);
  }

  if (ticket.status === "CANCELLED") {
    const reason = "Ingresso cancelado.";
    await gateRepository.logValidation({
      ticketId: ticket.id,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "INVALID",
      reason,
    });
    return toValidationResponse("INVALID", null, reason);
  }

  const now = new Date();
  const earlyWindowStart = new Date(
    ticket.event.startsAt.getTime() - EARLY_ENTRY_WINDOW_MINUTES * 60 * 1000,
  );

  if (now < earlyWindowStart) {
    const reason = isSameCalendarDate(now, ticket.event.startsAt)
      ? "Entrada ainda não liberada. Aguarde até 20 minutos antes do início da sessão."
      : "Ingresso é para outra data de sessão.";
    await gateRepository.logValidation({
      ticketId: ticket.id,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "INVALID",
      reason,
    });
    return toValidationResponse("INVALID", null, reason);
  }

  const { sessionStatus } = computeSessionStatus(
    ticket.event.startsAt,
    ticket.event.catalogItem.durationMinutes,
  );

  if (sessionStatus === "ENDED") {
    const reason = "Sessão encerrada. Entrada não é mais permitida.";
    await gateRepository.logValidation({
      ticketId: ticket.id,
      gateUserId: input.gateUserId,
      checkedEventId: input.eventId,
      inputMethod,
      result: "INVALID",
      reason,
    });
    return toValidationResponse("INVALID", null, reason);
  }

  const marked = await gateRepository.markUsedAndLog({
    ticketId: ticket.id,
    gateUserId: input.gateUserId,
    checkedEventId: input.eventId,
    inputMethod,
  });

  if (!marked.usedNow) {
    const reason = "Ingresso já utilizado (corrida concorrente).";
    return toValidationResponse("ALREADY_USED", ticket, reason);
  }

  return toValidationResponse("VALID", marked.ticket, null);
}
