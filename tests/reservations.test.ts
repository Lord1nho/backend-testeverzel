import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { prisma } from "../src/shared/prisma/client.js";
import { signAccessToken } from "../src/shared/security/token-service.js";

vi.mock("../src/modules/catalog/catalog.tmdb-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/modules/catalog/catalog.tmdb-client.js")>();
  return {
    ...actual,
    fetchMovieDetails: vi.fn(),
  };
});

import { fetchMovieDetails } from "../src/modules/catalog/catalog.tmdb-client.js";

const app = createApp();

const ORGANIZER = {
  name: "Reservations Test Organizer",
  email: "reservations-test-organizer@example.com",
  password: "123456",
  role: "ORGANIZER" as const,
};

const CUSTOMER_1 = {
  name: "Reservations Test Customer 1",
  email: "reservations-test-customer-1@example.com",
  password: "123456",
  role: "CUSTOMER" as const,
};

const CUSTOMER_2 = {
  name: "Reservations Test Customer 2",
  email: "reservations-test-customer-2@example.com",
  password: "123456",
  role: "CUSTOMER" as const,
};

const RAW_MOVIE_DETAILS = {
  id: 552,
  title: "Sessao Reserva",
  original_title: "Reservation Session",
  overview: "...",
  poster_path: "/poster.jpg",
  backdrop_path: null,
  release_date: "1999-10-15",
  vote_average: 8.4,
  popularity: 61.2,
  genres: [{ id: 18, name: "Drama" }],
  runtime: 100,
  tagline: "...",
};

