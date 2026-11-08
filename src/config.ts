import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: z.string().default(""),
  // Number of reverse proxies in front of the app (for correct client IPs).
  TRUST_PROXY: z.coerce.number().default(0),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  SMS_PROVIDER: z.enum(["console", "afromessage"]).default("console"),
  SMS_API_KEY: z.string().default(""),
  SMS_SENDER_NAME: z.string().default("Cone"),
  OTP_TTL_SECONDS: z.coerce.number().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  // S3-compatible photo storage. Required in production.
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
  PUBLIC_MEDIA_BASE_URL: z.string().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast at startup with a readable list of what is wrong.
  const problems = parsed.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${problems}`);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.SMS_PROVIDER === "console") {
  throw new Error("SMS_PROVIDER=console is not allowed in production");
}

if (parsed.data.NODE_ENV === "production") {
  const d = parsed.data;
  if (!d.S3_BUCKET || !d.S3_ACCESS_KEY || !d.S3_SECRET_KEY || !d.PUBLIC_MEDIA_BASE_URL) {
    throw new Error("S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY and PUBLIC_MEDIA_BASE_URL are required in production");
  }
}

export const config = parsed.data;
