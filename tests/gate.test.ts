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
  name: "Gate Test Organizer",
  email: "gate-test-organizer@example.com",
  password: "123456",
  role: "ORGANIZER" as const,
};

const CUSTOMER = {
  name: "Gate Test Customer",
  email: "gate-test-customer@example.com",
  password: "123456",
  role: "CUSTOMER" as const,
};

const GATE_USER = {
  name: "Gate Test Gate",
  email: "gate-test-gate@example.com",
  password: "123456",
  role: "GATE" as const,
};

const RAW_MOVIE_DETAILS = {
  id: 555,
  title: "Sessao Portaria",
  original_title: "Gate Session",
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

let defaultDayOffsetCounter = 6000;
function nextStartsAt() {
  defaultDayOffsetCounter += 1;
  return futureIso(defaultDayOffsetCounter);
}

// qrValue e "<code>.<hmac>" -- o code nunca contem "." (alfabeto sem
// caracteres ambiguos, ver secure-token.ts), entao o primeiro "." separa
// os dois com seguranca.
function splitQrValue(qrValue: string) {
  const separatorIndex = qrValue.indexOf(".");
  return { code: qrValue.slice(0, separatorIndex), token: qrValue.slice(separatorIndex + 1) };
}

// Todo evento de teste nasce com startsAt milhares de dias no futuro
// (nextStartsAt(), pra nunca colidir de sala/horario entre testes) --
// fora da janela de entrada da portaria. Adianta so o startsAt no banco
// pra trazer a sessao pra dentro da janela valida, sem mexer no relogio
// do sistema nem no resto do fluxo de compra (mesmo padrao ja usado em
// events.test.ts/reservations.test.ts).
async function bringEventIntoEntryWindow(eventId: string) {
  await prisma.event.update({
    where: { id: eventId },
    data: { startsAt: new Date(Date.now() - 5 * 60 * 1000) },
  });
}

async function cleanupTestData() {
  const events = await prisma.event.findMany({
    where: { organizer: { email: ORGANIZER.email } },
    select: { id: true },
  });
  const eventIds = events.map((event) => event.id);

  if (eventIds.length > 0) {
    await prisma.gateValidation.deleteMany({ where: { checkedEventId: { in: eventIds } } });
    await prisma.ticketShareLink.deleteMany({ where: { ticket: { eventId: { in: eventIds } } } });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.simulatedPayment.deleteMany({ where: { reservation: { eventId: { in: eventIds } } } });
    await prisma.reservationItem.deleteMany({ where: { eventSeat: { eventId: { in: eventIds } } } });
    await prisma.ticketReservation.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventSeat.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }

  await prisma.externalCatalogItem.deleteMany({ where: { provider: "TMDB", externalId: "555" } });
  await prisma.user.deleteMany({
    where: { email: { in: [ORGANIZER.email, CUSTOMER.email, GATE_USER.email] } },
  });
}

describe("gate (UC16-20 - Validacao de Ingresso na Portaria)", () => {
  let organizerToken: string;
  let customerToken: string;
  let gateToken: string;
  const customerAsGateToken = () => signAccessToken({ sub: "fake-customer-id", role: "CUSTOMER" });

  beforeAll(async () => {
    await cleanupTestData();

    const passwordHash = await bcrypt.hash(ORGANIZER.password, 10);
    const organizer = await prisma.user.create({
      data: { name: ORGANIZER.name, email: ORGANIZER.email, passwordHash, role: ORGANIZER.role },
    });
    organizerToken = signAccessToken({ sub: organizer.id, role: "ORGANIZER" });

    const customer = await prisma.user.create({
      data: { name: CUSTOMER.name, email: CUSTOMER.email, passwordHash, role: CUSTOMER.role },
    });
    customerToken = signAccessToken({ sub: customer.id, role: "CUSTOMER" });

    const gateUser = await prisma.user.create({
      data: { name: GATE_USER.name, email: GATE_USER.email, passwordHash, role: GATE_USER.role },
    });
    gateToken = signAccessToken({ sub: gateUser.id, role: "GATE" });
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
        tmdbId: 555,
        startsAt: nextStartsAt(),
        venue: "CINE_VERZEL_1",
        room: 1,
        capacity: 5,
        price: 30,
        ...overrides,
      });
    const event = response.body.event;
    await request(app).post(`/api/events/${event.id}/publish`).set("Authorization", `Bearer ${organizerToken}`);
    return event;
  }

  async function createPaidTicketWithQr(eventId: string) {
    const seatsResponse = await request(app).get(`/api/public/events/${eventId}/seats`);
    const availableSeat = seatsResponse.body.seats.find((seat: { status: string }) => seat.status === "AVAILABLE");

    const reservationResponse = await request(app)
      .post("/api/reservations")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ eventId, seatIds: [availableSeat.id] });

    const paymentResponse = await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ reservationId: reservationResponse.body.reservation.id, card: VALID_CARD });

    const ticketId = paymentResponse.body.tickets[0].id;

    const ticketDetailResponse = await request(app)
      .get(`/api/tickets/${ticketId}`)
      .set("Authorization", `Bearer ${customerToken}`);

    return ticketDetailResponse.body.ticket as { id: string; code: string; qrValue: string };
  }

  describe("POST /api/gate/validate", () => {
    it("valida por QR: resultado VALID e marca o ticket como USED", async () => {
      const event = await createPublishedEvent();
      const ticket = await createPaidTicketWithQr(event.id);
      await bringEventIntoEntryWindow(event.id);
      const { code, token } = splitQrValue(ticket.qrValue);

      const response = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: event.id, code, token });

      expect(response.status).toBe(200);
      expect(response.body.result).toBe("VALID");
      expect(response.body.ticket.id).toBe(ticket.id);
      expect(response.body.ticket.usedAt).toBeTruthy();

      const dbTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(dbTicket.status).toBe("USED");
    });

    it("valida o mesmo ingresso de novo -> ALREADY_USED, nao VALID de novo", async () => {
      const event = await createPublishedEvent();
      const ticket = await createPaidTicketWithQr(event.id);
      await bringEventIntoEntryWindow(event.id);
      const { code, token } = splitQrValue(ticket.qrValue);

      await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: event.id, code, token });

      const secondResponse = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: event.id, code, token });

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.result).toBe("ALREADY_USED");
    });

    it("codigo manual (sem token) funciona", async () => {
      const event = await createPublishedEvent();
      const ticket = await createPaidTicketWithQr(event.id);
      await bringEventIntoEntryWindow(event.id);
      const { code } = splitQrValue(ticket.qrValue);

      const response = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: event.id, code });

      expect(response.status).toBe(200);
      expect(response.body.result).toBe("VALID");
    });

    it("codigo inexistente -> INVALID, ticket null", async () => {
      const event = await createPublishedEvent();

      const response = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: event.id, code: "NAOEXIST" });

      expect(response.status).toBe(200);
      expect(response.body.result).toBe("INVALID");
      expect(response.body.ticket).toBeNull();
    });

    it("token/QR incorreto -> INVALID", async () => {
      const event = await createPublishedEvent();
      const ticket = await createPaidTicketWithQr(event.id);
      const { code } = splitQrValue(ticket.qrValue);

      const response = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: event.id, code, token: "token-forjado" });

      expect(response.status).toBe(200);
      expect(response.body.result).toBe("INVALID");
      expect(response.body.ticket).toBeNull();
    });

    it("ingresso de outro evento -> WRONG_EVENT", async () => {
      const event = await createPublishedEvent();
      const otherEvent = await createPublishedEvent({ room: 2 });
      const ticket = await createPaidTicketWithQr(event.id);
      const { code, token } = splitQrValue(ticket.qrValue);

      const response = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: otherEvent.id, code, token });

      expect(response.status).toBe(200);
      expect(response.body.result).toBe("WRONG_EVENT");
      expect(response.body.ticket.id).toBe(ticket.id);

      const dbTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(dbTicket.status).toBe("VALID");
    });

    it("condicao de corrida: duas validacoes simultaneas do mesmo ingresso, so uma vira VALID", async () => {
      const event = await createPublishedEvent();
      const ticket = await createPaidTicketWithQr(event.id);
      await bringEventIntoEntryWindow(event.id);
      const { code, token } = splitQrValue(ticket.qrValue);

      const [responseA, responseB] = await Promise.all([
        request(app)
          .post("/api/gate/validate")
          .set("Authorization", `Bearer ${gateToken}`)
          .send({ eventId: event.id, code, token }),
        request(app)
          .post("/api/gate/validate")
          .set("Authorization", `Bearer ${gateToken}`)
          .send({ eventId: event.id, code, token }),
      ]);

      const results = [responseA.body.result, responseB.body.result].sort();
      expect(results).toEqual(["ALREADY_USED", "VALID"]);

      const dbTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(dbTicket.status).toBe("USED");
    });

    it("ingresso de sessao em outra data -> INVALID, fora da janela de entrada", async () => {
      const event = await createPublishedEvent();
      const ticket = await createPaidTicketWithQr(event.id);
      const { code, token } = splitQrValue(ticket.qrValue);

      const response = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: event.id, code, token });

      expect(response.status).toBe(200);
      expect(response.body.result).toBe("INVALID");
      expect(response.body.reason).toBe("Ingresso é para outra data de sessão.");

      const dbTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(dbTicket.status).toBe("VALID");
    });

    it("mais de 20min antes do inicio (mesmo dia) -> INVALID, entrada ainda nao liberada", async () => {
      const event = await createPublishedEvent({
        startsAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        room: 2,
      });
      const ticket = await createPaidTicketWithQr(event.id);
      const { code, token } = splitQrValue(ticket.qrValue);

      const response = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: event.id, code, token });

      expect(response.status).toBe(200);
      expect(response.body.result).toBe("INVALID");
      expect(response.body.reason).toBe(
        "Entrada ainda não liberada. Aguarde até 20 minutos antes do início da sessão.",
      );

      const dbTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(dbTicket.status).toBe("VALID");
    });

    it("depois do fim da sessao -> INVALID, sessao encerrada", async () => {
      const event = await createPublishedEvent({
        startsAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        room: 3,
      });
      const ticket = await createPaidTicketWithQr(event.id);
      await prisma.event.update({
        where: { id: event.id },
        data: { startsAt: new Date(Date.now() - 5 * 60 * 60 * 1000) },
      });
      const { code, token } = splitQrValue(ticket.qrValue);

      const response = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: event.id, code, token });

      expect(response.status).toBe(200);
      expect(response.body.result).toBe("INVALID");
      expect(response.body.reason).toBe("Sessão encerrada. Entrada não é mais permitida.");

      const dbTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(dbTicket.status).toBe("VALID");
    });

    it("retorna 401 sem token e 403 para quem nao e GATE", async () => {
      const event = await createPublishedEvent();
      const ticket = await createPaidTicketWithQr(event.id);
      const { code, token } = splitQrValue(ticket.qrValue);

      const noAuthResponse = await request(app)
        .post("/api/gate/validate")
        .send({ eventId: event.id, code, token });
      expect(noAuthResponse.status).toBe(401);

      const customerResponse = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${customerAsGateToken()}`)
        .send({ eventId: event.id, code, token });
      expect(customerResponse.status).toBe(403);
    });

    it("retorna 400 pra corpo invalido", async () => {
      const response = await request(app)
        .post("/api/gate/validate")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ eventId: "nao-e-uuid", code: "" });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/gate/tickets/:code/event", () => {
    it("resolve o evento certo a partir do codigo, sem marcar nada (fluxo ideal)", async () => {
      const event = await createPublishedEvent();
      const ticket = await createPaidTicketWithQr(event.id);
      const { code } = splitQrValue(ticket.qrValue);

      const response = await request(app)
        .get(`/api/gate/tickets/${code}/event`)
        .set("Authorization", `Bearer ${gateToken}`);

      expect(response.status).toBe(200);
      expect(response.body.event).toMatchObject({ id: event.id, title: event.title });

      const dbTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(dbTicket.status).toBe("VALID");
      expect(await prisma.gateValidation.count({ where: { ticketId: ticket.id } })).toBe(0);
    });

    it("retorna 404 pra codigo inexistente", async () => {
      const response = await request(app)
        .get("/api/gate/tickets/NAOEXISTE/event")
        .set("Authorization", `Bearer ${gateToken}`);

      expect(response.status).toBe(404);
    });

    it("retorna 401 sem token e 403 para quem nao e GATE", async () => {
      const event = await createPublishedEvent();
      const ticket = await createPaidTicketWithQr(event.id);
      const { code } = splitQrValue(ticket.qrValue);

      const noAuthResponse = await request(app).get(`/api/gate/tickets/${code}/event`);
      expect(noAuthResponse.status).toBe(401);

      const customerResponse = await request(app)
        .get(`/api/gate/tickets/${code}/event`)
        .set("Authorization", `Bearer ${customerAsGateToken()}`);
      expect(customerResponse.status).toBe(403);
    });
  });
});
