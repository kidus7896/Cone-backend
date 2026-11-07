# Cone backend

REST API for **Cone**, a classifieds marketplace for Addis Ababa. The Lovable frontend lives in a separate repository and talks to this API only.

## Status

Done: API contract, database schema, project scaffold, phone OTP sign-in, sessions, staff 2-step sign-in, `/me`.
Not built yet: listings, photos, search, favorites, reports, seller pages, admin endpoints, categories and areas seed data.

Tested so far: only the pure logic (phone normalization, hashing, signed tokens) was run. The server, database code and routes have **not** been run or type-checked yet; run `npm install`, `npx prisma generate`, `npm run typecheck` and `npm test` first and fix anything they report.

## Sign-in flow

1. `POST /api/v1/auth/otp/request` with a phone number sends a 6-digit code. Limits: 5 codes per phone per hour, 30 seconds between codes, 30 auth calls per IP per 15 minutes.
2. `POST /api/v1/auth/otp/verify` with phone, code and `consent: true` (first sign-up) returns a token. Codes expire after 5 minutes, allow 5 wrong tries and work once.
3. Moderators and super admins get `mfaRequired` plus an `mfaToken`, then call `POST /api/v1/auth/mfa/verify` with an authenticator code.
4. Send the token as `Authorization: Bearer <token>`.

Create the first staff user on a trusted machine: `npm run admin:create -- +2519XXXXXXXX super_admin`. It prints an authenticator setup URI.

In development, `SMS_PROVIDER=console` prints codes to the server log. The AfroMessage provider is untested against the real API.

## Source of truth

- `openapi.yaml` is the API contract. The frontend builds against it, so change it first and tell the frontend side when it changes.
- `prisma/schema.prisma` is the database schema (PostgreSQL).

## Stack

Node.js 20+, TypeScript, Express, PostgreSQL with Prisma, S3-compatible photo storage, SMS provider for OTP codes.

## Local setup

```bash
cp .env.example .env
docker compose up -d        # PostgreSQL and MinIO
npm install
npx prisma migrate dev      # creates the tables
npm run dev
```

## Rules for this project

- Personal data (phones, accounts, photos) is stored on in-Ethiopia infrastructure in production. Keep database and storage portable (plain PostgreSQL, S3-compatible).
- Secrets live in environment variables, never in code.
- Every endpoint checks the caller's role on the server. Staff actions are written to the append-only audit log.
- No payments, chat or jobs in v1.

## Build order

1. Auth: phone OTP, sessions, rate limits
2. Listings: create, edit, status changes, photo upload and compression
3. Search and filters, public pages data, sitemap
4. Favorites, reports, seller pages, phone reveal
5. Admin: moderation, users, categories, settings, audit log
6. Authorization and flow tests, deployment notes
