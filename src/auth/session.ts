import type { User } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { hashToken, randomToken } from "../lib/crypto";

// Tokens are random and only their hash is stored, so a database leak does not
// expose usable sessions. Deleting the row signs the user out everywhere that token is used.
export async function createSession(
  userId: string,
  ttlMs: number = config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
): Promise<string> {
  const token = randomToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(config.APP_SECRET, token),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return token;
}

export async function findUserByToken(token: string): Promise<User | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(config.APP_SECRET, token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  // Suspended users are locked out immediately, even with a valid session.
  if (session.user.status === "suspended") return null;
  return session.user;
}

export async function deleteSession(token: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { tokenHash: hashToken(config.APP_SECRET, token) },
  });
}

export async function deleteAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
