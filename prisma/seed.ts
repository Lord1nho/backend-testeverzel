import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";

import { prisma } from "../src/shared/prisma/client.js";
import { generateTicketCode } from "../src/shared/security/secure-token.js";
import { signTicketQr } from "../src/shared/security/ticket-qr.js";

const SEED_PASSWORD = "123456";
const SEAT_ROW_SIZE = 10;
const EVENT_CAPACITY = 30;

const ORGANIZER = { name: "Organizador Demo", email: "organizer@demo.com", role: "ORGANIZER" as const };
const CUSTOMER_1 = { name: "Cliente Demo Um", email: "cliente1@demo.com", role: "CUSTOMER" as const };
const CUSTOMER_2 = { name: "Cliente Demo Dois", email: "cliente2@demo.com", role: "CUSTOMER" as const };
const GATE_USER = { name: "Portaria Demo", email: "portaria@demo.com", role: "GATE" as const };

// Snapshot fixo (sem chamar o TMDB de verdade) -- roda direto via Prisma
// pra nao depender de rede durante o deploy/seed em producao.
const CATALOG_SNAPSHOT = {
  provider: "TMDB" as const,
  externalId: "27205",
  type: "MOVIE" as const,
  title: "A Origem",
  imageUrl: "https://image.tmdb.org/t/p/w500/8IB2e4r4oVhHnANbnm7O3Tj6tF8.jpg",
  description:
    "Um ladrao que rouba segredos corporativos por meio do uso da tecnologia de compartilhamento de sonhos recebe a tarefa inversa de plantar uma ideia na mente de um CEO.",
  durationMinutes: 148,
};

// Mesma convencao de codigo usada em events.service.ts (linhas de 10
// assentos: A1..A10, B1..B10, ...).
function generateSeatCodes(capacity: number): string[] {
  const codes: string[] = [];
  for (let index = 0; index < capacity; index += 1) {
    const rowLetter = String.fromCharCode("A".charCodeAt(0) + Math.floor(index / SEAT_ROW_SIZE));
    const seatNumber = (index % SEAT_ROW_SIZE) + 1;
    codes.push(`${rowLetter}${seatNumber}`);
  }
  return codes;
}

async function upsertUser(input: { name: string; email: string; role: "ORGANIZER" | "CUSTOMER" | "GATE" }) {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  return prisma.user.upsert({
    where: { email: input.email },
    update: { name: input.name, role: input.role, passwordHash },
    create: { name: input.name, email: input.email, role: input.role, passwordHash },
  });
}

async function main() {
  const organizer = await upsertUser(ORGANIZER);
  const customer1 = await upsertUser(CUSTOMER_1);
  await upsertUser(CUSTOMER_2);
  await upsertUser(GATE_USER);

  const catalogItem = await prisma.externalCatalogItem.upsert({
    where: { provider_externalId: { provider: CATALOG_SNAPSHOT.provider, externalId: CATALOG_SNAPSHOT.externalId } },
    update: {
      title: CATALOG_SNAPSHOT.title,
      imageUrl: CATALOG_SNAPSHOT.imageUrl,
      description: CATALOG_SNAPSHOT.description,
      durationMinutes: CATALOG_SNAPSHOT.durationMinutes,
    },
    create: {
      provider: CATALOG_SNAPSHOT.provider,
      externalId: CATALOG_SNAPSHOT.externalId,
      type: CATALOG_SNAPSHOT.type,
      title: CATALOG_SNAPSHOT.title,
      imageUrl: CATALOG_SNAPSHOT.imageUrl,
      description: CATALOG_SNAPSHOT.description,
      durationMinutes: CATALOG_SNAPSHOT.durationMinutes,
    },
  });

  // Idempotencia do evento/assentos/ticket: se ja existe um evento deste
  // organizador pra esse item de catalogo, o seed nao mexe nele de novo
  // (senao rodar duas vezes duplicaria assentos/reservas/tickets).
  const existingEvent = await prisma.event.findFirst({
    where: { organizerId: organizer.id, catalogItemId: catalogItem.id },
  });

  if (existingEvent) {
    console.log("Evento seed ja existe -- pulando criacao de evento/assentos/ticket.");
    return;
  }

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const event = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      catalogItemId: catalogItem.id,
      title: CATALOG_SNAPSHOT.title,
      startsAt,
      venue: "CINE_VERZEL_1",
      room: 1,
      capacity: EVENT_CAPACITY,
      price: 35,
      status: "PUBLISHED",
    },
  });

  const seatCodes = generateSeatCodes(EVENT_CAPACITY);
  await prisma.eventSeat.createMany({
    data: seatCodes.map((code) => ({ eventId: event.id, code, status: "AVAILABLE" })),
  });

  // Um assento a parte, ja vendido, com reserva PAID + Ticket VALID pro
  // cliente1 -- pra quem for avaliar conseguir testar "Meus Ingressos" e a
  // portaria sem precisar repetir o fluxo de compra inteiro primeiro.
  const soldSeat = await prisma.eventSeat.findFirstOrThrow({
    where: { eventId: event.id, code: seatCodes[0] },
  });
  await prisma.eventSeat.update({ where: { id: soldSeat.id }, data: { status: "SOLD" } });

  const reservation = await prisma.ticketReservation.create({
    data: {
      customerId: customer1.id,
      eventId: event.id,
      status: "PAID",
      quantity: 1,
      totalAmount: 35,
      items: { create: { eventSeatId: soldSeat.id, unitPrice: 35 } },
    },
  });

  await prisma.simulatedPayment.create({
    data: {
      reservationId: reservation.id,
      provider: "SIMULATED",
      providerReference: `seed-${randomUUID()}`,
      status: "APPROVED",
      amount: 35,
      paidAt: new Date(),
    },
  });

  const ticketId = randomUUID();
  await prisma.ticket.create({
    data: {
      id: ticketId,
      reservationId: reservation.id,
      customerId: customer1.id,
      eventId: event.id,
      eventSeatId: soldSeat.id,
      code: generateTicketCode(),
      qrTokenHash: signTicketQr(ticketId),
      status: "VALID",
    },
  });

  console.log("Seed concluido:");
  console.log(`- ${ORGANIZER.email} / ${SEED_PASSWORD} (ORGANIZER)`);
  console.log(`- ${CUSTOMER_1.email} / ${SEED_PASSWORD} (CUSTOMER, ja com 1 ingresso pago)`);
  console.log(`- ${CUSTOMER_2.email} / ${SEED_PASSWORD} (CUSTOMER)`);
  console.log(`- ${GATE_USER.email} / ${SEED_PASSWORD} (GATE)`);
  console.log(`- Evento "${event.title}" PUBLISHED, ${EVENT_CAPACITY} assentos (1 SOLD, resto AVAILABLE)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
