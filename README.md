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
`make clean`, and `make help`.

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
