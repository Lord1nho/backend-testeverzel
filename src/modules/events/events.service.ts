import { AppError } from "../../shared/errors/app-error.js";
import * as catalogService from "../catalog/catalog.service.js";
import * as eventsRepository from "./events.repository.js";
import { computeSessionStatus, sortSeatsByCode, toEventDetail, toEventSeat, toEventSummary } from "./events.mappers.js";
import type { CreateEventBody, UpdateEventBody } from "./events.schemas.js";
import type { Prisma, Venue } from "../../../generated/prisma/client.js";

const SEAT_ROW_SIZE = 10;

// Convencao de codigo: linhas de 10 assentos, A1..A10, B1..B10, ...
// (capacity ja e validada <= 260 no schema, entao nunca estoura Z).
function generateSeatCodes(capacity: number): string[] {
  const codes: string[] = [];
  for (let index = 0; index < capacity; index += 1) {
    const rowLetter = String.fromCharCode("A".charCodeAt(0) + Math.floor(index / SEAT_ROW_SIZE));
    const seatNumber = (index % SEAT_ROW_SIZE) + 1;
    codes.push(`${rowLetter}${seatNumber}`);
  }
  return codes;
}

// Reusado por get/update/publish/delete/seats. 404 (nao 403) quando o
// evento nao existe OU pertence a outro organizador -- nao vaza pra
// outros organizadores que o ID existe.
async function findOwnedEventOrThrow(eventId: string, organizerId: string) {
  const event = await eventsRepository.findRawByIdAndOrganizer(eventId, organizerId);
  if (!event) {
    throw new AppError("Evento nao encontrado.", 404);
  }
  return event;
}

// So chamado quando o evento ja e (ou esta virando) PUBLISHED. Busca os
// outros eventos PUBLISHED na mesma venue+room e checa overlap de janela
// via a mesma formula de computeSessionStatus usada no resto do modulo
// (evento novo/editado x cada candidato). Lanca 409 (nao 400 -- e uma
// colisao de agenda, nao erro de validacao de campo) no primeiro conflito
// encontrado.
async function assertNoScheduleConflict(input: {
  venue: Venue;
  room: number;
  startsAt: Date;
  durationMinutes: number | null;
  excludeEventId: string;
}) {
  const candidates = await eventsRepository.findPublishedEventsInVenueRoom(
    input.venue,
    input.room,
    input.excludeEventId,
  );

  const { sessionEndsAt: newEnd } = computeSessionStatus(input.startsAt, input.durationMinutes);
  const newStart = input.startsAt;

  for (const candidate of candidates) {
    const { sessionEndsAt: otherEnd } = computeSessionStatus(
      candidate.startsAt,
      candidate.catalogItem.durationMinutes,
    );
    const otherStart = candidate.startsAt;

    const overlaps = newStart.getTime() < otherEnd.getTime() && otherStart.getTime() < newEnd.getTime();
    if (overlaps) {
      throw new AppError(
        `Conflito de horario: a sala ${input.room} (${input.venue}) ja tem a sessao "${candidate.title}" ` +
          `agendada nesse periodo (${otherStart.toISOString()} a ${otherEnd.toISOString()}).`,
        409,
      );
    }
  }
}

export async function createEvent(organizerId: string, body: CreateEventBody) {
  // Snapshot vem do TMDB, nunca do client -- catalogService.getMovieDetails
  // ja lanca AppError 404/429/502 se o TMDB falhar, so deixamos propagar.
  const movie = await catalogService.getMovieDetails(body.tmdbId);

  const seatCodes = generateSeatCodes(body.capacity);

  const event = await eventsRepository.createEventWithCatalogSnapshot(
    {
      provider: "TMDB",
      externalId: String(body.tmdbId),
      type: "MOVIE",
      title: movie.title,
      imageUrl: movie.posterUrl,
      description: movie.overview,
      durationMinutes: movie.runtime,
      rawPayload: movie as unknown as Prisma.InputJsonValue,
    },
    {
      organizerId,
      title: body.title?.trim() || movie.title,
      startsAt: new Date(body.startsAt),
      venue: body.venue,
      room: body.room,
      capacity: body.capacity,
      price: body.price,
      seatCodes,
    },
  );

  return toEventDetail(event);
}

export async function listEvents(organizerId: string) {
  const events = await eventsRepository.findManyByOrganizer(organizerId);
  return events.map(toEventSummary);
}

