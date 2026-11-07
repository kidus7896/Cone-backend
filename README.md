# Cone backend

REST API for **Cone**, a classifieds marketplace for Addis Ababa. The Lovable frontend lives in a separate repository and talks to this API only.

## Status

Foundation stage. Done: API contract, database schema, project scaffold. Not built yet: auth, listings, photos, search, moderation, tests. Nothing here has been run yet.

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
