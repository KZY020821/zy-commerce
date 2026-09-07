#!/usr/bin/env bash
# One-command local start for ZY Commerce:
#   pnpm up
# Starts Postgres in Docker, applies migrations, seeds, and runs the dev server.
# Safe to re-run: every step is idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Docker CLI (Docker Desktop on macOS installs it under ~/.docker/bin) ---
if ! command -v docker >/dev/null 2>&1 && [ -x "$HOME/.docker/bin/docker" ]; then
  export PATH="$HOME/.docker/bin:$PATH"
fi
command -v docker >/dev/null 2>&1 || die "docker not found. Install Docker Desktop and open it once."
docker info >/dev/null 2>&1 || die "Docker daemon is not running. Open Docker Desktop and try again."

# --- .env ---------------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env from .env.example"
fi
set_if_blank() { # set_if_blank VAR generated-value
  if grep -qE "^$1=\"\"$" .env; then
    sed -i.bak "s|^$1=\"\"$|$1=\"$2\"|" .env && rm -f .env.bak
    echo "  generated $1 (saved in .env)"
  fi
}
set_if_blank AUTH_SECRET "$(openssl rand -base64 32)"
set_if_blank SEED_SUPER_ADMIN_PASSWORD "$(openssl rand -base64 18 | tr '+/' '-_')"
set_if_blank SEED_DEMO_ADMIN_PASSWORD "$(openssl rand -base64 18 | tr '+/' '-_')"

# --- dependencies -------------------------------------------------------------
if [ ! -d node_modules ]; then
  say "Installing dependencies"
  pnpm install
fi

# --- database -----------------------------------------------------------------
say "Starting Postgres (docker compose)"
docker compose up -d --wait

say "Applying migrations"
pnpm exec prisma migrate deploy

say "Seeding (idempotent)"
pnpm exec prisma db seed

# --- app ----------------------------------------------------------------------
root="$(grep -E '^NEXT_PUBLIC_ROOT_DOMAIN=' .env | sed -E 's/^[^=]+="?([^"]*)"?$/\1/')"
root="${root:-localhost:3000}"
say "Ready. Local logins are in .env (SEED_*). URLs:"
echo "  Platform admin : http://${root}/platform/login"
echo "  Demo storefront: http://demo.${root}/"
echo "  Demo admin     : http://demo.${root}/admin/login"
say "Starting dev server (Ctrl+C to stop; database keeps running — pnpm down stops it)"
exec pnpm dev
