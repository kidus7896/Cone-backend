#!/usr/bin/env bash
# One-time setup inside a GitHub Codespace. Testing only: use fake data, not real people's.
set -euo pipefail

[ -f .env ] || cp .env.example .env

setenv() { # setenv KEY VALUE: replace or append in .env
  if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >> .env; fi
}

setenv APP_SECRET "$(openssl rand -hex 32)"
setenv CORS_ORIGINS "*"
if [ -n "${CODESPACE_NAME:-}" ]; then
  DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  setenv PUBLIC_MEDIA_BASE_URL "https://${CODESPACE_NAME}-3000.${DOMAIN}/media"
fi

docker compose up -d
echo "Waiting for the database..."
for i in $(seq 1 30); do
  docker compose exec -T db pg_isready -U cone >/dev/null 2>&1 && break
  sleep 2
done

npm install
npx prisma generate
# Create the first migration if none exists yet, otherwise apply the existing ones.
if ls prisma/migrations >/dev/null 2>&1; then
  npx prisma migrate deploy
else
  npx prisma migrate dev --name init --skip-seed || npx prisma db push
fi
npm run db:seed


echo "Setup done. Start the API with: npm run dev"
