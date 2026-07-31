# AGENTS.md

A template for a small self-hosted web app: a SvelteKit SPA compiled into a
single Go binary, with auth, Postgres, file uploads, and web push already
working. The backend is [`go-home-server`][foundation], imported as a Go module
rather than vendored - so `internal/` here is thin, and most behaviour you might
go looking for lives in that dependency. What this repo owns is the frontend,
the embed, and the build.

[foundation]: https://github.com/robert-crandall/go-home-server

This file is the source of truth for working in this repo.
[`README.md`](README.md) is for people running the app;
[`docs/tech-stack.md`](docs/tech-stack.md) records *why* each decision was made
(ADRs D1-D11). Neither is a task list - this is.

## Setup

Needs Go 1.26+, Bun 1.3+, and a Postgres you already run. Node is not required
and is not used (see the bunfig gotcha below).

```sh
make setup        # bun install, ./uploads, .env from .env.example, first frontend build
createdb app      # matches DATABASE_URL in .env.example
```

The two test suites want their own databases, and this repo does not create
them:

```sh
createdb go-home-template_e2e     # browser suite; schema reset every run
createdb go-home-template_test    # the DB-backed Go test
```

## Commands

Most workflows go through the Makefile. All of these were run in this repo; the
times are measured on a warm cache and nothing here is slow.

| Command | What it does | Time |
| --- | --- | --- |
| `make build` | frontend, then `bin/go-home-template` | ~3s |
| `make test` | `go test ./...` (builds the frontend first if missing) | ~8s |
| `make check` | `svelte-check` over the frontend | ~3s |
| `make spec` | regenerate the API contract - **commit both outputs** | ~3s |
| `make e2e` | Playwright + real Chromium against the real binary | ~9s |
| `make dev` | Vite on `:5173` proxying to the Go API on `:8080` | - |
| `go vet ./...` | CI runs this; `make` has no target for it | - |

Narrower forms, which are usually what you want:

```sh
go test ./internal/app/ -run TestSpecIsByteStable   # one Go test
./scripts/e2e.sh tests/nav.spec.ts                 # one browser spec
```

`make e2e` forwards no arguments - call `scripts/e2e.sh` directly for a single
spec. Never run `bun run e2e` on its own: only `scripts/e2e.sh` rebuilds the SPA
and the binary first, so a bare `bun run e2e` silently tests a stale build.

There is no linter or formatter beyond `go vet` and `svelte-check`. Keep Go
`gofmt`-clean.

## Layout

| Path | What's there |
| --- | --- |
| `cmd/server` | the binary that ships; wiring, config, migrations |
| `cmd/openapi` | spec generator - runs with nil DB pools, on purpose |
| `cmd/mcp` | MCP server, deliberately zero tools |
| `internal/app/routes.go` | **every route is registered here**, by both entry points |
| `internal/cicd` | no code - table-tests the shell scripts under `scripts/ci/` |
| `web/src/lib/` | API client, auth store, nav model, theme store |
| `web/src/routes/(app)/` | signed-in pages; the shell and the auth guard wrap this group |
| `web/tests/` | Playwright specs |
| `scripts/ci/` | the decisions `.github/workflows/publish.yml` and `notify.yml` make |

Do not edit, and do not read for intent:

- `docs/openapi.json` and `web/src/lib/api/schema.d.ts` - generated **and**
  committed. Change routes, then run `make spec`. CI fails on any diff.
- `web/build`, `web/.svelte-kit`, `bin/`, `.bin/`, `web/node_modules` - output.

## Conventions

Each of these has a worked example already in the tree. Read the exemplar rather
than inventing a second pattern.

- **Adding a route** - `registerAppState` in `internal/app/routes.go` is the
  full example: `huma.Register` with an explicit `OperationID`, `Errors`, and
  `Security` from `apisec`. `RegisterRoutes` may only *describe* routes; it must
  never query. CI's `spec` job runs it with nil pools and no `DATABASE_URL`, so
  a query during registration panics there. Then `make spec` and commit both
  generated files.
