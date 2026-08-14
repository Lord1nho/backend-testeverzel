import type { Event, EventSeat, ExternalCatalogItem } from "../../../generated/prisma/client.js";

type EventListRow = Event & {
  catalogItem: ExternalCatalogItem;
  _count: { seats: number };
};

type EventDetailRow = Event & {
  catalogItem: ExternalCatalogItem;
  seats: EventSeat[];
};

const DEFAULT_SESSION_DURATION_MINUTES = 120;
const TRAILERS_BUFFER_MINUTES = 10;

export type SessionStatus = "SCHEDULED" | "STARTED" | "ENDED";

// Derivado, nunca gravado no banco: status da sessao a partir do horario de
// inicio + duracao do filme + 10min fixos simulando trailers. Se a TMDB nao
// informar duracao (null/0 em alguns titulos), usa 120min so pro calculo.
export function computeSessionStatus(
  startsAt: Date,
  durationMinutes: number | null | undefined,
): { sessionStatus: SessionStatus; sessionEndsAt: Date } {
  const effectiveDuration =
    durationMinutes && durationMinutes > 0 ? durationMinutes : DEFAULT_SESSION_DURATION_MINUTES;
  const totalMinutes = effectiveDuration + TRAILERS_BUFFER_MINUTES;
  const sessionEndsAt = new Date(startsAt.getTime() + totalMinutes * 60 * 1000);

  const now = Date.now();
  let sessionStatus: SessionStatus;
  if (now < startsAt.getTime()) {
    sessionStatus = "SCHEDULED";
  } else if (now < sessionEndsAt.getTime()) {
    sessionStatus = "STARTED";
  } else {
    sessionStatus = "ENDED";
  }

  return { sessionStatus, sessionEndsAt };
}

export function toEventSummary(event: EventListRow) {
  const { sessionStatus, sessionEndsAt } = computeSessionStatus(
    event.startsAt,
    event.catalogItem.durationMinutes,
  );

  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    venue: event.venue,
    room: event.room,
    capacity: event.capacity,
    price: Number(event.price),
    status: event.status,
    sessionStatus,
    sessionEndsAt,
    seatsAvailable: event._count.seats,
    catalogItem: {
      id: event.catalogItem.id,
      title: event.catalogItem.title,
      imageUrl: event.catalogItem.imageUrl,
    },
    createdAt: event.createdAt,
  };
}

export function toEventDetail(event: EventDetailRow) {
  const { sessionStatus, sessionEndsAt } = computeSessionStatus(
    event.startsAt,
    event.catalogItem.durationMinutes,
  );

  return {
    id: event.id,
    organizerId: event.organizerId,
    title: event.title,
    startsAt: event.startsAt,
    venue: event.venue,
    room: event.room,
    capacity: event.capacity,
    price: Number(event.price),
    status: event.status,
    sessionStatus,
    sessionEndsAt,
    seatsTotal: event.seats.length,
    seatsAvailable: event.seats.filter((seat) => seat.status === "AVAILABLE").length,
    catalogItem: {
      id: event.catalogItem.id,
      provider: event.catalogItem.provider,
      externalId: event.catalogItem.externalId,
      type: event.catalogItem.type,
      title: event.catalogItem.title,
      imageUrl: event.catalogItem.imageUrl,
      description: event.catalogItem.description,
      durationMinutes: event.catalogItem.durationMinutes,
    },
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export function toEventSeat(seat: EventSeat) {
  return {
    id: seat.id,
    code: seat.code,
    status: seat.status,
  };
}

const SEAT_CODE_PATTERN = /^([A-Z])(\d+)$/;

// "A10" < "A2" em ordenacao de string -- compara letra e numero
// separadamente pra devolver a lista na ordem visual esperada.
export function sortSeatsByCode<T extends { code: string }>(seats: T[]): T[] {
  return [...seats].sort((a, b) => {
    const matchA = SEAT_CODE_PATTERN.exec(a.code);
    const matchB = SEAT_CODE_PATTERN.exec(b.code);
    if (!matchA || !matchB) {
      return a.code.localeCompare(b.code);
    }
    const [, letterA, numberA] = matchA;
    const [, letterB, numberB] = matchB;
    return letterA === letterB ? Number(numberA) - Number(numberB) : letterA.localeCompare(letterB);
  });
}
