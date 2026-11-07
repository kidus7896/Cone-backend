// Creates or promotes a staff user and enrolls an authenticator app.
// Usage: npm run admin:create -- +251912345678 super_admin
// Prints a setup URI to scan (as a QR code) or type into an authenticator app.
// Run this only on a trusted machine; the secret is shown once.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { authenticator } from "otplib";
import { normalizePhone } from "../src/lib/phone";

async function main() {
  const [rawPhone, rawRole = "super_admin"] = process.argv.slice(2);
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (!phone) throw new Error("Usage: admin:create <ethiopian phone> [moderator|super_admin]");
  if (rawRole !== "moderator" && rawRole !== "super_admin") {
    throw new Error("Role must be moderator or super_admin");
  }

  const prisma = new PrismaClient();
  const secret = authenticator.generateSecret();
  await prisma.user.upsert({
    where: { phone },
    update: { role: rawRole, mfaSecret: secret, status: "active" },
    create: { phone, role: rawRole, mfaSecret: secret, consentAt: new Date() },
  });
  await prisma.$disconnect();

  console.log(`Staff user ready: ${phone} (${rawRole})`);
  console.log("Add this to an authenticator app:");
  console.log(authenticator.keyuri(phone, "Cone Admin", secret));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
