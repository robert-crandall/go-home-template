#!/usr/bin/env bash
#
# Boots the real server for the Playwright suite. Playwright starts this as its
# `webServer`, from web/, which is why the first thing it does is cd to the repo
# root - a relative ./.bin/e2e-server would otherwise resolve under web/.
#
# Usage: scripts/e2e-server.sh PORT DBNAME
set -euo pipefail

cd "$(dirname "$0")/.."

port="${1:?usage: e2e-server.sh PORT DBNAME}"
dbname="${2:?usage: e2e-server.sh PORT DBNAME}"

url="${E2E_POSTGRES_URL:-postgres://localhost:5432}/$dbname?sslmode=disable"
# Host and database only. This line exists so you can see what is about to be
# wiped before it is; a password in E2E_POSTGRES_URL isn't part of that answer.
echo "==> e2e database: ${url##*@} (about to reset its schema)"

# Reset the database the server is about to use - not a maintenance database -
# so a failed run can't leave rows that make the next one pass or fail for the
# wrong reason. Dropping the schema rather than the database is schema-agnostic
# the same way DROP DATABASE is, but needs no CREATEDB privilege and can't fail
# on a lingering connection. goose rebuilds it at startup.
psql "$url" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'

# The server stats and write-probes UPLOAD_DIR at startup and refuses to boot if
# it's missing.
mkdir -p .bin/e2e-uploads

# Everything the suite depends on gets exported, because config.Load searches up
# to three parent directories for a .env and a developer's own settings would
# otherwise decide how the tests behave. Real environment variables win over
# .env, so this is the override.
#
#   APP_ENV=production would set Secure cookies, and no login survives over
#   plain HTTP.
#   ALLOW_OPEN_REGISTRATION=true would make the "registration is closed" case
#   silently pass by never happening.
export DATABASE_URL="$url"
export ADDR=":$port"
export UPLOAD_DIR="$PWD/.bin/e2e-uploads"
export APP_ENV=development
export ALLOW_OPEN_REGISTRATION=false

# Exported *empty*, not unset. godotenv keys off whether a variable is present
# in the environment, not whether it has a value, so an exported empty variable
# wins while an unset one gets refilled from .env. That matters because
# notify.NewService validates as soon as either key is non-empty, and a
# half-configured .env (one key pasted, or a typo) would crash the server at
# startup with an error that has nothing to do with the tests.
export VAPID_PUBLIC_KEY=
export VAPID_PRIVATE_KEY=

echo "==> starting $PWD/.bin/e2e-server on :$port"
exec ./.bin/e2e-server
