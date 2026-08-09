import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/shared/prisma/client.js";
import { ACCESS_TOKEN_COOKIE_NAME, signAccessToken } from "../src/shared/security/token-service.js";

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
    it("autentica com credenciais validas e retorna o usuario, sem token no body", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: TEST_USER.email, password: TEST_USER.password });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeUndefined();
      expect(response.body.user).toMatchObject({
        id: userId,
        email: TEST_USER.email,
        role: TEST_USER.role,
      });
      expect(response.body.user.passwordHash).toBeUndefined();
    });

    it("seta o cookie access_token httpOnly com os atributos corretos", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: TEST_USER.email, password: TEST_USER.password });

      const setCookie = response.headers["set-cookie"] as unknown as string[];
      expect(setCookie).toBeDefined();

      const accessTokenCookie = setCookie.find((cookie) => cookie.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`));
      expect(accessTokenCookie).toBeDefined();
      expect(accessTokenCookie).toMatch(/HttpOnly/i);
      expect(accessTokenCookie).toMatch(/SameSite=Lax/i);
      expect(accessTokenCookie).toMatch(/Path=\//i);
      expect(accessTokenCookie).toMatch(/Max-Age=86400/);
      // NODE_ENV=test no vitest -> secure deve ser false aqui
      expect(accessTokenCookie).not.toMatch(/Secure/i);
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

  describe("POST /api/auth/logout", () => {
    it("limpa o cookie e invalida acesso subsequente via /me", async () => {
      const agent = request.agent(app);

      await agent.post("/api/auth/login").send({ email: TEST_USER.email, password: TEST_USER.password });

      const logoutResponse = await agent.post("/api/auth/logout");
      expect(logoutResponse.status).toBe(200);

      const meResponse = await agent.get("/api/auth/me");
      expect(meResponse.status).toBe(401);
    });

    it("funciona mesmo sem estar logado (sem cookie/header)", async () => {
      const response = await request(app).post("/api/auth/logout");

      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/auth/me", () => {
    it("retorna o usuario autenticado via cookie httpOnly, sem header Authorization", async () => {
      const agent = request.agent(app);

      await agent.post("/api/auth/login").send({ email: TEST_USER.email, password: TEST_USER.password });

      const response = await agent.get("/api/auth/me");

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        id: userId,
        email: TEST_USER.email,
        role: TEST_USER.role,
      });
    });

    it("retorna o usuario autenticado com token valido no header (fallback)", async () => {
      const token = signAccessToken({ sub: userId, role: TEST_USER.role });

      const response = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        id: userId,
        email: TEST_USER.email,
        role: TEST_USER.role,
      });
    });

    it("retorna 401 sem header Authorization e sem cookie", async () => {
      const response = await request(app).get("/api/auth/me");

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Token de autenticacao ausente.");
    });

    it("retorna 401 com token invalido/malformado no header", async () => {
      const response = await request(app).get("/api/auth/me").set("Authorization", "Bearer token-invalido");

      expect(response.status).toBe(401);
    });

    it("retorna 401 com token expirado no header", async () => {
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
