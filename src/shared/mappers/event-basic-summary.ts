import type { Event } from "../../../generated/prisma/client.js";

// Projecao minima de Event reusada por qualquer mapper que so precisa do
// resumo basico (tickets, gate) -- evita reimplementar o mesmo literal em
// cada modulo.
export function toEventBasicSummary(event: Event) {
  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    venue: event.venue,
    room: event.room,
  };
}
