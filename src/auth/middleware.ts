import type { NextFunction, Request, Response } from "express";
import type { Role, User } from "@prisma/client";
import { forbidden, unauthorized } from "../lib/errors";
import { findUserByToken } from "./session";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
    token?: string;
  }
}

function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

// Attaches req.user when a valid token is present; guests pass through.
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearerToken(req);
    if (token) {
      const user = await findUserByToken(token);
      if (user) {
        req.user = user;
        req.token = token;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

// Server-side role check. Hiding buttons in the frontend is never enough.
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}
