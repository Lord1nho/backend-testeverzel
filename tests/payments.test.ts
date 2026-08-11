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
  name: "Payments Test Organizer",
  email: "payments-test-organizer@example.com",
  password: "123456",
  role: "ORGANIZER" as const,
};

const CUSTOMER_1 = {
  name: "Payments Test Customer 1",
  email: "payments-test-customer-1@example.com",
  password: "123456",
  role: "CUSTOMER" as const,
};

const CUSTOMER_2 = {
  name: "Payments Test Customer 2",
  email: "payments-test-customer-2@example.com",
  password: "123456",
  role: "CUSTOMER" as const,
};

const RAW_MOVIE_DETAILS = {
  id: 553,
  title: "Sessao Pagamento",
  original_title: "Payment Session",
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

const VALID_CARD = {
  number: "4111111111111111",
  holderName: "Fulano de Tal",
  expiryMonth: 12,
  expiryYear: new Date().getFullYear() + 3,
  cvv: "123",
};

const DECLINED_CARD = { ...VALID_CARD, number: "4111111111110000" };

function futureIso(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

let defaultDayOffsetCounter = 4000;
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
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.simulatedPayment.deleteMany({ where: { reservation: { eventId: { in: eventIds } } } });
    await prisma.reservationItem.deleteMany({ where: { eventSeat: { eventId: { in: eventIds } } } });
    await prisma.ticketReservation.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventSeat.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }

  await prisma.externalCatalogItem.deleteMany({ where: { provider: "TMDB", externalId: "553" } });
  await prisma.user.deleteMany({
    where: { email: { in: [ORGANIZER.email, CUSTOMER_1.email, CUSTOMER_2.email] } },
  });
}

