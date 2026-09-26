import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import type { Request } from "express";
import crypto from "crypto";

export async function hashPassword(
  password: string
): Promise<string> {
  return argon2.hash(password);
}

export async function checkPasswordHash(
  password: string,
  hash: string
): Promise<boolean> {
  return argon2.verify(hash, password);
}

type Payload = Pick<
  JwtPayload,
  "iss" | "sub" | "iat" | "exp"
>;

export function makeJWT(
  userID: string,
  expiresIn: number,
  secret: string
): string {
  const issuedAt = Math.floor(Date.now() / 1000);

  const payload: Payload = {
    iss: "chirpy",
    sub: userID,
    iat: issuedAt,
    exp: issuedAt + expiresIn,
  };

  return jwt.sign(payload, secret);
}

export function validateJWT(
  tokenString: string,
  secret: string
): string {
  const decoded = jwt.verify(
    tokenString,
    secret
  );

  if (
    typeof decoded === "string" ||
    !decoded.sub
  ) {
    throw new Error("Invalid token");
  }

  return decoded.sub;
}
export function getBearerToken(req: Request): string {
  const authHeader = req.get("Authorization");

  if (!authHeader) {
    throw new Error("Authorization header is missing");
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new Error("Invalid Authorization header");
  }

  return token;
}

export function makeRefreshToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function getAPIKey(req: Request): string {
  const authHeader = req.get("Authorization");

  if (!authHeader) {
    throw new Error("Authorization header is missing");
  }

  const [scheme, apiKey] = authHeader.split(" ");

  if (scheme !== "ApiKey" || !apiKey) {
    throw new Error("Invalid Authorization header");
  }

  return apiKey;
}