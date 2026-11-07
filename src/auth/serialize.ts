import type { User } from "@prisma/client";

// Shape of the User schema in openapi.yaml. Never include mfaSecret or consent internals.
export function serializeUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    status: user.status,
    areaId: user.areaId,
    createdAt: user.createdAt.toISOString(),
  };
}
