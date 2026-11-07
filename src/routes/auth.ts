import { Router } from "express";
import { authenticator } from "otplib";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { requestOtp, verifyOtp } from "../auth/otp.service";
import { serializeUser } from "../auth/serialize";
import { createSession, deleteSession } from "../auth/session";
import { config } from "../config";
import { prisma } from "../db";
import { signMfaToken, verifyMfaToken } from "../lib/crypto";
import { AppError, asyncHandler, badRequest, forbidden, parseBody } from "../lib/errors";
import { normalizePhone } from "../lib/phone";

export const authRouter = Router();

const phoneField = z.string().transform((value, ctx) => {
  const phone = normalizePhone(value);
  if (!phone) {
    ctx.addIssue({ code: "custom", message: "Enter a valid Ethiopian mobile number" });
    return z.NEVER;
  }
  return phone;
});

const isStaff = (role: string) => role === "moderator" || role === "super_admin";

// POST /auth/otp/request
authRouter.post(
  "/otp/request",
  asyncHandler(async (req, res) => {
    const { phone } = parseBody(z.object({ phone: phoneField }), req.body);
    await requestOtp(phone);
    res.status(204).end();
  })
);

// POST /auth/otp/verify  (creates the account on first sign-in)
authRouter.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    const { phone, code, consent } = parseBody(
      z.object({
        phone: phoneField,
        code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
        consent: z.boolean().optional(),
      }),
      req.body
    );

    // Check consent before burning the code, so the user can retry the same code.
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (!existing && consent !== true) {
      throw badRequest("Please accept the privacy notice to create an account", {
        consent: "Required to create an account",
      });
    }

    await verifyOtp(phone, code);

    const user =
      existing ??
      (await prisma.user.create({ data: { phone, consentAt: new Date() } }));

    if (user.status === "suspended") {
      throw new AppError(403, "account_suspended", "This account is suspended");
    }

    // Staff must pass a second factor before a session is created.
    if (isStaff(user.role)) {
      if (!user.mfaSecret) {
        throw new AppError(
          403,
          "mfa_not_enrolled",
          "Staff accounts need an authenticator app. Ask a super admin to enroll you."
        );
      }
      res.json({ mfaRequired: true, mfaToken: signMfaToken(config.APP_SECRET, user.id) });
      return;
    }

    const token = await createSession(user.id);
    res.json({ token, user: serializeUser(user) });
  })
);

// POST /auth/mfa/verify  (staff only)
authRouter.post(
  "/mfa/verify",
  asyncHandler(async (req, res) => {
    const { mfaToken, code } = parseBody(
      z.object({ mfaToken: z.string().min(1), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }),
      req.body
    );

    const userId = verifyMfaToken(config.APP_SECRET, mfaToken);
    if (!userId) throw new AppError(401, "unauthorized", "Sign in again");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !isStaff(user.role) || !user.mfaSecret || user.status === "suspended") {
      throw forbidden();
    }

    if (!authenticator.check(code, user.mfaSecret)) {
      throw new AppError(401, "invalid_code", "That code is wrong or has expired", {
        code: "Wrong or expired code",
      });
    }

    const token = await createSession(user.id);
    res.json({ token, user: serializeUser(user) });
  })
);

// POST /auth/logout
authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.token) await deleteSession(req.token);
    res.status(204).end();
  })
);