- **Adding a page** - a `+page.svelte` under `web/src/routes/(app)/` plus one
  entry in `navItems` in `web/src/lib/nav.ts`. Nothing else. `web/tests/nav.spec.ts`
  asserts the rendered links are *exactly* `navItems`, so a link hardcoded into
  the shell fails the build.
- **Auth guards live in a `load`, not a component** -
  `web/src/routes/(app)/+layout.ts`. A component-level guard flashes the page
  before redirecting.
- **API errors are the server's words** - `web/src/lib/api/errors.ts`. There is
  no status-code-to-message table in the frontend and adding one is a
  regression.
- **Go tests** are stdlib `testing` only - no assertion library - and usually
  table-driven with the table inlined in the `range`. `TestProbeURL` in
  `cmd/server/healthcheck_test.go` is the exemplar; match the shape of the
  nearest existing test rather than importing a new style. Tests here carry a
  comment saying what a weaker version of the test would fail to catch; that is
  a real convention, not decoration.

## Gotchas

These are the things that waste an hour.

- **The frontend must be built before the Go compile.** `web/dist.go` does
  `//go:embed all:build`, so on a clean checkout `go build ./...` fails with
  `pattern all:build: no matching files found`. `make test` and `make build`
  handle the ordering; a bare `go test ./...` after `make clean` does not.
- **`web/bunfig.toml` is load-bearing and fails silently.** `[run] bun = true`
  is what stops `bun run` from honouring vite's `#!/usr/bin/env node` shebang
  and building under Node. Missing, moved, or typo'd, Bun reports no error - it
  just uses Node. CI asserts it explicitly. Do not "tidy" that file.
- **TypeScript is held below 7 in `web/`.** TS7 drops `ts.factory`, which breaks
  both `svelte-check` and `openapi-typescript` (so it takes out `make spec`).
  Dependabot ignores `>=7.0.0` and that is the repo's only ignore.
- **`TEST_DATABASE_URL` unset means the DB-backed test skips**, so a green
  `make test` can mean "it did not run". To actually run it:
  `TEST_DATABASE_URL=postgres://localhost:5432/go-home-template_test?sslmode=disable go test ./internal/app/ -run TestAuthRefusalStrings`
- **Adding a theme is four edits and the fourth is easy to miss**: the `themes:`
  list in `web/src/app.css`, the `Theme` union and `read()` in
  `web/src/lib/theme.svelte.ts`, `options` in
  `web/src/lib/components/ThemePicker.svelte`, **and** the inline script's own
  whitelist in `web/src/app.html`, which cannot import the TypeScript. Related:
  `data-theme` is set only for an explicit light/dark choice - System means *no
  attribute*, so CSS decides at first paint.
- **Hidden markup still breaks browser specs.** Playwright's `getByRole` skips
  hidden nodes, but `getByText` and `locator()` do not, so leaving a closed
  drawer's markup in the DOM can fail an unrelated spec. Render it only when
  open.
- **`make init` rewrites every tracked text file** except `docs/tech-stack.md`
  and `scripts/init.sh`, then fails if the old identity survives anywhere. New
  docs that name the app are handled automatically; just never hardcode the slug
  into `scripts/init.sh`.
- `make docker-smoke` needs Docker and takes minutes. It is deliberately not in
  CI. Do not run it as routine validation.

## Pull requests

CI (`.github/workflows/ci.yml`) runs five jobs and all must pass: `web`
(bunfig assertion, `bun install --frozen-lockfile`, `bun run check`,
`bun run build`), `go` (`go build`, `go vet`, `go test`), `spec` (`make spec`,
then `git diff --exit-code` on the two generated files), `e2e` (real Postgres,
real binary, plus a DB-backed `TestAuthRefusalStrings`), and `docker-build` (a
cache-only image build).

Local preflight - a subset of CI, not an equivalent:

```sh
make build && make check && go vet ./... && make test && make spec && make e2e
```

The Docker build has no cheap local equivalent; `make docker-smoke` is the
heavyweight one, and CI's version only builds.

Tests are required for behaviour changes. Commit subjects are imperative and
sentence case with no Conventional Commits prefix ("Close the drawer when the
viewport crosses lg"). The body explains *why*, and says what was measured -
including that the new test was confirmed to fail without the change.
