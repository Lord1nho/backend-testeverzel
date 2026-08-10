import { createHmac } from "node:crypto";

import { env } from "../../config/env.js";

// Assinatura HMAC-SHA256 deterministica (nao um segredo aleatorio guardado
// so como hash) -- recalculavel a qualquer momento a partir do ticket.id,
// pra UC14 conseguir exibir o QR de novo sempre que o Cliente abrir o
// ingresso, nao so uma vez na emissao. Imprevisivel/nao forjavel sem
// TICKET_QR_SECRET, mesmo racicionio de um JWT assinado.
export function signTicketQr(ticketId: string) {
  return createHmac("sha256", env.TICKET_QR_SECRET).update(ticketId).digest("hex");
}

// "<code>.<hmac>": code acha o ticket rapido (@unique), o HMAC garante
// autenticidade. Formato pensado pro futuro modulo gate: le o code, acha o
// ticket, recalcula o HMAC a partir do ticket.id encontrado e compara.
export function buildQrValue(code: string, ticketId: string) {
  return `${code}.${signTicketQr(ticketId)}`;
}
