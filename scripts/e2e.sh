#!/usr/bin/env bash
#
# Runs the browser suite against the real binary: the same cmd/server that ships,
# with the SPA embedded in it, talking to a real Postgres.
#
# Usage: scripts/e2e.sh [playwright args...]
set -euo pipefail

cd "$(dirname "$0")/.."

# Rebuild by default. "Build only if missing" would let a local run pass against
# an SPA from three commits ago, which is exactly the failure this suite exists
# to catch. CI sets E2E_REUSE_WEB_BUILD=1 because it just downloaded the same
# artifact the go job used.
if [ "${E2E_REUSE_WEB_BUILD:-}" = "1" ] && [ -f web/build/index.html ]; then
  echo "==> reusing the existing web/build"
else
  echo "==> building the frontend"
  (cd web && bun run build)
fi

echo "==> building the server"
mkdir -p .bin
go build -o .bin/e2e-server ./cmd/server

echo "==> running Playwright"
cd web && bun run e2e "$@"
