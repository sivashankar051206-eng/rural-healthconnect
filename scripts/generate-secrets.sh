#!/usr/bin/env sh
# Creates .env from .env.example (if missing) and fills EMPTY secret placeholders
# with freshly generated random values. Existing non-empty values are never changed.
#   ./scripts/generate-secrets.sh
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
chmod 600 .env

rand() { head -c 64 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-"$1"; }

fill() {
  key="$1"; value="$2"
  if grep -q "^${key}=$" .env; then
    # use a delimiter that cannot appear in base64 output
    sed -i.bak "s|^${key}=$|${key}=${value}|" .env && rm -f .env.bak
    echo "generated ${key}"
  fi
}

fill POSTGRES_PASSWORD "$(rand 40)"
fill REDIS_PASSWORD "$(rand 40)"
fill SESSION_SECRET "$(rand 64)"
fill DATA_ENCRYPTION_KEY "$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
echo "Done. Keep .env private and back up DATA_ENCRYPTION_KEY securely (admin MFA seeds depend on it)."
