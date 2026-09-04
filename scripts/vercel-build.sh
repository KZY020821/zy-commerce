#!/usr/bin/env bash
# Vercel runs this instead of `pnpm build` (see "vercel-build" in package.json).
# Production deployments migrate and seed the live database before building;
# preview deployments only build, so a feature branch can never migrate prod.
set -euo pipefail

echo "▶ prisma generate"
pnpm exec prisma generate

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "▶ prisma migrate deploy (VERCEL_ENV=production)"
  pnpm exec prisma migrate deploy
  echo "▶ prisma db seed (idempotent)"
  pnpm exec prisma db seed
else
  echo "▶ skipping migrate/seed (VERCEL_ENV=${VERCEL_ENV:-unset})"
fi

echo "▶ next build"
pnpm exec next build