export async function getEventById(eventId: string, organizerId: string) {
  await findOwnedEventOrThrow(eventId, organizerId);
  const event = await eventsRepository.findDetailByIdAndOrganizer(eventId, organizerId);
  return toEventDetail(event!);
}

export async function getEventSeats(eventId: string, organizerId: string) {
  await findOwnedEventOrThrow(eventId, organizerId);
  const seats = await eventsRepository.findSeatsByEventId(eventId);
  return sortSeatsByCode(seats).map(toEventSeat);
}

export async function updateEvent(eventId: string, organizerId: string, body: UpdateEventBody) {
  const event = await findOwnedEventOrThrow(eventId, organizerId);

  if (event.startsAt.getTime() < Date.now()) {
    throw new AppError("Evento com data passada nao pode ser editado.", 400);
  }

  if (body.capacity !== undefined && event.status !== "DRAFT") {
    throw new AppError("Capacidade so pode ser alterada enquanto o evento estiver em rascunho.", 400);
  }

  const changesLockedFields = body.startsAt !== undefined || body.venue !== undefined || body.room !== undefined;
  if (changesLockedFields) {
    const hasPaidReservation = await eventsRepository.hasPaidReservation(eventId);
    if (hasPaidReservation) {
      throw new AppError("Evento com reservas pagas nao pode ter data, venue ou sala alterados.", 400);
    }

    // So checa conflito se o evento ja esta PUBLISHED -- DRAFT e livre por
    // decisao de negocio (rascunho nao ocupa sala, ninguem bloqueia nem e
    // bloqueado). Se chegou aqui, ja sabemos que nao ha reserva paga.
    if (event.status === "PUBLISHED") {
      const effectiveStartsAt = body.startsAt !== undefined ? new Date(body.startsAt) : event.startsAt;
      const effectiveVenue = body.venue !== undefined ? body.venue : event.venue;
      const effectiveRoom = body.room !== undefined ? body.room : event.room;

      await assertNoScheduleConflict({
        venue: effectiveVenue,
        room: effectiveRoom,
        startsAt: effectiveStartsAt,
        durationMinutes: event.catalogItem.durationMinutes,
        excludeEventId: event.id,
      });
    }
  }

  const fields: Prisma.EventUpdateInput = {};
  if (body.title !== undefined) fields.title = body.title;
  if (body.startsAt !== undefined) fields.startsAt = new Date(body.startsAt);
  if (body.venue !== undefined) fields.venue = body.venue;
  if (body.room !== undefined) fields.room = body.room;
  if (body.price !== undefined) fields.price = body.price;

  if (body.capacity !== undefined) {
    const seatCodes = generateSeatCodes(body.capacity);
    const updated = await eventsRepository.updateCapacityAndRegenerateSeats(
      eventId,
      body.capacity,
      seatCodes,
      fields,
    );
    return toEventDetail(updated);
  }

  const updated = await eventsRepository.updateEventFields(eventId, fields);
  return toEventDetail(updated);
}

export async function publishEvent(eventId: string, organizerId: string) {
  const event = await findOwnedEventOrThrow(eventId, organizerId);

  if (event.status === "PUBLISHED") {
    throw new AppError("Evento ja publicado.", 400);
  }
  if (event.status === "CANCELLED") {
    throw new AppError("Evento cancelado nao pode ser publicado.", 400);
  }
  if (event.startsAt.getTime() < Date.now()) {
    throw new AppError("Evento com data passada nao pode ser publicado.", 400);
  }

  await assertNoScheduleConflict({
    venue: event.venue,
    room: event.room,
    startsAt: event.startsAt,
    durationMinutes: event.catalogItem.durationMinutes,
    excludeEventId: event.id,
  });

  const updated = await eventsRepository.publishEvent(eventId);
  return toEventDetail(updated);
}

export async function deleteEvent(eventId: string, organizerId: string) {
  const event = await findOwnedEventOrThrow(eventId, organizerId);

  if (event.startsAt.getTime() < Date.now()) {
    throw new AppError("Evento com data passada nao pode ser excluido.", 400);
  }

  const hasPaidReservation = await eventsRepository.hasPaidReservation(eventId);
  if (hasPaidReservation) {
    throw new AppError("Evento com reservas pagas nao pode ser excluido.", 400);
  }

  await eventsRepository.deleteEventWithSeats(eventId);
}
