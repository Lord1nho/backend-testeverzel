import { prisma } from "../../shared/prisma/client.js";
import type { Prisma, Venue } from "../../../generated/prisma/client.js";

type CatalogSnapshotInput = {
  provider: "TMDB";
  externalId: string;
  type: "MOVIE";
  title: string;
  imageUrl: string | null;
  description: string | null;
  durationMinutes: number | null;
  rawPayload: Prisma.InputJsonValue;
};

type CreateEventInput = {
  organizerId: string;
  title: string;
  startsAt: Date;
  venue: Venue;
  room: number;
  capacity: number;
  price: number;
  seatCodes: string[];
};

const eventDetailInclude = {
  catalogItem: true,
  seats: true,
} satisfies Prisma.EventInclude;

const eventListInclude = {
  catalogItem: true,
  _count: { select: { seats: { where: { status: "AVAILABLE" } } } },
} satisfies Prisma.EventInclude;

export function createEventWithCatalogSnapshot(
  catalogSnapshot: CatalogSnapshotInput,
  eventInput: CreateEventInput,
) {
  return prisma.$transaction(async (tx) => {
    const catalogItem = await tx.externalCatalogItem.upsert({
      where: {
        provider_externalId: {
          provider: catalogSnapshot.provider,
          externalId: catalogSnapshot.externalId,
        },
      },
      update: {
        title: catalogSnapshot.title,
        imageUrl: catalogSnapshot.imageUrl,
        description: catalogSnapshot.description,
        durationMinutes: catalogSnapshot.durationMinutes,
        rawPayload: catalogSnapshot.rawPayload,
      },
      create: catalogSnapshot,
    });

    const event = await tx.event.create({
      data: {
        organizerId: eventInput.organizerId,
        catalogItemId: catalogItem.id,
        title: eventInput.title,
        startsAt: eventInput.startsAt,
        venue: eventInput.venue,
        room: eventInput.room,
        capacity: eventInput.capacity,
        price: eventInput.price,
      },
    });

    await tx.eventSeat.createMany({
      data: eventInput.seatCodes.map((code) => ({
        eventId: event.id,
        code,
        status: "AVAILABLE",
      })),
    });

    return tx.event.findUniqueOrThrow({
      where: { id: event.id },
      include: eventDetailInclude,
    });
  });
}

export function findManyByOrganizer(organizerId: string) {
  return prisma.event.findMany({
    where: { organizerId },
    include: eventListInclude,
    orderBy: { startsAt: "asc" },
  });
}

// Usado pelo helper de ownership do service. Inclui catalogItem (so
// durationMinutes) porque publishEvent/updateEvent (ramo PUBLISHED)
// precisam da duracao do proprio evento pra checar conflito de horario.
export function findRawByIdAndOrganizer(id: string, organizerId: string) {
  return prisma.event.findFirst({
    where: { id, organizerId },
    include: { catalogItem: { select: { durationMinutes: true } } },
  });
}

// Candidatos a conflito de horario: eventos PUBLISHED na mesma venue+room,
// excluindo o proprio evento. So PUBLISHED "ocupa" a sala -- DRAFT nunca
// aparece aqui por decisao de negocio.
export function findPublishedEventsInVenueRoom(venue: Venue, room: number, excludeEventId: string) {
  return prisma.event.findMany({
    where: {
      venue,
      room,
      status: "PUBLISHED",
      id: { not: excludeEventId },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      catalogItem: { select: { durationMinutes: true } },
    },
  });
}

export function findDetailByIdAndOrganizer(id: string, organizerId: string) {
  return prisma.event.findFirst({
    where: { id, organizerId },
    include: eventDetailInclude,
  });
}

export function findSeatsByEventId(eventId: string) {
  return prisma.eventSeat.findMany({ where: { eventId } });
}

export function updateEventFields(eventId: string, data: Prisma.EventUpdateInput) {
  return prisma.event.update({
    where: { id: eventId },
    data,
    include: eventDetailInclude,
  });
}

export function updateCapacityAndRegenerateSeats(
  eventId: string,
  newCapacity: number,
  seatCodes: string[],
  otherFields: Prisma.EventUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    await tx.eventSeat.deleteMany({ where: { eventId } });

    await tx.event.update({
      where: { id: eventId },
      data: { ...otherFields, capacity: newCapacity },
    });

    await tx.eventSeat.createMany({
      data: seatCodes.map((code) => ({ eventId, code, status: "AVAILABLE" })),
    });

    return tx.event.findUniqueOrThrow({
      where: { id: eventId },
      include: eventDetailInclude,
    });
  });
}

export function publishEvent(eventId: string) {
  return prisma.event.update({
    where: { id: eventId },
    data: { status: "PUBLISHED" },
    include: eventDetailInclude,
  });
}

export async function hasPaidReservation(eventId: string) {
  const count = await prisma.ticketReservation.count({
    where: { eventId, status: "PAID" },
  });
  return count > 0;
}

export function deleteEventWithSeats(eventId: string) {
  return prisma.$transaction(async (tx) => {
    // ON DELETE RESTRICT em event_seats.event_id -> events.id: precisa
    // apagar os seats primeiro, na mesma transacao, senao o delete do
    // Event falha com violacao de FK.
    await tx.eventSeat.deleteMany({ where: { eventId } });
    await tx.event.delete({ where: { id: eventId } });
  });
}
