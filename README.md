# Go Home Template

A starting point for a small self-hosted web app: a SvelteKit frontend embedded
in a single Go binary, with auth, Postgres, file uploads, and web push already
wired up.

The backend work lives in [`go-home-server`][foundation], which this repo
imports as a Go module rather than vendoring. You get its features for free and
its bug fixes with a version bump. What's here is the shell around it: the
frontend, the embed, and the build.

[foundation]: https://github.com/robert-crandall/go-home-server

See [`docs/tech-stack.md`](docs/tech-stack.md) for why each piece was chosen.

## Prerequisites

- Go 1.26+
- Bun 1.3+ - the frontend toolchain. Node is not required.
- Postgres 14+ - this repo doesn't run one for you. Point `DATABASE_URL` at
  whatever you already have.

## Getting started

Click **Use this template**, clone your copy, then:

```sh
make init     # rename the template to your app
make setup    # deps, ./uploads, .env, and a first frontend build
```

`make init` reads your `origin` remote, so a bare `make init` usually does the
right thing. Override either half if not:

```sh
make init MODULE=github.com/you/thing NAME=Thing
```

It rewrites the Go module path, the app title, and the binary name across every
tracked text file in one pass, then fails loudly if any of the old identity
survives. (If your new name contains one of the old identifiers - `thing` inside
`go-home-template-thing`, say - it says so and skips that one, because there's
no way to tell a leftover from your own name.) Run it before you write any code:
it's a blanket find-and-replace, and it's much less interesting when there's
only a template underneath it.

Edit `.env` (at minimum `DATABASE_URL`), create that database, then:

```sh
make build && make run     # http://localhost:8080
```

## Developing

```sh
make dev
```

Vite serves the frontend on `:5173` with hot module reloading and proxies `/api`
and `/healthz` to the Go binary on `:8080`. Cookies key on host rather than
port, so a session set through the proxy comes back.

Editing Go means restarting `make dev`. There's no file watcher for that on
purpose - it's one keystroke, and a watcher is a whole extra thing to debug when
the dev loop misbehaves.

Other targets: `make test` (Go tests), `make check` (frontend type check),
`make spec` (regenerate the API contract), `make e2e` (browser tests),
`make clean`, and `make help`.

## Auth and the two screens

The template ships the smallest thing that proves auth works end to end:
`/login` (log in / register) and a guarded `/` that greets you and offers a
logout button. That's it - the rest is yours.

Three pieces make it work, and they're all small enough to read in a sitting:

- **`web/src/lib/api/client.ts`** - `createClient<paths>()` and nothing else. No
  base URL, no headers, no interceptors. The session is an HttpOnly cookie and
  `fetch` sends those on same-origin requests, so there's nothing for the client
  to attach. The browser suite asserts no request ever carried an
  `Authorization` header, so that's checked rather than merely intended.
- **`web/src/lib/auth.svelte.ts`** - a `$state` user and a cached boot promise.
  `ensure()` resolves once, from `GET /api/auth/me`; `signedIn()` and
  `signOut()` update it directly so a login doesn't cost a second round trip.
- **The guards live in `+page.ts`, not the component.** SvelteKit doesn't render
  a page until its `load` resolves, so a signed-out visitor gets a redirect
  instead of a flash of the greeting. `/login` guards the other way and bounces
  anyone already signed in.

Errors are the server's words: `apiErrorMessage` reads huma's `errors[]` when
they're there and its `detail` otherwise, so there's no status-code-to-message
table in the frontend - that would be a second copy of the API's error copy,
drifting quietly. Only a failure to reach the server at all gets local wording,
because in that case there is no server response to render.

Registration is gated by `ALLOW_OPEN_REGISTRATION`. It defaults to `false`,
which means "the first account only" - fine for a single-user app, which is what
this template is shaped for. Set it to `true` if you want anyone to sign up.

## Theming and install metadata

A System / Light / Dark picker sits in the layout, so it's on both screens and
works signed out. The choice lands in `localStorage` and a synchronous inline
script in `web/src/app.html` applies it before the app boots - so a reload, a
browser restart, or a deep link all paint the right palette on the first frame,
never the wrong one first.

The bit worth knowing if you edit it: `data-theme` is only set for an explicit
light or dark choice. daisyUI scopes its dark rule to `:root:not([data-theme])`,
so **System** means no attribute and lets CSS decide, which is both flash-proof
by construction and keeps following the OS live. Adding a fourth theme means
three edits: the `Theme` union in `web/src/lib/theme.svelte.ts` (and the value
list its `read()` accepts), the `options` array in `+layout.svelte`, and the
`themes:` list in `web/src/app.css`.

`web/static/` carries `manifest.webmanifest` and two PNG icons, so browsers
offer "install" and mobile home screens get a real icon. Regenerate them from
`icon.svg` if you change the artwork - the `rsvg-convert` command is in a
comment at the top of that file. There's deliberately no service worker; see
D6 in [`docs/tech-stack.md`](docs/tech-stack.md) for why.

## Testing

```sh
make test    # Go tests: the spec drift check, the route table
make e2e     # a real Chromium against the real binary and a real Postgres
```

