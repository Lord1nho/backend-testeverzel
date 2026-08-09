import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/shared/prisma/client.js";
import { signAccessToken } from "../src/shared/security/token-service.js";

const app = createApp();

const TEST_USER = {
  name: "Auth Test User",
  email: "auth-test-user@example.com",
  password: "123456",
  role: "CUSTOMER" as const,
};

describe("auth", () => {
  let userId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_USER.password, 10);
    const user = await prisma.user.upsert({
      where: { email: TEST_USER.email },
      update: { passwordHash },
      create: {
        name: TEST_USER.name,
        email: TEST_USER.email,
        passwordHash,
        role: TEST_USER.role,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { email: TEST_USER.email } });
    await prisma.$disconnect();
  });

  describe("POST /api/auth/login", () => {
    it("autentica com credenciais validas e retorna token + usuario", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: TEST_USER.email, password: TEST_USER.password });

      expect(response.status).toBe(200);
      expect(response.body.token).toEqual(expect.any(String));
      expect(response.body.user).toMatchObject({
        id: userId,
        email: TEST_USER.email,
        role: TEST_USER.role,
      });
      expect(response.body.user.passwordHash).toBeUndefined();
    });

    it("rejeita senha incorreta com 401 e mensagem generica", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: TEST_USER.email, password: "senha-errada" });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Credenciais invalidas.");
    });

    it("rejeita email inexistente com 401 e a MESMA mensagem generica", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "nao-existe@example.com", password: "qualquer" });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Credenciais invalidas.");
    });

    it("retorna 400 quando falta email ou password", async () => {
      const response = await request(app).post("/api/auth/login").send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Erro de validacao.");
    });

    it("retorna 400 quando email tem formato invalido", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "nao-e-email", password: "123456" });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/auth/me", () => {
    it("retorna o usuario autenticado com token valido", async () => {
      const token = signAccessToken({ sub: userId, role: TEST_USER.role });

      const response = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        id: userId,
        email: TEST_USER.email,
        role: TEST_USER.role,
      });
    });

    it("retorna 401 sem header Authorization", async () => {
      const response = await request(app).get("/api/auth/me");

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Token de autenticacao ausente.");
    });

    it("retorna 401 com token invalido/malformado", async () => {
      const response = await request(app).get("/api/auth/me").set("Authorization", "Bearer token-invalido");

      expect(response.status).toBe(401);
    });

    it("retorna 401 com token expirado", async () => {
      const expiredToken = jwt.sign({ sub: userId, role: TEST_USER.role }, env.JWT_SECRET, {
        expiresIn: "-1s",
      });

      const response = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Token invalido ou expirado.");
    });
  });
});
