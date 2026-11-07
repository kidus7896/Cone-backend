import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

export function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

// Constant-time string comparison (no timing leak on wrong codes).
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomCode(digits = 6): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, "0");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOtp(secret: string, phone: string, code: string): string {
  return hmac(secret, `otp:${phone}:${code}`);
}

export function hashToken(secret: string, token: string): string {
  return hmac(secret, `session:${token}`);
}

// Short-lived signed token that carries a user id between the OTP step and
// the staff authenticator step. Format: userId.expiresAtMs.signature
export function signMfaToken(secret: string, userId: string, ttlMs = 5 * 60 * 1000, now = Date.now()): string {
  const exp = now + ttlMs;
  return `${userId}.${exp}.${hmac(secret, `mfa:${userId}.${exp}`)}`;
}

export function verifyMfaToken(secret: string, token: string, now = Date.now()): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!userId || !Number.isFinite(exp) || exp < now) return null;
  return safeEqual(sig, hmac(secret, `mfa:${userId}.${exp}`)) ? userId : null;
}