function futureIso(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

let defaultDayOffsetCounter = 3000;
function nextStartsAt() {
  defaultDayOffsetCounter += 1;
  return futureIso(defaultDayOffsetCounter);
}

async function cleanupTestData() {
  const events = await prisma.event.findMany({
    where: { organizer: { email: ORGANIZER.email } },
    select: { id: true },
  });
  const eventIds = events.map((event) => event.id);

  if (eventIds.length > 0) {
    await prisma.reservationItem.deleteMany({ where: { eventSeat: { eventId: { in: eventIds } } } });
    await prisma.ticketReservation.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventSeat.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }

  await prisma.externalCatalogItem.deleteMany({ where: { provider: "TMDB", externalId: "552" } });
  await prisma.user.deleteMany({
    where: { email: { in: [ORGANIZER.email, CUSTOMER_1.email, CUSTOMER_2.email] } },
  });
}

describe("reservations (UC10 - Reservar Ingresso / UC11 - Selecionar Assento)", () => {
  let organizerToken: string;
  let customer1Id: string;
  let customer1Token: string;
  let customer2Id: string;
  let customer2Token: string;
  const organizerAsCustomerToken = () => signAccessToken({ sub: "fake-organizer-id", role: "ORGANIZER" });
  const gateToken = signAccessToken({ sub: "fake-gate-id", role: "GATE" });

  beforeAll(async () => {
    await cleanupTestData();

    const passwordHash = await bcrypt.hash(ORGANIZER.password, 10);
    const organizer = await prisma.user.create({
      data: { name: ORGANIZER.name, email: ORGANIZER.email, passwordHash, role: ORGANIZER.role },
    });
    organizerToken = signAccessToken({ sub: organizer.id, role: "ORGANIZER" });

    const customer1 = await prisma.user.create({
      data: { name: CUSTOMER_1.name, email: CUSTOMER_1.email, passwordHash, role: CUSTOMER_1.role },
    });
    customer1Id = customer1.id;
    customer1Token = signAccessToken({ sub: customer1Id, role: "CUSTOMER" });

    const customer2 = await prisma.user.create({
      data: { name: CUSTOMER_2.name, email: CUSTOMER_2.email, passwordHash, role: CUSTOMER_2.role },
    });
    customer2Id = customer2.id;
    customer2Token = signAccessToken({ sub: customer2Id, role: "CUSTOMER" });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    vi.mocked(fetchMovieDetails).mockResolvedValue(RAW_MOVIE_DETAILS);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function createPublishedEvent(overrides: Partial<Record<string, unknown>> = {}) {
    const response = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizerToken}`)
      .send({
        tmdbId: 552,
        startsAt: nextStartsAt(),
        venue: "CINE_VERZEL_2",
        room: 2,
        capacity: 5,
        price: 30,
        ...overrides,
      });
    const event = response.body.event;
    await request(app).post(`/api/events/${event.id}/publish`).set("Authorization", `Bearer ${organizerToken}`);
    return event;
  }

  async function getSeatIds(eventId: string) {
    const response = await request(app).get(`/api/public/events/${eventId}/seats`);
    return response.body.seats.map((seat: { id: string }) => seat.id);
  }

  describe("POST /api/reservations", () => {
    it("reserva assentos disponiveis, gera PENDING_PAYMENT e bloqueia os assentos", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);

      const response = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ eventId: event.id, seatIds: seatIds.slice(0, 2) });

      expect(response.status).toBe(201);
      expect(response.body.reservation).toMatchObject({
        status: "PENDING_PAYMENT",
        quantity: 2,
        totalAmount: 60,
      });
      expect(response.body.reservation.seats).toHaveLength(2);
      expect(response.body.reservation.expiresAt).toBeTruthy();

      const seatsResponse = await request(app).get(`/api/public/events/${event.id}/seats`);
      const reservedSeats = seatsResponse.body.seats.filter((seat: { status: string }) => seat.status === "RESERVED");
      expect(reservedSeats).toHaveLength(2);
    });

    it("outro cliente nao consegue reservar um assento ja reservado (409) e nao mexe nos demais", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);

      const first = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ eventId: event.id, seatIds: [seatIds[0]] });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${customer2Token}`)
        .send({ eventId: event.id, seatIds: [seatIds[0], seatIds[1]] });

      expect(second.status).toBe(409);

      const seatsResponse = await request(app).get(`/api/public/events/${event.id}/seats`);
      const seatTwo = seatsResponse.body.seats.find((seat: { id: string }) => seat.id === seatIds[1]);
      expect(seatTwo.status).toBe("AVAILABLE");
    });

    it("condicao de corrida: duas reservas concorrentes pelo mesmo assento, so uma vence", async () => {
      const event = await createPublishedEvent({ capacity: 1 });
      const seatIds = await getSeatIds(event.id);

      const [responseA, responseB] = await Promise.all([
        request(app)
          .post("/api/reservations")
          .set("Authorization", `Bearer ${customer1Token}`)
          .send({ eventId: event.id, seatIds }),
        request(app)
          .post("/api/reservations")
          .set("Authorization", `Bearer ${customer2Token}`)
          .send({ eventId: event.id, seatIds }),
      ]);

      const statuses = [responseA.status, responseB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const seatsResponse = await request(app).get(`/api/public/events/${event.id}/seats`);
      expect(seatsResponse.body.seats.filter((seat: { status: string }) => seat.status === "RESERVED")).toHaveLength(
        1,
      );
    });

    it("retorna 404 para evento inexistente ou nao publicado", async () => {
      const draftResponse = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({
          tmdbId: 552,
          startsAt: nextStartsAt(),
          venue: "CINE_VERZEL_1",
          room: 3,
          capacity: 2,
          price: 10,
        });
      const draftEvent = draftResponse.body.event;
      const draftSeatIds = await prisma.eventSeat
        .findMany({ where: { eventId: draftEvent.id } })
        .then((seats) => seats.map((seat) => seat.id));

      const response = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ eventId: draftEvent.id, seatIds: draftSeatIds.slice(0, 1) });

      expect(response.status).toBe(404);

      const nonExistentResponse = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ eventId: "00000000-0000-0000-0000-000000000000", seatIds: draftSeatIds.slice(0, 1) });

      expect(nonExistentResponse.status).toBe(404);
    });

    it("retorna 400 quando o evento ja comecou/encerrou", async () => {
      const event = await createPublishedEvent();
      await prisma.event.update({
        where: { id: event.id },
        data: { startsAt: new Date(Date.now() - 60 * 60 * 1000) },
      });
      const seatIds = await getSeatIds(event.id);

      const response = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ eventId: event.id, seatIds: seatIds.slice(0, 1) });

      expect(response.status).toBe(400);
    });

    it("retorna 400 para seatIds vazio ou duplicado", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);

      const emptyResponse = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ eventId: event.id, seatIds: [] });
      expect(emptyResponse.status).toBe(400);

      const duplicateResponse = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ eventId: event.id, seatIds: [seatIds[0], seatIds[0]] });
      expect(duplicateResponse.status).toBe(400);
    });

    it("retorna 401 sem token e 403 para ORGANIZER/GATE", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);

      const noAuthResponse = await request(app)
        .post("/api/reservations")
        .send({ eventId: event.id, seatIds: seatIds.slice(0, 1) });
      expect(noAuthResponse.status).toBe(401);

      const organizerResponse = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${organizerAsCustomerToken()}`)
        .send({ eventId: event.id, seatIds: seatIds.slice(0, 1) });
      expect(organizerResponse.status).toBe(403);

      const gateResponse = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: event.id, seatIds: seatIds.slice(0, 1) });
      expect(gateResponse.status).toBe(403);
    });
  });

  describe("GET /api/reservations/:id", () => {
    it("dono ve a propria reserva, outro cliente recebe 404", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);

      const created = await request(app)
        .post("/api/reservations")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ eventId: event.id, seatIds: seatIds.slice(0, 1) });

      const ownerResponse = await request(app)
        .get(`/api/reservations/${created.body.reservation.id}`)
        .set("Authorization", `Bearer ${customer1Token}`);
      expect(ownerResponse.status).toBe(200);
      expect(ownerResponse.body.reservation.id).toBe(created.body.reservation.id);

      const otherResponse = await request(app)
        .get(`/api/reservations/${created.body.reservation.id}`)
        .set("Authorization", `Bearer ${customer2Token}`);
      expect(otherResponse.status).toBe(404);
    });

    it("retorna 404 para reserva inexistente", async () => {
      const response = await request(app)
        .get("/api/reservations/00000000-0000-0000-0000-000000000000")
        .set("Authorization", `Bearer ${customer1Token}`);
      expect(response.status).toBe(404);
    });
  });
});
