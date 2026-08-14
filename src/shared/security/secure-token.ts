import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTE_LENGTH = 32;

// Segredo de alta entropia, revelado uma unica vez (ex: TicketShareLink) --
// so o hash e persistido, nunca o valor puro.
export function generateSecureToken() {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Alfabeto sem caracteres ambiguos (sem 0/O, 1/I/L) -- codigo curto,
// digitavel na portaria, guardado em texto puro (Ticket.code).
const TICKET_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TICKET_CODE_LENGTH = 8;

export function generateTicketCode() {
  const bytes = randomBytes(TICKET_CODE_LENGTH);
  let code = "";
  for (let index = 0; index < TICKET_CODE_LENGTH; index += 1) {
    code += TICKET_CODE_ALPHABET[bytes[index] % TICKET_CODE_ALPHABET.length];
  }
  return code;
}