`make e2e` builds the SPA, builds `cmd/server`, and hands both to Playwright,
which boots the binary on `:8081` (not `:8080`, so a `make dev` you forgot about
can't collide with it). The whole auth journey is **one** test made of steps -
Playwright gives every test a fresh browser context, so a split suite would
start each step logged out and "still signed in after a reload" would be
checking nothing.

It needs two databases, which this repo doesn't create for you - and they're
configured separately, because they're used by two different things:

```sh
createdb go-home-template_e2e     # the browser suite; its schema is reset per run
createdb go-home-template_test    # the Go API test
```

`make e2e` builds its URL from `E2E_POSTGRES_URL` (default
`postgres://localhost:5432`) plus the database name in `web/playwright.config.ts`.
The Go test reads `TEST_DATABASE_URL` and skips entirely when it's unset.

One case can't be reached from a browser: registering a duplicate email. The
default gate is checked *before* the duplicate check, so a second registration
is always `403 registration is closed`, never `409 email already registered`.
Standing up a second server and database to reach it would be more machinery
than one assertion is worth, so `internal/app/api_test.go` pins all three
refusal strings against a real database instead:

```sh
TEST_DATABASE_URL=postgres://localhost:5432/go-home-template_test?sslmode=disable \
  go test ./internal/app/ -run TestAuthRefusalStrings
```

### Git worktrees

`.env` is gitignored, so a new worktree starts without one and `make setup`
would recreate it from `.env.example` - handing you default config instead of
the config you were actually running. `.worktreeinclude` lists the ignored files
a new worktree should inherit from the main checkout, and `.env` is on it. Add
anything else your app keeps outside git and expects to be there.

Nothing in this repo reads `.worktreeinclude` - it's a manifest for external
worktree tooling that looks for one. Plain `git worktree add` ignores it, so if
your setup doesn't use such tooling, copy `.env` across by hand and the file
costs you nothing.

## The build order

`web/dist.go` embeds the built frontend:

```go
//go:embed all:build
var buildFS embed.FS
```

Two things follow from that, and both bite eventually:

- **The frontend has to be built before the Go compile.** On a clean checkout
  `go build ./...` fails with `pattern all:build: no matching files found`
  until `web/build` exists. `make build`, `make dev`, and CI all order
  themselves around this.
- **`all:` is load-bearing.** Without it, `go:embed` silently skips files and
  directories starting with `_`, which is exactly where SvelteKit puts every
  hashed chunk (`_app/immutable/...`). You get a binary that boots, serves the
  HTML shell, and 404s every script. `web/dist_test.go` checks for those chunks
  so the failure is a red test rather than a confusing afternoon.

## The API contract

Routes are registered in one place, `internal/app/routes.go`:

```go
func RegisterRoutes(api huma.API, deps Deps) { ... }
```

`cmd/server` and `cmd/openapi` are both thin callers of it, which is what keeps
the committed contract honest. Two files are generated and committed:

| File | What it is |
| --- | --- |
| `docs/openapi.json` | the OpenAPI document, straight from the registered routes |
| `web/src/lib/api/schema.d.ts` | TypeScript types generated from that document |

The loop when you add or change a route:

```sh
make spec      # regenerate both, then commit them
```

CI's `spec` job runs the same command and fails if it produces a diff, so a
route change that skips the regeneration is a red build rather than a frontend
that type-checks against a contract the server stopped honoring.

Two things about that job are deliberate. It has **no `DATABASE_URL`** and it
does **not** wait for the frontend build: `cmd/openapi` imports `internal/app`
and never `web`, and `RegisterRoutes` only describes routes, so the generator
runs against nil database pools. If a route handler ever gets called during
registration, it panics on that nil pool - a loud failure in the one place
that's cheap to debug. `internal/app/spec_test.go` covers the same ground
locally, and additionally asserts that two consecutive generations are
byte-identical, because a drift check is only fair if generation is
deterministic.

`openapi-typescript` is pinned to an exact version (no caret) for the same
reason: a patch bump that reformats its output would otherwise show up as
mystery drift on an unrelated pull request.

## Adding your first migration

The foundation owns the `users`, `sessions`, `api_tokens`, `push_subscriptions`,
and `files` tables and migrates them itself. This repo ships no `migrations/`
directory, because an empty one is a thing to explain and a thing to get wrong.
Registering a second migration source at all makes goose create a version table
for it, so an app with no migrations of its own would get an extra table it
never asked for.

It's three small steps rather than uncommenting a line. Create
`migrations/migrations.go`:

```go
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS

const Dir = "."
```

Write `migrations/00001_whatever.sql` as a goose migration. Then add a second
source in `cmd/server/main.go`, next to the foundation's. It needs an import
alias, because `cmd/server` already imports the foundation's package under the
name `migrations`:

```go
import appmigrations "github.com/robert-crandall/go-home-template/migrations"

db.MigrationSource{FS: appmigrations.FS, Dir: appmigrations.Dir},
```

Each source tracks its own goose version table, so your numbering starts at
00001 and never collides with the foundation's.