describe("payments (UC12 - Realizar Pagamento Simulado)", () => {
  let organizerToken: string;
  let customer1Token: string;
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
    customer1Token = signAccessToken({ sub: customer1.id, role: "CUSTOMER" });

    const customer2 = await prisma.user.create({
      data: { name: CUSTOMER_2.name, email: CUSTOMER_2.email, passwordHash, role: CUSTOMER_2.role },
    });
    customer2Token = signAccessToken({ sub: customer2.id, role: "CUSTOMER" });
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
        tmdbId: 553,
        startsAt: nextStartsAt(),
        venue: "CINE_VERZEL_1",
        room: 4,
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

  async function createReservation(token: string, eventId: string, seatIds: string[]) {
    const response = await request(app)
      .post("/api/reservations")
      .set("Authorization", `Bearer ${token}`)
      .send({ eventId, seatIds });
    return response.body.reservation;
  }

  describe("POST /api/payments", () => {
    it("aprova com cartao valido: reserva PAID, assentos SOLD, um ticket por assento", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);
      const reservation = await createReservation(customer1Token, event.id, seatIds.slice(0, 2));

      const response = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ reservationId: reservation.id, card: VALID_CARD });

      expect(response.status).toBe(200);
      expect(response.body.payment.status).toBe("APPROVED");
      expect(response.body.reservationStatus).toBe("PAID");
      expect(response.body.tickets).toHaveLength(2);

      const tickets = await prisma.ticket.findMany({ where: { reservationId: reservation.id } });
      expect(tickets).toHaveLength(2);
      expect(new Set(tickets.map((ticket) => ticket.eventSeatId))).toEqual(new Set(seatIds.slice(0, 2)));

      const seatsResponse = await request(app).get(`/api/public/events/${event.id}/seats`);
      const sold = seatsResponse.body.seats.filter((seat: { status: string }) => seat.status === "SOLD");
      expect(sold).toHaveLength(2);
    });

    it("recusa com cartao terminado em 0000: reserva PAYMENT_DECLINED, assentos liberados e reservaveis de novo", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);
      const reservation = await createReservation(customer1Token, event.id, seatIds.slice(0, 1));

      const response = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ reservationId: reservation.id, card: DECLINED_CARD });

      expect(response.status).toBe(200);
      expect(response.body.payment.status).toBe("DECLINED");
      expect(response.body.payment.failureReason).toBeTruthy();
      expect(response.body.reservationStatus).toBe("PAYMENT_DECLINED");
      expect(response.body.tickets).toHaveLength(0);

      const seatsResponse = await request(app).get(`/api/public/events/${event.id}/seats`);
      const seat = seatsResponse.body.seats.find((s: { id: string }) => s.id === seatIds[0]);
      expect(seat.status).toBe("AVAILABLE");

      const retryReservation = await createReservation(customer2Token, event.id, seatIds.slice(0, 1));
      expect(retryReservation.id).toBeTruthy();
    });

    it("condicao de corrida: duas tentativas de pagamento simultaneas na mesma reserva, so uma vence", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);
      const reservation = await createReservation(customer1Token, event.id, seatIds.slice(0, 1));

      const [responseA, responseB] = await Promise.all([
        request(app)
          .post("/api/payments")
          .set("Authorization", `Bearer ${customer1Token}`)
          .send({ reservationId: reservation.id, card: VALID_CARD }),
        request(app)
          .post("/api/payments")
          .set("Authorization", `Bearer ${customer1Token}`)
          .send({ reservationId: reservation.id, card: VALID_CARD }),
      ]);

      const statuses = [responseA.status, responseB.status].sort();
      expect(statuses).toEqual([200, 409]);

      const payments = await prisma.simulatedPayment.findMany({ where: { reservationId: reservation.id } });
      expect(payments).toHaveLength(1);
    });

    it("retorna 400 quando a reserva ja nao esta PENDING_PAYMENT", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);
      const reservation = await createReservation(customer1Token, event.id, seatIds.slice(0, 1));

      await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ reservationId: reservation.id, card: VALID_CARD });

      const secondAttempt = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ reservationId: reservation.id, card: VALID_CARD });

      expect(secondAttempt.status).toBe(400);
    });

    it("retorna 400 e libera os assentos quando a reserva ja expirou", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);
      const reservation = await createReservation(customer1Token, event.id, seatIds.slice(0, 1));

      await prisma.ticketReservation.update({
        where: { id: reservation.id },
        data: { expiresAt: new Date(Date.now() - 60 * 1000) },
      });

      const response = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ reservationId: reservation.id, card: VALID_CARD });

      expect(response.status).toBe(400);

      const updatedReservation = await prisma.ticketReservation.findUniqueOrThrow({
        where: { id: reservation.id },
      });
      expect(updatedReservation.status).toBe("EXPIRED");

      const seatsResponse = await request(app).get(`/api/public/events/${event.id}/seats`);
      const seat = seatsResponse.body.seats.find((s: { id: string }) => s.id === seatIds[0]);
      expect(seat.status).toBe("AVAILABLE");
    });

    it("retorna 404 pra reserva de outro cliente ou inexistente", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);
      const reservation = await createReservation(customer1Token, event.id, seatIds.slice(0, 1));

      const otherResponse = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${customer2Token}`)
        .send({ reservationId: reservation.id, card: VALID_CARD });
      expect(otherResponse.status).toBe(404);

      const nonExistentResponse = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ reservationId: "00000000-0000-0000-0000-000000000000", card: VALID_CARD });
      expect(nonExistentResponse.status).toBe(404);
    });

    it("retorna 400 pra corpo invalido", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);
      const reservation = await createReservation(customer1Token, event.id, seatIds.slice(0, 1));

      const response = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${customer1Token}`)
        .send({ reservationId: reservation.id, card: { ...VALID_CARD, number: "abc" } });

      expect(response.status).toBe(400);
    });

    it("retorna 401 sem token e 403 para ORGANIZER/GATE", async () => {
      const event = await createPublishedEvent();
      const seatIds = await getSeatIds(event.id);
      const reservation = await createReservation(customer1Token, event.id, seatIds.slice(0, 1));

      const noAuthResponse = await request(app)
        .post("/api/payments")
        .send({ reservationId: reservation.id, card: VALID_CARD });
      expect(noAuthResponse.status).toBe(401);

      const organizerResponse = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${organizerAsCustomerToken()}`)
        .send({ reservationId: reservation.id, card: VALID_CARD });
      expect(organizerResponse.status).toBe(403);

      const gateResponse = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ reservationId: reservation.id, card: VALID_CARD });
      expect(gateResponse.status).toBe(403);
    });
  });
});
