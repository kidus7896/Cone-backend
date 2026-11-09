import type { Prisma } from "@prisma/client";

// Both helpers take a transaction client so the change and its audit entry are saved together:
// either both are written or neither is. Nothing in the app updates or deletes these rows.
export async function recordAudit(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Prisma.InputJsonObject = {}
): Promise<void> {
  await tx.auditLog.create({ data: { actorId, action, targetType, targetId, details } });
}

export async function recordModeration(
  tx: Prisma.TransactionClient,
  staffId: string,
  targetType: string,
  targetId: string,
  action: string,
  reason?: string
): Promise<void> {
  await tx.moderationAction.create({
    data: { staffId, targetType, targetId, action, reason: reason ?? null },
  });
}
