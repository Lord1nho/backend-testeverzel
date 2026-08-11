import { AppError } from "../../shared/errors/app-error.js";
import { comparePassword } from "../../shared/security/password-hasher.js";
import { signAccessToken } from "../../shared/security/token-service.js";
import { findUserByEmail, findUserById } from "./auth.repository.js";
import { toPublicUser } from "./auth.mappers.js";
import type { LoginBody } from "./auth.schemas.js";

const INVALID_CREDENTIALS_MESSAGE = "Credenciais inválidas.";

export async function login({ email, password }: LoginBody) {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
  }

  const isPasswordValid = await comparePassword(password, user.passwordHash);

  if (!isPasswordValid) {
    throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
  }

  const token = signAccessToken({ sub: user.id, role: user.role });

  return {
    token,
    user: toPublicUser(user),
  };
}

export async function getMe(userId: string) {
  const user = await findUserById(userId);

  if (!user) {
    throw new AppError("Usuário não encontrado.", 401);
  }

  return toPublicUser(user);
}
