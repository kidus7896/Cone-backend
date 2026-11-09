# Deploying Cone

Plain steps for a first launch. Details marked **check** must be confirmed before real users.

## What you need
1. A server (VPS) located in Ethiopia, with Docker. Ask local providers (for example Ethio Telecom data center services, or other Addis-based hosts) for a VPS, managed PostgreSQL or a Postgres you run yourself, and S3-compatible storage (or run MinIO on the same server with a backed-up disk). **check**: prices and availability.
2. A domain name (you choose) pointing at the server: `api.YOURDOMAIN` for this backend, `YOURDOMAIN` for the Lovable frontend, `media.YOURDOMAIN` for photos.
3. An SMS account with AfroMessage for OTP codes. **check**: sender name approval and the exact API fields, since the client is untested.
4. A lawyer's confirmation that your data handling meets Proclamation 1321/2024.

## First deploy
1. Copy `.env.production.example` to `.env` on the server and fill every value. Generate `APP_SECRET` with `openssl rand -hex 32`.
2. Build and start: `docker build -t cone-backend .` then `docker run -d --name cone --restart unless-stopped --env-file .env -p 127.0.0.1:3000:3000 cone-backend`. Migrations run automatically on start.
3. Seed categories and areas once: `docker exec cone npx tsx prisma/seed.ts` (if tsx is missing in the production image, run the seed from your laptop against the production database URL).
4. Put a reverse proxy in front for HTTPS (Caddy is simplest: `api.YOURDOMAIN { reverse_proxy 127.0.0.1:3000 }`). Keep `TRUST_PROXY=1`.
5. Create the first super admin from the server: `docker exec -it cone npx tsx scripts/create-admin.ts +2519XXXXXXXX super_admin`, scan the printed URI in an authenticator app.
6. Check `https://api.YOURDOMAIN/api/v1/categories` returns categories.

## Backups
- Nightly `pg_dump` to a second in-country location; keep 14 days. Test a restore once before launch.
- Back up the photo bucket too.

## Before opening to the public
- Real SMS working (sign in with your own phone).
- Frontend points at the API URL and CORS_ORIGINS matches it exactly.
- Privacy notice and terms published (the sign-up consent box links to them).
- Staff accounts all have authenticator MFA.
- Run `npm run typecheck && npm test` once; they have not been run yet.
