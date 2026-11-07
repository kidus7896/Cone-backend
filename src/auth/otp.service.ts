import { config } from "../config";
import { prisma } from "../db";
import { hashOtp, randomCode, safeEqual } from "../lib/crypto";
import { AppError, tooMany } from "../lib/errors";
import { createSmsProvider } from "../lib/sms";

const sms = createSmsProvider();

const MAX_REQUESTS_PER_HOUR = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;

export async function requestOtp(phone: string): Promise<void> {
  const now = Date.now();
  const recent = await prisma.otpCode.findMany({
    where: { phone, createdAt: { gt: new Date(now - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
  });

  if (recent.length >= MAX_REQUESTS_PER_HOUR) {
    throw tooMany("Too many codes requested. Try again in an hour.");
  }
  if (recent[0] && now - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw tooMany("Please wait a moment before requesting another code.");
  }

  const code = randomCode(6);
  await prisma.otpCode.create({
    data: {
      phone,
      codeHash: hashOtp(config.APP_SECRET, phone, code),
      expiresAt: new Date(now + config.OTP_TTL_SECONDS * 1000),
    },
  });

  await sms.send(phone, `Your Cone code is ${code}. It expires in ${Math.round(config.OTP_TTL_SECONDS / 60)} minutes.`);
}

// Returns normally when the code is correct and marks it used.
// Wrong, expired and already-used codes all give the same error so callers learn nothing extra.
export async function verifyOtp(phone: string, code: string): Promise<void> {
  const latest = await prisma.otpCode.findFirst({
    where: { phone, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  const invalid = new AppError(400, "invalid_code", "That code is wrong or has expired", {
    code: "Wrong or expired code",
  });

  if (!latest) throw invalid;
  if (latest.attempts >= config.OTP_MAX_ATTEMPTS) {
    throw tooMany("Too many wrong codes. Request a new code.");
  }

  const ok = safeEqual(latest.codeHash, hashOtp(config.APP_SECRET, phone, code));
  if (!ok) {
    await prisma.otpCode.update({
      where: { id: latest.id },
      data: { attempts: { increment: 1 } },
    });
    throw invalid;
  }

  // Single use. updateMany with usedAt: null guards against two requests using one code.
  const claimed = await prisma.otpCode.updateMany({
    where: { id: latest.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw invalid;
}
