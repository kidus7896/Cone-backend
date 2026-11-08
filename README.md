# Cone backend

REST API for **Cone**, a classifieds marketplace for Addis Ababa. The Lovable frontend lives in a separate repository and talks to this API only.

## Status

Done: API contract, database schema, phone OTP sign-in, sessions, staff 2-step sign-in, `/me`, categories and areas (with seed data), listings (create, edit, submit, pause/resume/sold/renew, delete, search), photo upload with compression, favorites, reports, phone reveal, seller pages, sitemap data, listing expiry job.
Not built yet: **admin endpoints** (so nothing can be approved yet: new listings stay `pending_review`), full-text search ranking, deployment notes.

Tested so far: only the pure logic (phone, crypto, listing rules, category tree) was run, using the unit tests in `tests/`. The server, database queries, routes and photo upload have **not** been run or type-checked. Before building further run `npm install`, `npx prisma generate`, `npm run typecheck` and `npm test`, then fix anything they report.

## First run

```bash
cp .env.example .env && docker compose up -d
npm install && npx prisma migrate dev
npm run db:seed        # categories, Addis Ababa sub-cities, default settings (safe to re-run)
npm run dev
```

Create the MinIO bucket named in `S3_BUCKET` (http://localhost:9001, user `cone`, password `conesecret`) and make it publicly readable, or photo URLs will not load.

## Listing rules worth knowing

- Flow: create draft, upload photos, `POST /listings/{id}/submit`. A listing must use a leaf category.
- Editing an approved listing, or adding a photo to one, sends it back to `pending_review`.
- Photos are re-encoded to WebP (max 1600 px, 400 px thumbnail), which also removes GPS data from the files.
- Search matches every word against title and description (case-insensitive). `relevance` currently sorts like `newest`.
- "Posted within N days" and "newest" use the date the draft was created, not the approval date.

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
