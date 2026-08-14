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
  name: "Tickets Test Organizer",
  email: "tickets-test-organizer@example.com",
  password: "123456",
  role: "ORGANIZER" as const,
};

const CUSTOMER_1 = {
  name: "Tickets Test Customer 1",
  email: "tickets-test-customer-1@example.com",
  password: "123456",
  role: "CUSTOMER" as const,
};

const CUSTOMER_2 = {
  name: "Tickets Test Customer 2",
  email: "tickets-test-customer-2@example.com",
  password: "123456",
  role: "CUSTOMER" as const,
};

const RAW_MOVIE_DETAILS = {
  id: 554,
  title: "Sessao Ingresso",
  original_title: "Ticket Session",
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

function futureIso(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

let defaultDayOffsetCounter = 5000;
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
    await prisma.ticketShareLink.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.simulatedPayment.deleteMany({ where: { reservation: { eventId: { in: eventIds } } } });
    await prisma.reservationItem.deleteMany({ where: { eventSeat: { eventId: { in: eventIds } } } });
    await prisma.ticketReservation.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventSeat.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }

  await prisma.externalCatalogItem.deleteMany({ where: { provider: "TMDB", externalId: "554" } });
  await prisma.user.deleteMany({
    where: { email: { in: [ORGANIZER.email, CUSTOMER_1.email, CUSTOMER_2.email] } },
  });
}

describe("tickets (UC13 - Meus Ingressos / UC14 - Visualizar / UC15 - Compartilhar)", () => {
  let organizerToken: string;
  let customer1Token: string;
  let customer2Token: string;

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

  async function createPaidTicket(overrides: Partial<Record<string, unknown>> = {}) {
    const eventResponse = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizerToken}`)
      .send({
        tmdbId: 554,
        startsAt: nextStartsAt(),
        venue: "CINE_VERZEL_1",
        room: 1,
        capacity: 5,
        price: 40,
        ...overrides,
      });
    const event = eventResponse.body.event;
    await request(app).post(`/api/events/${event.id}/publish`).set("Authorization", `Bearer ${organizerToken}`);

    const seatsResponse = await request(app).get(`/api/public/events/${event.id}/seats`);
    const seatId = seatsResponse.body.seats[0].id;

    const reservationResponse = await request(app)
      .post("/api/reservations")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({ eventId: event.id, seatIds: [seatId] });

    const paymentResponse = await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${customer1Token}`)
      .send({ reservationId: reservationResponse.body.reservation.id, card: VALID_CARD });

    return { event, seatId, ticket: paymentResponse.body.tickets[0] };
  }

  describe("GET /api/tickets", () => {
    it("lista os ingressos do cliente autenticado", async () => {
      const { ticket } = await createPaidTicket();

      const response = await request(app).get("/api/tickets").set("Authorization", `Bearer ${customer1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.tickets.some((t: { id: string }) => t.id === ticket.id)).toBe(true);
    });

    it("nao lista ingressos de outro cliente", async () => {
      await createPaidTicket();

      const response = await request(app).get("/api/tickets").set("Authorization", `Bearer ${customer2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.tickets).toHaveLength(0);
    });
  });

  describe("GET /api/tickets/:id", () => {
    it("mostra o detalhe com qrValue e o assento certo", async () => {
      const { ticket, seatId } = await createPaidTicket();

      const response = await request(app)
        .get(`/api/tickets/${ticket.id}`)
        .set("Authorization", `Bearer ${customer1Token}`);

      expect(response.status).toBe(200);
      expect(response.body.ticket).toMatchObject({
        id: ticket.id,
        status: "VALID",
        seat: { id: seatId },
      });
      expect(response.body.ticket.qrValue).toMatch(/^.+\..+$/);
      expect(response.body.ticket.qrValue.startsWith(response.body.ticket.code)).toBe(true);
    });

    it("retorna 404 pra ingresso de outro cliente ou inexistente", async () => {
      const { ticket } = await createPaidTicket();

      const otherResponse = await request(app)
        .get(`/api/tickets/${ticket.id}`)
        .set("Authorization", `Bearer ${customer2Token}`);
      expect(otherResponse.status).toBe(404);

      const nonExistentResponse = await request(app)
        .get("/api/tickets/00000000-0000-0000-0000-000000000000")
        .set("Authorization", `Bearer ${customer1Token}`);
      expect(nonExistentResponse.status).toBe(404);
    });
  });

  describe("POST /api/tickets/:id/share + GET /api/public/tickets/:token", () => {
    it("gera um link e permite visualizar o ingresso sem autenticacao", async () => {
      const { ticket } = await createPaidTicket();

      const shareResponse = await request(app)
        .post(`/api/tickets/${ticket.id}/share`)
        .set("Authorization", `Bearer ${customer1Token}`);

      expect(shareResponse.status).toBe(201);
      expect(shareResponse.body.shareLink.token).toBeTruthy();

      const publicResponse = await request(app).get(
        `/api/public/tickets/${shareResponse.body.shareLink.token}`,
      );

      expect(publicResponse.status).toBe(200);
      expect(publicResponse.body.ticket.id).toBe(ticket.id);
      expect(publicResponse.body.ticket.qrValue).toBeTruthy();
    });

    it("retorna 404 pra token inexistente ou invalido", async () => {
      const response = await request(app).get("/api/public/tickets/token-que-nao-existe");
      expect(response.status).toBe(404);
    });

    it("retorna 404 ao tentar compartilhar ingresso de outro cliente", async () => {
      const { ticket } = await createPaidTicket();

      const response = await request(app)
        .post(`/api/tickets/${ticket.id}/share`)
        .set("Authorization", `Bearer ${customer2Token}`);

      expect(response.status).toBe(404);
    });
  });
});
