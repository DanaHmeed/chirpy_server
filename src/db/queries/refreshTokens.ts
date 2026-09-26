import { eq } from "drizzle-orm";
import { db } from "../index.js";
import {
  refreshTokens,
  users,
} from "../schema.js";

export async function createRefreshToken(
  token: string,
  userId: string,
  expiresAt: Date
) {
  const [result] = await db
    .insert(refreshTokens)
    .values({
      token,
      userId,
      expiresAt,
      revokedAt: null,
    })
    .returning();

  return result;
}

export async function getUserFromRefreshToken(
  token: string
) {
  const [result] = await db
    .select({
      user: users,
      refreshToken: refreshTokens,
    })
    .from(refreshTokens)
    .innerJoin(
      users,
      eq(refreshTokens.userId, users.id)
    )
    .where(eq(refreshTokens.token, token));

  return result;
}

export async function revokeRefreshToken(
  token: string
) {
  const [result] = await db
    .update(refreshTokens)
    .set({
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(refreshTokens.token, token))
    .returning();

  return result;
}