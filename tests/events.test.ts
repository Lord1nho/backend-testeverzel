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

import { fetchMovieDetails, TmdbRequestError } from "../src/modules/catalog/catalog.tmdb-client.js";

const app = createApp();

const ORGANIZER = {
  name: "Events Test Organizer",
  email: "events-test-organizer@example.com",
  password: "123456",
  role: "ORGANIZER" as const,
};

const OTHER_ORGANIZER = {
  name: "Other Organizer",
  email: "events-test-other-organizer@example.com",
  password: "123456",
  role: "ORGANIZER" as const,
};

const RAW_MOVIE_DETAILS = {
  id: 550,
  title: "Clube da Luta",
  original_title: "Fight Club",
  overview: "...",
  poster_path: "/poster.jpg",
  backdrop_path: null,
  release_date: "1999-10-15",
  vote_average: 8.4,
  popularity: 61.2,
  genres: [{ id: 18, name: "Drama" }],
  runtime: 139,
  tagline: "...",
};

function futureIso(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

// Conflito de horario agora e checado globalmente (mesma venue+room, sem
// filtro de organizador -- fisicamente so pode ter uma sessao por vez na
// mesma sala, nao importa quem publicou). Testes que nao se importam com
// agendamento usam um dia sempre diferente por padrao, pra nunca colidir
// entre si (eventos PUBLISHED por um teste ficam no banco ate o afterAll).
// Testes que testam conflito de proposito passam startsAt/venue/room fixos.
let defaultDayOffsetCounter = 1000;
function nextDefaultStartsAt() {
  defaultDayOffsetCounter += 1;
  return futureIso(defaultDayOffsetCounter);
}

async function cleanupTestData() {
  const events = await prisma.event.findMany({
    where: { organizer: { email: { in: [ORGANIZER.email, OTHER_ORGANIZER.email] } } },
    select: { id: true },
  });
  const eventIds = events.map((event) => event.id);

  if (eventIds.length > 0) {
    await prisma.gateValidation.deleteMany({ where: { checkedEventId: { in: eventIds } } });
    await prisma.reservationItem.deleteMany({
      where: { eventSeat: { eventId: { in: eventIds } } },
    });
    await prisma.simulatedPayment.deleteMany({
      where: { reservation: { eventId: { in: eventIds } } },
    });
    await prisma.ticket.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.ticketReservation.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventSeat.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }

  await prisma.externalCatalogItem.deleteMany({ where: { provider: "TMDB", externalId: "550" } });
  await prisma.user.deleteMany({ where: { email: { in: [ORGANIZER.email, OTHER_ORGANIZER.email] } } });
}

describe("events", () => {
  let organizerId: string;
  let otherOrganizerId: string;
  let organizerToken: string;
  let otherOrganizerToken: string;
  const customerToken = signAccessToken({ sub: "fake-customer-id", role: "CUSTOMER" });
  const gateToken = signAccessToken({ sub: "fake-gate-id", role: "GATE" });

  beforeAll(async () => {
    await cleanupTestData();

    const passwordHash = await bcrypt.hash(ORGANIZER.password, 10);
    const organizer = await prisma.user.create({
      data: { name: ORGANIZER.name, email: ORGANIZER.email, passwordHash, role: ORGANIZER.role },
    });
    organizerId = organizer.id;
    organizerToken = signAccessToken({ sub: organizerId, role: "ORGANIZER" });

    const otherOrganizer = await prisma.user.create({
      data: {
        name: OTHER_ORGANIZER.name,
        email: OTHER_ORGANIZER.email,
        passwordHash,
        role: OTHER_ORGANIZER.role,
      },
    });
    otherOrganizerId = otherOrganizer.id;
    otherOrganizerToken = signAccessToken({ sub: otherOrganizerId, role: "ORGANIZER" });
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

  async function createTestEvent(overrides: Partial<Record<string, unknown>> = {}) {
    const response = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizerToken}`)
      .send({
        tmdbId: 550,
        startsAt: nextDefaultStartsAt(),
        venue: "CINE_VERZEL_1",
        room: 3,
        capacity: 15,
        price: 35.5,
        ...overrides,
      });
    return response;
  }

  describe("POST /api/events", () => {
    it("cria o evento, gera os assentos corretos e faz upsert do catalogItem", async () => {
      const response = await createTestEvent();

      expect(response.status).toBe(201);
      expect(response.body.event).toMatchObject({
        title: "Clube da Luta",
        status: "DRAFT",
        sessionStatus: "SCHEDULED",
        venue: "CINE_VERZEL_1",
        room: 3,
        capacity: 15,
        seatsTotal: 15,
        seatsAvailable: 15,
        catalogItem: {
          title: "Clube da Luta",
          provider: "TMDB",
          externalId: "550",
          durationMinutes: 139,
        },
      });

      const seatsResponse = await request(app)
        .get(`/api/events/${response.body.event.id}/seats`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(seatsResponse.body.seats.map((seat: { code: string }) => seat.code)).toEqual([
        "A1",
        "A2",
        "A3",
        "A4",
        "A5",
        "A6",
        "A7",
        "A8",
        "A9",
        "A10",
        "B1",
        "B2",
        "B3",
        "B4",
        "B5",
      ]);
      expect(seatsResponse.body.seats.every((seat: { status: string }) => seat.status === "AVAILABLE")).toBe(
        true,
      );
    });

    it("reusa o catalogItem existente numa segunda criacao com o mesmo tmdbId", async () => {
      const first = await createTestEvent();
      const second = await createTestEvent({ startsAt: futureIso(10) });

      expect(first.body.event.catalogItem.id).toBe(second.body.event.catalogItem.id);
    });

    it("usa sempre o titulo do filme (TMDB)", async () => {
      const response = await createTestEvent();
      expect(response.body.event.title).toBe("Clube da Luta");
    });

    it("ignora title enviado no body -- nome do evento fica travado no do TMDB", async () => {
      const response = await createTestEvent({ title: "Sessao Especial" });
      expect(response.body.event.title).toBe("Clube da Luta");
    });

    it("retorna 400 para capacity invalida", async () => {
      const response = await createTestEvent({ capacity: 0 });
      expect(response.status).toBe(400);
    });

    it("retorna 400 para startsAt no passado", async () => {
      const response = await createTestEvent({ startsAt: futureIso(-1) });
      expect(response.status).toBe(400);
    });

    it("propaga erro do TMDB (404)", async () => {
      vi.mocked(fetchMovieDetails).mockRejectedValue(new TmdbRequestError("nao encontrado", 404));
      const response = await createTestEvent();
      expect(response.status).toBe(404);
    });

    it("retorna 403 para CUSTOMER e GATE", async () => {
      const customerResponse = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ tmdbId: 550, startsAt: futureIso(5), venue: "CINE_VERZEL_1", room: 1, capacity: 10, price: 10 });
      expect(customerResponse.status).toBe(403);

      const gateResponse = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${gateToken}`)
        .send({ tmdbId: 550, startsAt: futureIso(5), venue: "CINE_VERZEL_1", room: 1, capacity: 10, price: 10 });
      expect(gateResponse.status).toBe(403);
    });

    it("retorna 401 sem token", async () => {
      const response = await request(app).post("/api/events").send({});
      expect(response.status).toBe(401);
    });

    it("retorna 400 para venue invalido", async () => {
      const response = await createTestEvent({ venue: "CINE_VERZEL_9" });
      expect(response.status).toBe(400);
    });

    it("retorna 400 para room fora de 1-4", async () => {
      const zeroResponse = await createTestEvent({ room: 0 });
      expect(zeroResponse.status).toBe(400);

      const fiveResponse = await createTestEvent({ room: 5 });
      expect(fiveResponse.status).toBe(400);
    });

    it("usa fallback de 120min quando a TMDB nao informa duracao", async () => {
      vi.mocked(fetchMovieDetails).mockResolvedValueOnce({ ...RAW_MOVIE_DETAILS, runtime: null });

      const response = await createTestEvent();

      expect(response.status).toBe(201);
      expect(response.body.event.catalogItem.durationMinutes).toBeNull();
      // 120min (fallback) + 10min de trailers = janela de 130min.
      // startsAt e futuro aqui, entao so confirmamos que o calculo nao quebrou
      // e sessionStatus continua coerente (SCHEDULED, ainda nao comecou).
      expect(response.body.event.sessionStatus).toBe("SCHEDULED");
    });
  });

  describe("GET /api/events", () => {
    it("so retorna os eventos do organizador autenticado", async () => {
      await createTestEvent();

      const otherResponse = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${otherOrganizerToken}`)
        .send({ tmdbId: 550, startsAt: futureIso(5), venue: "CINE_VERZEL_2", room: 1, capacity: 5, price: 10 });
      expect(otherResponse.status).toBe(201);

      const organizerList = await request(app)
        .get("/api/events")
        .set("Authorization", `Bearer ${organizerToken}`);
      const otherOrganizerList = await request(app)
        .get("/api/events")
        .set("Authorization", `Bearer ${otherOrganizerToken}`);

      expect(organizerList.body.events.every((event: { id: string }) => event.id)).toBe(true);
      expect(
        organizerList.body.events.some((event: { id: string }) => event.id === otherResponse.body.event.id),
      ).toBe(false);
      expect(
        otherOrganizerList.body.events.some(
          (event: { id: string }) => event.id === otherResponse.body.event.id,
        ),
      ).toBe(true);
    });
  });

  describe("Ownership (404 para evento de outro organizador)", () => {
    it("get/update/publish/delete/seats retornam 404 para quem nao e dono", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      const getResponse = await request(app)
        .get(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${otherOrganizerToken}`);
      expect(getResponse.status).toBe(404);

      const seatsResponse = await request(app)
        .get(`/api/events/${eventId}/seats`)
        .set("Authorization", `Bearer ${otherOrganizerToken}`);
      expect(seatsResponse.status).toBe(404);

      const updateResponse = await request(app)
        .patch(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${otherOrganizerToken}`)
        .send({ venue: "CINE_VERZEL_2" });
      expect(updateResponse.status).toBe(404);

      const publishResponse = await request(app)
        .post(`/api/events/${eventId}/publish`)
        .set("Authorization", `Bearer ${otherOrganizerToken}`);
      expect(publishResponse.status).toBe(404);

      const deleteResponse = await request(app)
        .delete(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${otherOrganizerToken}`);
      expect(deleteResponse.status).toBe(404);
    });
  });

  describe("PATCH /api/events/:id (capacidade)", () => {
    it("regenera os seats quando capacity muda em evento DRAFT", async () => {
      const created = await createTestEvent({ capacity: 5 });
      const eventId = created.body.event.id;

      const updateResponse = await request(app)
        .patch(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ capacity: 20 });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.event.seatsTotal).toBe(20);

      const seatsResponse = await request(app)
        .get(`/api/events/${eventId}/seats`)
        .set("Authorization", `Bearer ${organizerToken}`);
      expect(seatsResponse.body.seats).toHaveLength(20);
    });

    it("retorna 400 ao tentar mudar capacity de evento ja PUBLISHED", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      await request(app)
        .post(`/api/events/${eventId}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      const updateResponse = await request(app)
        .patch(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ capacity: 30 });

      expect(updateResponse.status).toBe(400);
    });

    it("retorna 400 ao editar evento com data passada", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      await prisma.event.update({
        where: { id: eventId },
        data: { startsAt: new Date(Date.now() - 1000 * 60 * 60) },
      });

      const updateResponse = await request(app)
        .patch(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ venue: "CINE_VERZEL_2" });

      expect(updateResponse.status).toBe(400);
    });
  });

  describe("PATCH /api/events/:id (reserva paga trava startsAt/venue/room/price)", () => {
    it("bloqueia startsAt/venue/room/price com reserva PAID vinculada", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      await prisma.ticketReservation.create({
        data: {
          customerId: organizerId,
          eventId,
          status: "PAID",
          quantity: 1,
          totalAmount: 35.5,
        },
      });

      const startsAtResponse = await request(app)
        .patch(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ startsAt: futureIso(20) });
      expect(startsAtResponse.status).toBe(400);

      const venueResponse = await request(app)
        .patch(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ venue: "CINE_VERZEL_2" });
      expect(venueResponse.status).toBe(400);

      const roomResponse = await request(app)
        .patch(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ room: 4 });
      expect(roomResponse.status).toBe(400);

      const priceResponse = await request(app)
        .patch(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ price: 99.9 });
      expect(priceResponse.status).toBe(400);

      await prisma.ticketReservation.deleteMany({ where: { eventId } });
    });
  });

  describe("PATCH /api/events/:id (title travado)", () => {
    it("ignora title no PATCH -- nome do evento permanece o do TMDB", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      const response = await request(app)
        .patch(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ title: "Novo titulo", price: 50 });

      expect(response.status).toBe(200);
      expect(response.body.event.title).toBe("Clube da Luta");
      expect(response.body.event.price).toBe(50);
    });

    it("retorna 400 quando title e o unico campo enviado (nada de fato pra atualizar)", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      const response = await request(app)
        .patch(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ title: "Novo titulo" });

      expect(response.status).toBe(400);
    });
  });

  describe("sessionStatus derivado", () => {
    it("STARTED quando startsAt ja passou mas ainda dentro da janela (duracao+10min)", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      // RAW_MOVIE_DETAILS.runtime = 139 -> janela de 149min. 30min atras esta dentro.
      await prisma.event.update({
        where: { id: eventId },
        data: { startsAt: new Date(Date.now() - 30 * 60 * 1000) },
      });

      const response = await request(app)
        .get(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.body.event.sessionStatus).toBe("STARTED");
    });

    it("ENDED quando passou da janela (duracao+10min)", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      // janela de 149min. 200min atras esta fora.
      await prisma.event.update({
        where: { id: eventId },
        data: { startsAt: new Date(Date.now() - 200 * 60 * 1000) },
      });

      const response = await request(app)
        .get(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.body.event.sessionStatus).toBe("ENDED");
    });

    it("usa o fallback de 120min (nao os 139min reais) quando a TMDB nao informa duracao", async () => {
      vi.mocked(fetchMovieDetails).mockResolvedValueOnce({ ...RAW_MOVIE_DETAILS, runtime: null });
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      // fallback 120min + 10min = janela de 130min.
      await prisma.event.update({
        where: { id: eventId },
        data: { startsAt: new Date(Date.now() - 125 * 60 * 1000) },
      });
      const stillStarted = await request(app)
        .get(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`);
      expect(stillStarted.body.event.sessionStatus).toBe("STARTED");

      await prisma.event.update({
        where: { id: eventId },
        data: { startsAt: new Date(Date.now() - 135 * 60 * 1000) },
      });
      const nowEnded = await request(app)
        .get(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`);
      expect(nowEnded.body.event.sessionStatus).toBe("ENDED");
    });
  });

  describe("Conflito de horario (venue+room+status PUBLISHED)", () => {
    // Cada teste usa um dia bem separado dos outros (a checagem e global,
    // entre qualquer evento PUBLISHED na mesma venue+room, sem filtro de
    // organizador -- eventos publicados por um teste ficam no banco ate o
    // afterAll, entao dias distintos evitam que um teste colida com o
    // leftover de outro).
    it("dois eventos DRAFT no mesmo horario/sala nao dao erro", async () => {
      const startsAt = futureIso(200);
      const first = await createTestEvent({ startsAt, venue: "CINE_VERZEL_1", room: 2 });
      const second = await createTestEvent({ startsAt, venue: "CINE_VERZEL_1", room: 2 });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
    });

    it("retorna 409 ao publicar evento que colide com outro ja PUBLISHED na mesma sala", async () => {
      const startsAt = futureIso(202);
      const first = await createTestEvent({ startsAt, venue: "CINE_VERZEL_1", room: 2 });
      const second = await createTestEvent({ startsAt, venue: "CINE_VERZEL_1", room: 2 });

      const publishFirst = await request(app)
        .post(`/api/events/${first.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);
      expect(publishFirst.status).toBe(200);

      const publishSecond = await request(app)
        .post(`/api/events/${second.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(publishSecond.status).toBe(409);
      expect(publishSecond.body.message).toContain(first.body.event.title);
    });

    it("sala diferente no mesmo venue nao colide", async () => {
      const startsAt = futureIso(204);
      const first = await createTestEvent({ startsAt, venue: "CINE_VERZEL_1", room: 1 });
      const second = await createTestEvent({ startsAt, venue: "CINE_VERZEL_1", room: 2 });

      await request(app)
        .post(`/api/events/${first.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      const publishSecond = await request(app)
        .post(`/api/events/${second.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(publishSecond.status).toBe(200);
    });

    it("venue diferente na mesma sala nao colide", async () => {
      const startsAt = futureIso(206);
      const first = await createTestEvent({ startsAt, venue: "CINE_VERZEL_1", room: 4 });
      const second = await createTestEvent({ startsAt, venue: "CINE_VERZEL_2", room: 4 });

      await request(app)
        .post(`/api/events/${first.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      const publishSecond = await request(app)
        .post(`/api/events/${second.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(publishSecond.status).toBe(200);
    });

    it("horario fora da janela (depois do sessionEndsAt) nao colide", async () => {
      // RAW_MOVIE_DETAILS.runtime = 139 -> janela de 149min.
      const firstStartsAt = futureIso(208);
      const secondStartsAt = new Date(
        new Date(firstStartsAt).getTime() + 150 * 60 * 1000,
      ).toISOString();

      const first = await createTestEvent({ startsAt: firstStartsAt, venue: "CINE_VERZEL_2", room: 1 });
      const second = await createTestEvent({ startsAt: secondStartsAt, venue: "CINE_VERZEL_2", room: 1 });

      await request(app)
        .post(`/api/events/${first.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      const publishSecond = await request(app)
        .post(`/api/events/${second.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(publishSecond.status).toBe(200);
    });

    it("PATCH em evento PUBLISHED para horario colidente retorna 409", async () => {
      const startsAt = futureIso(210);
      const first = await createTestEvent({ startsAt, venue: "CINE_VERZEL_2", room: 2 });
      const second = await createTestEvent({
        startsAt: futureIso(211),
        venue: "CINE_VERZEL_2",
        room: 3,
      });

      await request(app)
        .post(`/api/events/${first.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);
      await request(app)
        .post(`/api/events/${second.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      const patchResponse = await request(app)
        .patch(`/api/events/${second.body.event.id}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ startsAt, room: 2 });

      expect(patchResponse.status).toBe(409);
    });

    it("PATCH em evento ainda DRAFT para horario colidente NAO da erro", async () => {
      const startsAt = futureIso(213);
      const first = await createTestEvent({ startsAt, venue: "CINE_VERZEL_1", room: 1 });
      const second = await createTestEvent({
        startsAt: futureIso(214),
        venue: "CINE_VERZEL_1",
        room: 4,
      });

      await request(app)
        .post(`/api/events/${first.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);
      // second permanece DRAFT (nao publicado).

      const patchResponse = await request(app)
        .patch(`/api/events/${second.body.event.id}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ startsAt, room: 1 });

      expect(patchResponse.status).toBe(200);
    });

    it("PATCH que nao toca startsAt/venue/room nunca dispara a checagem", async () => {
      const startsAt = futureIso(216);
      const first = await createTestEvent({ startsAt, venue: "CINE_VERZEL_2", room: 4 });

      await request(app)
        .post(`/api/events/${first.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      const patchResponse = await request(app)
        .patch(`/api/events/${first.body.event.id}`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ price: 50 });

      expect(patchResponse.status).toBe(200);
    });
  });

  describe("POST /api/events/:id/publish", () => {
    it("publica um evento DRAFT com sucesso", async () => {
      const created = await createTestEvent();
      const response = await request(app)
        .post(`/api/events/${created.body.event.id}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.event.status).toBe("PUBLISHED");
    });

    it("retorna 400 ao publicar um evento ja publicado", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      await request(app)
        .post(`/api/events/${eventId}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      const secondResponse = await request(app)
        .post(`/api/events/${eventId}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(secondResponse.status).toBe(400);
    });

    it("retorna 400 ao publicar evento com data passada", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      await prisma.event.update({
        where: { id: eventId },
        data: { startsAt: new Date(Date.now() - 1000 * 60 * 60) },
      });

      const response = await request(app)
        .post(`/api/events/${eventId}/publish`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(400);
    });
  });

  describe("DELETE /api/events/:id", () => {
    it("exclui o evento e os assentos sem erro de FK", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      const deleteResponse = await request(app)
        .delete(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`);
      expect(deleteResponse.status).toBe(204);

      const remainingSeats = await prisma.eventSeat.findMany({ where: { eventId } });
      expect(remainingSeats).toHaveLength(0);

      const remainingEvent = await prisma.event.findUnique({ where: { id: eventId } });
      expect(remainingEvent).toBeNull();
    });

    it("retorna 400 ao excluir evento com data passada", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      await prisma.event.update({
        where: { id: eventId },
        data: { startsAt: new Date(Date.now() - 1000 * 60 * 60) },
      });

      const response = await request(app)
        .delete(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(400);
    });

    it("retorna 400 e nao exclui quando ha reserva PAID vinculada", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;

      await prisma.ticketReservation.create({
        data: {
          customerId: organizerId,
          eventId,
          status: "PAID",
          quantity: 1,
          totalAmount: 35.5,
        },
      });

      const response = await request(app)
        .delete(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(400);

      const stillExists = await prisma.event.findUnique({ where: { id: eventId } });
      expect(stillExists).not.toBeNull();

      await prisma.ticketReservation.deleteMany({ where: { eventId } });
    });

    it("exclui evento sem vendas mesmo com reserva CANCELLED, pagamento recusado e validacao de portaria vinculados", async () => {
      const created = await createTestEvent();
      const eventId = created.body.event.id;
      const seat = await prisma.eventSeat.findFirstOrThrow({ where: { eventId } });

      const reservation = await prisma.ticketReservation.create({
        data: {
          customerId: organizerId,
          eventId,
          status: "CANCELLED",
          quantity: 1,
          totalAmount: 35.5,
          items: { create: { eventSeatId: seat.id, unitPrice: 35.5 } },
        },
      });
      await prisma.simulatedPayment.create({
        data: {
          reservationId: reservation.id,
          provider: "SIMULATED",
          status: "DECLINED",
          amount: 35.5,
          failureReason: "teste",
        },
      });
      await prisma.gateValidation.create({
        data: {
          ticketId: null,
          gateUserId: organizerId,
          checkedEventId: eventId,
          inputMethod: "MANUAL_CODE",
          result: "INVALID",
          reason: "teste",
        },
      });

      const response = await request(app)
        .delete(`/api/events/${eventId}`)
        .set("Authorization", `Bearer ${organizerToken}`);

      expect(response.status).toBe(204);

      const remainingEvent = await prisma.event.findUnique({ where: { id: eventId } });
      expect(remainingEvent).toBeNull();
      expect(await prisma.ticketReservation.findUnique({ where: { id: reservation.id } })).toBeNull();
    });
  });
});
