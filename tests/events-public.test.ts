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
  name: "Public Events Test Organizer",
  email: "public-events-test-organizer@example.com",
  password: "123456",
  role: "ORGANIZER" as const,
};

const RAW_MOVIE_DETAILS = {
  id: 551,
  title: "Sessao Publica",
  original_title: "Public Session",
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

let defaultDayOffsetCounter = 2000;
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
    await prisma.eventSeat.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }

  await prisma.externalCatalogItem.deleteMany({ where: { provider: "TMDB", externalId: "551" } });
  await prisma.user.deleteMany({ where: { email: ORGANIZER.email } });
}

describe("public events (UC7/UC9, ator Cliente)", () => {
  let organizerToken: string;

  beforeAll(async () => {
    await cleanupTestData();

    const passwordHash = await bcrypt.hash(ORGANIZER.password, 10);
    const organizer = await prisma.user.create({
      data: { name: ORGANIZER.name, email: ORGANIZER.email, passwordHash, role: ORGANIZER.role },
    });
    organizerToken = signAccessToken({ sub: organizer.id, role: "ORGANIZER" });
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

  async function createDraftEvent(overrides: Partial<Record<string, unknown>> = {}) {
    const response = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${organizerToken}`)
      .send({
        tmdbId: 551,
        startsAt: nextStartsAt(),
        venue: "CINE_VERZEL_1",
        room: 1,
        capacity: 5,
        price: 20,
        ...overrides,
      });
    return response.body.event;
  }

  async function createPublishedEvent(overrides: Partial<Record<string, unknown>> = {}) {
    const event = await createDraftEvent(overrides);
    await request(app).post(`/api/events/${event.id}/publish`).set("Authorization", `Bearer ${organizerToken}`);
    return event;
  }

  describe("GET /api/public/events", () => {
    it("nao exige autenticacao e so lista eventos PUBLISHED", async () => {
      const draft = await createDraftEvent();
      const published = await createPublishedEvent();

      const response = await request(app).get("/api/public/events");

      expect(response.status).toBe(200);
      const ids = response.body.events.map((event: { id: string }) => event.id);
      expect(ids).toContain(published.id);
      expect(ids).not.toContain(draft.id);
      expect(response.body.events.every((event: { status: string }) => event.status === "PUBLISHED")).toBe(
        true,
      );
    });
  });

  describe("GET /api/public/events/:id", () => {
    it("retorna detalhe de evento publicado sem autenticacao", async () => {
      const published = await createPublishedEvent();

      const response = await request(app).get(`/api/public/events/${published.id}`);

      expect(response.status).toBe(200);
      expect(response.body.event).toMatchObject({
        id: published.id,
        status: "PUBLISHED",
        seatsTotal: 5,
        seatsAvailable: 5,
      });
    });

    it("retorna 404 para evento DRAFT", async () => {
      const draft = await createDraftEvent();

      const response = await request(app).get(`/api/public/events/${draft.id}`);

      expect(response.status).toBe(404);
    });

    it("retorna 404 para evento inexistente", async () => {
      const response = await request(app).get(
        "/api/public/events/00000000-0000-0000-0000-000000000000",
      );
      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/public/events/:id/seats", () => {
    it("lista os assentos do evento publicado, ordenados", async () => {
      const published = await createPublishedEvent({ capacity: 3 });

      const response = await request(app).get(`/api/public/events/${published.id}/seats`);

      expect(response.status).toBe(200);
      expect(response.body.seats.map((seat: { code: string }) => seat.code)).toEqual(["A1", "A2", "A3"]);
      expect(response.body.seats.every((seat: { status: string }) => seat.status === "AVAILABLE")).toBe(
        true,
      );
    });

    it("retorna 404 para evento DRAFT", async () => {
      const draft = await createDraftEvent();

      const response = await request(app).get(`/api/public/events/${draft.id}/seats`);

      expect(response.status).toBe(404);
    });
  });
});
