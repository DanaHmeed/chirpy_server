import { db } from "../index.js";
import { chirps, NewChirp } from "../schema.js";
import { eq } from "drizzle-orm";

export async function createChirp(chirp: NewChirp) {
  const [result] = await db
    .insert(chirps)
    .values(chirp)
    .returning();

  return result;
}

export async function getAllChirps() {
  const result = await db
    .select()
    .from(chirps);

  return result;
}

export async function getChirpById(chirpId: string) {
  const [result] = await db
    .select()
    .from(chirps)
    .where(eq(chirps.id, chirpId));

  return result;
}