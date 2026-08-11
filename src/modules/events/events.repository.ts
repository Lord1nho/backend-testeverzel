import { AppError } from "../../shared/errors/app-error.js";
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

// Visao publica (ator Cliente, UC7/UC9/UC11) -- so evento PUBLISHED, sem
// filtro de organizador (qualquer cliente pode ver qualquer evento publicado).
export function findManyPublished() {
  return prisma.event.findMany({
    where: { status: "PUBLISHED" },
    include: eventListInclude,
    orderBy: { startsAt: "asc" },
  });
}

export function findPublishedById(id: string) {
  return prisma.event.findFirst({
    where: { id, status: "PUBLISHED" },
    include: eventDetailInclude,
  });
}

// Checagem leve de existencia/publicacao, usada pra nao buscar seats duas
// vezes (getPublishedEventSeats ja busca os seats separadamente).
export function findPublishedRawById(id: string) {
  return prisma.event.findFirst({
    where: { id, status: "PUBLISHED" },
    select: { id: true },
  });
}

// Usado pelo modulo reservations pra validar o evento antes de reservar
// assento (UC10) sem puxar a lista de seats inteira, que o reservations
// nao precisa (ele so precisa do preco e do horario).
export function findPublishedEventForReservation(id: string) {
  return prisma.event.findFirst({
    where: { id, status: "PUBLISHED" },
    select: { id: true, price: true, startsAt: true },
  });
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

// Serializable (nao o default Read Committed): o organizador que exclui o
// evento e um pagamento que aprova (ou uma reserva nova que entra) pro
// mesmo evento, ao mesmo tempo, sao duas transacoes concorrentes
// completamente separadas -- Read Committed deixaria as duas seguirem em
// frente e so estourar depois numa violacao de FK crua (500). Com
// Serializable, o Postgres detecta esse conflito entre as duas transacoes
// e aborta uma delas com erro de serializacao (Prisma P2034), que o
// service converte num 409 limpo. O recheck de reserva PAID tambem entra
// aqui dentro (nao so no service) pra fechar essa mesma janela.
export function deleteEventWithSeats(eventId: string) {
  return prisma.$transaction(
    async (tx) => {
      const paidReservations = await tx.ticketReservation.count({ where: { eventId, status: "PAID" } });
      if (paidReservations > 0) {
        throw new AppError("Evento com reservas pagas não pode ser excluído.", 400);
      }

      // Filtra pela relacao direto no banco, sem precisar de um findMany +
      // snapshot de IDs em JS antes (o snapshot ficaria desatualizado se uma
      // reserva nova entrasse pro evento no meio da transacao).
      await tx.gateValidation.deleteMany({ where: { checkedEventId: eventId } });
      await tx.simulatedPayment.deleteMany({ where: { reservation: { eventId } } });
      await tx.reservationItem.deleteMany({ where: { eventSeat: { eventId } } });
      await tx.ticketReservation.deleteMany({ where: { eventId } });
      await tx.eventSeat.deleteMany({ where: { eventId } });
      await tx.event.delete({ where: { id: eventId } });
    },
    { isolationLevel: "Serializable" },
  );
}
