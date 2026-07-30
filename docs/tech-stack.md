# Tech stack

Status: proposed
Date: 2026-07-29

This is the architecture decision record for `go-home-template`. It covers what
the stack is, why each piece is here, and what I deliberately left out. Read it
before adding a dependency.

Every claim about `go-home-server` below was checked against its source, and the
document was reviewed adversarially before being committed. Where something is
an accepted risk rather than a solved problem, it says so.

## What this repo is

`go-home-template` is the **app-shaped half** of my stack. It is the thing you
click "Use this template" on to start a new single-user app.

[`robert-crandall/go-home-server`](https://github.com/robert-crandall/go-home-server)
is the other half: a Go module that owns auth, Postgres wiring, file uploads,
web push, the LLM client, the MCP harness, and the HTTP bootstrap. It is
deliberately *only* a Go module, because that is the part that can physically be
an imported dependency and pick up fixes with `go get -u`.

Everything that can't be imported lives here: the Svelte SPA, the Vite/Tailwind
config, the Dockerfile, and the CI/CD workflows. Those get
copied once per app and then diverge, which is exactly why they belong in a
template rather than a library.

The split in one line: **`go-home-server` is a dependency, `go-home-template` is
a starting point.** You `go get` the first and never edit it; you fork the second
and immediately diverge.

```mermaid
graph TD
  subgraph browser["Browser"]
    SPA["Svelte 5 SPA<br/>SvelteKit + adapter-static<br/>Tailwind 4 + daisyUI 5"]
  end

  subgraph binary["Single Go binary (this repo)"]
    EMBED["go:embed all:web/build"]
    APP["internal/app - RegisterRoutes(), your routes"]
    FOUND["go-home-server<br/>server / auth / files / notify / llm / db"]
  end

  PG[("Postgres 16")]
  DISK[("Upload volume")]

  SPA -->|"fetch /api/* (session cookie)"| FOUND
  EMBED --> SPA
  APP --> FOUND
  FOUND --> PG
  FOUND --> DISK
  APP -->|"cmd/openapi -> docs/openapi.json"| SPA
```

## Decisions at a glance

| Layer | Choice | Version at time of writing |
|---|---|---|
| Backend foundation | `go-home-server` | >= v0.1.5 |
| Language | Go | 1.26 |
| HTTP | chi + huma (from the foundation) | - |
| Database | Postgres, one instance | 16 |
| Migrations | goose, via `db.Migrate` | - |
| Frontend | Svelte + SvelteKit, `adapter-static` in SPA mode | 5.x / 2.x / 3.x |
| Build tool | Vite | 8.x |
| Package manager | Bun - no Node required | 1.3.x |
| Styling | Tailwind CSS + daisyUI | 4.x / 5.x |
| API client | `openapi-typescript` + `openapi-fetch` | 7.x / 0.17.x |
| Packaging | one static binary, SPA embedded | - |
| Container | multi-stage build to distroless | - |
| Orchestration | Docker Compose, on the host - not in this repo | - |
| Deployment | GHCR + Watchtower | - |
| CI/CD | GitHub Actions + Dependabot + auto-merge | - |

## Decisions

### D1 - The backend is `go-home-server`, imported, not copied

`cmd/server/main.go` starts life as a copy of the foundation's
`examples/minimal/main.go` and grows from there. Everything the foundation
already solves (sessions, cookies, bcrypt, API tokens, file uploads with
thumbnails, web push, graceful shutdown, `/healthz`) comes in as a dependency.

**Why:** the whole point of the foundation is that a security fix lands once and
every app picks it up with `go get -u`. Vendoring the source into the template
would break that on day one.

**Minimum version: v0.1.5.** See "Foundation version" at the end.

**Consequence:** the template must not reimplement anything the foundation
offers. If a template app needs different auth behavior, the fix goes upstream.
When in doubt, the rule is: *does this need to know about my app's domain?* If
no, it probably belongs in `go-home-server`.

### D2 - Postgres, one instance, and the template ships zero application tables

The foundation's migrations create five data tables (`users`, `sessions`,
`push_subscriptions`, `api_tokens`, `files`) plus goose's own
`goose_shared_version` bookkeeping table. There is no `file_thumbnails` table:
thumbnails are sidecar files on disk and migration `00006` only adds a
`has_thumbnail` boolean column to `files`.

The template applies exactly those and nothing else. There is no `migrations/`
directory here. `main.go` carries the second `db.MigrationSource` as a commented
block, the way `examples/minimal` does.

**Why:** a template that ships a `notes` table makes every new app start with a
deletion chore, and a half-deleted example table is worse than no example.

**Why not ship an empty `migrations/` package:** `//go:embed *.sql` fails to
compile when no `.sql` file matches, so a migrations package can't be literally
empty. You can get around that with `//go:embed all:.` over a directory holding
only a README, and that shape would compile. I'm not doing it, because the
package would then exist purely to be imported later, and the `MigrationSource`
would still have to stay commented out: **registering a second source at all
makes goose create a version table for it**, so an app with no migrations of its
own would get an extra table it didn't ask for. A package that must not be used
yet is worse than no package.

The honest cost: adding the first migration is not literally "uncomment three
lines." It's create `migrations/migrations.go` (eight lines, copied from the
foundation's), write `00001_whatever.sql`, then uncomment the source. The README
spells that out.

**Tradeoff, stated plainly:** the template's own CI therefore never exercises
the two-migration-source path. `go-home-server`'s `db` tests do, so the risk is
that the *comment* rots, not the code. Keeping the comment byte-identical to
`examples/minimal` is the mitigation.

**Why one Postgres and no cache layer:** these are single-user homelab apps. One
Postgres is the whole data tier. Redis, a queue, and a read replica are all
things to add when something actually hurts.

### D3 - OpenAPI is the contract, and the generated spec is committed

huma generates the OpenAPI spec from the Go handler types. The template turns
that into a build artifact:

1. `internal/app/routes.go` exposes one function, `RegisterRoutes(api huma.API,
   deps Deps)`, which mounts every operation (the foundation's and the app's).
   It is the only place routes are registered. The name matches the foundation's
   README so the two read as one instruction.
2. `cmd/server` calls it with live dependencies.
3. `cmd/openapi` calls it with **spec-mode dependencies** and marshals
   `srv.API.OpenAPI()` to `docs/openapi.json`.
4. `web/src/lib/api/schema.d.ts` is generated from that JSON by
   `openapi-typescript`.
5. CI regenerates both and fails if the committed copies differ.

Steps 2 and 3 sharing one function is the whole point: a spec generated from a
*different* wiring than the one that serves traffic is worse than no spec.

**Spec-mode dependencies are not zero values.** huma only reflects handler types
at registration time, so no database is needed, but the services still have to
be *constructed*: `auth.NewService(nil, true)`, `notify.NewService(nil,
notify.VAPID{})`, and `files.NewService(nil, files.Options{Dir: tmp})` with a
real writable temp dir, because `files.NewService` stats and write-probes it.
`server.Options.HumaConfig` has to be set to `authSvc.TokenHumaConfig` here too,
because the template enables API tokens and `RegisterTokens` panics without it
(D11). As of v0.1.4 the foundation's README documents this whole pattern with a
worked `cmd/openapi`, so the template follows it rather than inventing its own.

The invariant to enforce: **registration may capture a dependency but must never
call one.** An app route whose `huma.Register` call reads from Postgres to build
an enum, say, breaks spec generation. The template ships a test that runs
`RegisterRoutes` with spec-mode deps and no `DATABASE_URL` in the environment,
so violating that invariant fails CI rather than the next release.

**The spec is worth generating because it now describes authentication.** As of
v0.1.4 every foundation operation declares `Security`, and every operation that
can fail enumerates its errors, so the generated types carry typed 401/403/404
variants and the rendered docs show which endpoints take a session cookie, which
also take a bearer token, and which are public. (The one operation without an
`Errors` list is `push-vapid-key`, which is public and has no failure path.)
Before that release the spec claimed the whole API was unauthenticated.

**The app's own routes get the same treatment**, via the `apisec` package
([#34]):

```go
huma.Register(api, huma.Operation{
    OperationID: "list-widgets",
    Method:      http.MethodGet,
    Path:        "/api/widgets",
    Errors:      []int{http.StatusUnauthorized},
    Security:    apisec.User(api),
}, listWidgets)
```

`apisec.User` is the one to reach for: it matches what `auth.Middleware` plus
`RequireUser` actually accept, and it decides whether to include bearer by
asking the API rather than guessing, so an app that drops API tokens (D11)
automatically gets a session-only requirement instead of a spec referencing a
scheme that isn't declared. `Session` is for credential-management routes,
`Public` for unauthenticated ones. Pass the same `api` you're registering the
operation on: these helpers also install the session scheme on it if it's
missing. The template never writes scheme names by hand; that was [#33], and
hand-written literals are exactly what `apisec` exists to stop.

**Why `openapi-typescript` + `openapi-fetch` over a full client generator:**
`openapi-fetch` is a thin typed wrapper over `fetch` (roughly 6 kB minified)
that reads the generated types directly. Generators like Orval or hey-api emit a
class per tag and a runtime, which is a lot of machinery for an app with a dozen
endpoints. If the API grows past that, switching is contained because only
`web/src/lib/api/` imports it.

**Why commit the spec instead of generating at build time:** the diff is the
review. A PR that silently changes a response shape shows up as a spec diff,
which is the single most useful signal in the whole CI run. huma marshals the
spec with `encoding/json`, so the byte output is stable run to run; pin the
`openapi-typescript` version so `schema.d.ts` is too.

**Known wart:** huma's default config installs a schema-link transformer, so
request and response body schemas both grow a read-only optional `$schema`
field, and the generated TypeScript types will show it on both sides. Harmless,
but don't be surprised by it.

### D4 - SvelteKit with `adapter-static`, in SPA mode

Svelte 5 (runes) and SvelteKit 2, built by `@sveltejs/adapter-static` with
`fallback: 'index.html'` and `export const ssr = false` in the root layout.
Output goes to `web/build/`, which `web/dist.go` embeds:

```go
//go:embed all:build
var buildFS embed.FS

// Dist is the built SPA rooted at index.html, which is what
// server.Options.SPA expects.
var Dist, _ = fs.Sub(buildFS, "build")
```

**Why SvelteKit and not plain Vite + Svelte:** the template needs routing,
layouts, and a place to put per-route data loading on day one. Plain Vite means
picking a third-party router, and the Svelte 5 router landscape is thin. Turning
SSR off in SvelteKit costs one line and keeps file-based routing, `$app/state`,
and the documentation everyone reads.

**Why SPA mode and not SSR:** SSR would need a Node runtime next to the Go
binary, which destroys the single-binary deploy. There is no SEO requirement and
no cold-start-sensitive first paint here. This is the one decision that would be
genuinely expensive to reverse, and I'm taking it deliberately.

**Why `all:` in the embed directive:** SvelteKit emits `_app/`, and plain
`//go:embed build` skips directories starting with `_`. Without `all:` the app
compiles, boots, serves `index.html`, and then 404s every script. This is the
one trap here that stays silent: `index.html` is embedded either way. Forgetting
`fs.Sub` is the loud one - since v0.1.4 `server.New` panics at startup with
`server: SPA has no index.html at its root - did you forget fs.Sub(embedded,
"build")?`.

**Caching lines up with SvelteKit's layout.** The foundation serves
`_app/immutable/` and `assets/` with a one-year immutable `Cache-Control` and
everything else `no-cache`, which is exactly the split SvelteKit produces:
content-hashed chunks under `_app/immutable/`, and `index.html` plus
`_app/version.json` revalidated on every load so a deploy is picked up. The
template must not put unhashed output under either prefix.

**The build-order consequence, which is the sharpest edge in this whole
document:** `//go:embed all:build` means **`go build ./...` fails on a clean
checkout** until the frontend has been built at least once, because the embed
pattern matches nothing. That is not a bug to work around by committing the
bundle. It is a build graph, and it has to be respected everywhere:

- `make build` runs `bun run build` before `go build`. `make setup` does it once
  after clone, and the README's first instruction is `make setup`.
- CI runs the `web` job first and passes `web/build` to the Go, e2e, and Docker
  jobs as an artifact (D9).
- `web/build/` is gitignored. Nothing generated is committed except
  `docs/openapi.json` and `schema.d.ts`, which are reviewable text.

Locally this bites exactly once per clone: after the first `make setup`,
`web/build` exists on disk and bare `go test ./...` works normally.

**Deep links work** because the foundation's not-found handler already falls
back to `index.html` for non-`/api` paths and returns a JSON 404 for unknown
`/api` paths. `fallback: 'index.html'` is the client-side half of the same
contract.

**Dev loop:** Vite dev server on 5173 proxying `/api` and `/healthz` to the Go
server on 8080. Cookies are keyed by host and not by port, so the session cookie
set by `localhost:8080` through the proxy is sent back by the page on
`localhost:5173`. `APP_ENV=development` leaves `Secure` off, so it works over
plain HTTP.

**Why Bun and not npm:** the prerequisite list is Go, Postgres, and one more
thing. Bun makes that one thing a single ~50MB binary that installs, runs
scripts, and executes JavaScript, instead of a Node install plus npm. Vite still
bundles - `bun build` is Bun's own bundler and is not in play here, and neither
is `bun test`. This is a toolchain swap, not a rewrite. Dependabot supports
`package-ecosystem: bun` for version updates (Bun >= 1.1.39), so nothing is lost
on the maintenance side either. The version is pinned in one place per surface
and both track the same minor: `bun-version: '1.3.x'` in CI, `oven/bun:1.3-alpine`
in the Docker builder. Patch floats within that minor; moving the minor is
deliberate maintenance and has to change both at once. Dependabot's `bun`
ecosystem updates the dependencies in `web/`, not either of these pins.

**One non-obvious consequence, and it's why `web/bunfig.toml` exists.** `vite`,
`svelte-kit`, and `svelte-check` are all installed with a `#!/usr/bin/env node`
shebang, and `bun run` respects that shebang by default - it only aliases `node`
to itself when `node` is *absent* from `$PATH`. Left alone, that means the same
`bun run build` builds under Node on a machine that has Node (a dev laptop, and
every GitHub runner, which ships Node preinstalled) and under Bun on the clean
clone this template is designed for. Two runtimes for one command, chosen by an
invisible property of the host, with CI exercising the one the template does not
require. `bunfig.toml` sets `[run] bun = true`, so there is one runtime
everywhere and CI tests the one a fresh clone gets. The trade is real and worth
naming: Vite under Bun is a less-travelled path than Vite under Node. Running it
on every PR is the mitigation.

### D5 - Tailwind CSS 4 and daisyUI 5 for theming

Tailwind 4 via `@tailwindcss/vite`, configured CSS-first. daisyUI is loaded as a
Tailwind plugin from the stylesheet, with no `tailwind.config.js` at all:

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: light --default, dark --prefersdark;
}
```

Theme selection is `data-theme` on `<html>`, persisted in `localStorage`, with a
tiny inline script in `app.html` that applies the saved theme *before* the app
boots. Without that script a static SPA paints the default theme for a frame and
then snaps to the user's choice.

**Why daisyUI:** it gives semantic component classes (`btn`, `card`, `input`,
`navbar`) and a real theme system on top of Tailwind, so a template app looks
finished without me hand-rolling a design system. Theming is the specific reason
it's here: switching the entire palette is one attribute, and adding a custom
theme is a `@plugin "daisyui/theme"` block rather than a token refactor.

**Why not a component library like Skeleton or Flowbite-Svelte:** those own your
component API, so they're a much harder dependency to remove later. daisyUI is
CSS classes; the markup stays plain Svelte, and worst case I delete the plugin
and keep writing Tailwind.

**Consequence:** semantic color classes only (`bg-base-100`, `text-base-content`,
`btn-primary`). A hardcoded `bg-white` is a bug, because it survives the theme
switch and looks broken in dark mode.

### D6 - What the SPA does, which is almost nothing

The entire frontend:

- `/login` - email and password, with a register tab. Surfaces the foundation's
  real errors: 403 when registration is closed, 409 when the email is taken,
  401 on a bad login.
- `/` - guarded. Says hello to `user.email`, shows a theme switcher and a logout
  button. This is the "hello world."
- A route guard that calls `GET /api/auth/me` once on boot and redirects to
  `/login` on 401.

That is the whole list. No file upload demo, no API token screen, no push
subscription UI, no `src/routes/demo/` folder.

**Why so little:** every screen in a template is a screen someone has to read,
understand, and then delete, which is the same tax as the example database table
in D2. Login and hello world are the two that prove the whole stack works end to
end: cookie auth, the generated client, the embedded SPA, deep-link fallback,
and theming. A third screen proves nothing new about the stack and costs every
app that starts here.

The template does ship static PWA metadata (`manifest.webmanifest`, icons)
because it's inert markup with no code to delete. It does **not** ship a service
worker: SvelteKit auto-registers `src/service-worker.ts` in production builds, so
a half-considered one is an asset-caching bug waiting to happen in every app that
forgets it's there. See "Deliberately not here" for the web push consequence.

### D7 - One binary, no reverse proxy in the container

The Go binary serves the API and the SPA on one port. No nginx, no Caddy sidecar,
no CORS configuration, no separate frontend deploy, no `VITE_API_URL`.

**On CSRF, stated accurately.** The session cookie is `SameSite=Lax`, which is
what stops an ordinary cross-site page from POSTing to the API with your cookie
attached. Two caveats that are accepted rather than solved:

- Every cookie-authenticated `/api` request, **including GET**, slides the
  session's `expires_at` and re-sends the cookie. So a cross-site top-level
  navigation (which Lax does allow) can extend a session. It cannot read the
  response or change anything else.
- Lax is same-*site*, not same-*origin*. A hostile origin under the same
  registrable domain is still same-site. That matters for a shared apex domain
  and not much otherwise.

Neither is worth code at this threat model, but don't read "SameSite=Lax" as
comprehensive CSRF protection, and don't bolt on a CSRF token library thinking
something is missing. Both caveats are now written down in the foundation's own
"Acknowledged, not fixed" list as of v0.1.4, so this section restates an upstream
position rather than asserting one.

TLS termination is somebody else's job (Cloudflare Tunnel, Tailscale, or a
reverse proxy on the host). The container speaks plain HTTP.

### D8 - Multi-stage Docker build to distroless

```
web-build   --platform=$BUILDPLATFORM  oven/bun:1.3-alpine  bun install --frozen-lockfile && bun run build
go-build    --platform=$BUILDPLATFORM  golang:1.26          CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build
runtime                                distroless/static-debian12:nonroot
```

Both build stages are pinned to `$BUILDPLATFORM` so neither ever runs under QEMU;
the Go stage cross-compiles to `$TARGETARCH`. A multi-arch (amd64 + arm64) build
is then two native compiles rather than one native compile plus one emulated
one. Go cross-compiles for free, and there's no reason to pay the emulation tax.
`$TARGETOS` is declared alongside `$TARGETARCH` rather than hardcoding `linux`,
so the `ARG`s and the build command can't drift apart.

`CGO_ENABLED=0` matters twice: it's what makes `distroless/static` viable, and
it's consistent with the foundation's decision not to support HEIC/AVIF
thumbnails, which would have dragged in cgo.

**Healthchecks:** distroless has no shell and no curl, so `HEALTHCHECK CMD curl`
does not work. The binary gets a `healthcheck` subcommand that hits its own
`/healthz` and exits 0 or 1. Three details that make it correct rather than
merely present: it dispatches on `os.Args[1]` *before* any config load or
migration work; it takes the **port** from `ADDR` and always dials
`127.0.0.1:<port>`, because `ADDR` defaults to `:8080` and can be `0.0.0.0:8080`
or `[::]:8080`, none of which are dialable as-is; and the Dockerfile uses
exec-form `HEALTHCHECK` because there's no shell to parse the string form.

**No compose file ships here.** This was in the template originally and came
back out: the working app on this exact deploy model doesn't have one. Local
development runs the binary against a Postgres already on the box, and the
production compose file lives on the host next to everything else that host
runs. A compose file in the repo would be a fourth copy to keep in sync with
three real ones, and `make init` would have to rename a service in it.

What survives is the knowledge, as a README snippet the host operator copies
once. Two things in it are not obvious and are the reason it's written down at
all:

- `db.Migrate` has no connection retry, so the app exits if Postgres isn't
  accepting connections yet. On the host that means `condition: service_healthy`
  against a real Postgres healthcheck, or a restart policy that tolerates a few
  crash-loops on reboot. The template can't choose this for you because it
  doesn't know whether Postgres is even a container on your box.
- `distroless:nonroot` runs as UID 65532, and if Docker has to create a missing
  bind-mount source on Linux it creates it root-owned. `files.NewService`
  write-probes `UPLOAD_DIR` and refuses to start if it can't write, so the host
  directory has to exist and be **writable by** UID 65532. Ownership is the
  simplest way there (`chown 65532:65532`) but group permissions or an ACL work
  too, and on Docker Desktop or rootless Docker the mapping differs and it may
  need nothing at all.

That refusal is a feature, not an obstacle: it means a missing or unwritable
volume is a startup crash instead of photos written into a container layer that
the next deploy discards.

### D9 - CI, CD, and Dependabot

CI on every PR and push to main. The job graph matters because of the embed
described in D4, and because publishing keys off CI's overall conclusion, so a
job that doesn't gate the graph doesn't gate a deploy either:

| Job | Needs | What it runs |
|---|---|---|
| `web` | - | `bun install --frozen-lockfile`, then `bun run check` (svelte-check), `bun run lint` (eslint), `bun run test` (vitest), `bun run build`, upload `web/build` |
| `go` | `web` | download artifact, then `go build ./... && go vet ./... && go test ./...` |
| `spec` | - | `go run ./cmd/openapi`, `bun install --frozen-lockfile` + `bun run gen:api`, fail on diff |
| `e2e` | `web` | download artifact, build the real binary, run it against Postgres, run Playwright |
| `docker-build` | - | `docker buildx build` for amd64 + arm64, cache output only. PRs stop here |

Publish is deliberately *not* in this graph; it's a separate workflow, below.

`spec` needs no artifact: `go run ./cmd/openapi` only compiles `cmd/openapi` and
its imports, and `web/dist.go` isn't one of them. `go build ./...` in the `go`
job does compile it, which is why that job needs the artifact.

`docker-build` builds to cache and asserts only that the Dockerfile still works.
It can't `--load` its result into the local daemon, because a multi-platform
`buildx` result isn't loadable - so there's nothing to hand downstream even if
publishing lived here.

The E2E spec is one flow: register the first user, land on hello world, toggle
the theme, log out, log back in. It is the only test that exercises the embedded
SPA, the cookie round trip, and the deep-link fallback together, which is why
it's worth the Playwright dependency.

Two notes on the details:

- `go test ./...`, not `go test -p 1 ./...`. The foundation needs `-p 1` because
  its own `auth` and `files` integration test packages share one database and
  wipe `users` on setup. Nothing in the template does that. Add `-p 1` the day
  you add a second package with database integration tests, not before, and add
  the Postgres service to the `go` job on the same day. Until then only `e2e`
  needs a database.
- The GHCR image path comes from `${{ github.repository }}`, so a repo created
  from this template publishes under its own name without anyone editing a
  workflow.

**Publishing is its own `workflow_run` workflow, triggered by CI completing.**
It's separate mostly so the guard below can be a real job, but the thing worth
writing down is a race that exists either way: publish work starts when the CI
run that validated a commit *finishes*, and CI completion order is not push
order. Merge two PRs a few minutes apart, let the first one's CI be slow, and
the older commit publishes last - quietly moving `:main` backwards onto older
code. A `concurrency` group on the publish workflow doesn't fix it either: by
the time the stale run gets there the newer one is long done, so there's
nothing left to be concurrent with.

So publish is gated by a `guard` job that checks three things about the CI run
that triggered it: it was a push (`github.event.workflow_run.event`, not
`github.event_name` - this workflow's own event is always `workflow_run`), CI
passed, and the commit CI tested is *still* the branch tip. The guard
always runs and emits the answer as an output; the build job carries
`if: needs.guard.outputs.should_publish == 'true'`, so it's the *build* job
that gets skipped on a stale commit. Skipped rather than exiting zero, because
the notification below keys off that job's conclusion, and a job that
"succeeded" without pushing an image would tell the homelab to redeploy
something it already has.

`publish` tags the image `:main`, `:<sha>`, and `:v1.2.3`, and builds from the
sha CI validated rather than whatever the branch tip is by then. That means
checking out `github.event.workflow_run.head_sha` - in a `workflow_run`
workflow `github.sha` is the default branch, not the commit that triggered you,
which is a quiet way to publish the wrong code. Deployment is Watchtower on the
host, watching the mutable tag; I'm not putting a deploy key in GitHub Actions
for a homelab box.

**Notifications** are a third workflow, fanning out from the other two, and both
halves are opt-in - unset the secret and they no-op, so a fork isn't broken by
secrets it doesn't have:

- Slack, when CI fails on a **push** to main. Not on pull requests, not on
  cancellations, and not on success. A notification that fires when things are
  fine is a notification you learn to ignore.
- A Watchtower webhook, after an image was really published. It reads the
  *job* conclusion via `gh api .../jobs`, not the workflow's, because a guarded
  publish leaves a green wrapper behind - and then waits a beat for the registry
  to settle before pinging, since Watchtower pulls immediately.

The two jobs get their secrets scoped separately, so the third-party Slack
action never sees the webhook that can trigger a deploy.

Dependabot covers four ecosystems weekly: `gomod` (`/`), `bun` (`/web`),
`github-actions` (`/`), and `docker` (`/`). Minor and patch updates are grouped
into one PR per ecosystem; majors come as standalone PRs so they're at least
legible.

The foundation's `dependabot-auto-merge.yml` is copied verbatim, including the
two guards that make it **race-safe**: it skips if main advanced after CI ran,
and it merges with `--match-head-commit` so a Dependabot force-push after CI
can't sneak an untested tip into main.

Race-safe is not the same as safe. Majors auto-merge too, and CI's E2E flow
covers auth and the SPA shell but not files, push, tokens, or MCP. That's an
accepted risk with one caveat worth stating plainly: **rolling back the GHCR tag
does not roll back the database.** Startup runs goose `Up` only, so a foundation
release carrying a migration has already changed the schema by the time you
notice - and with Watchtower on a mutable tag, that can happen while you're
asleep. Recovering means restoring Postgres, which this template does not do for
you. So the default has a precondition rather than a mitigation: **auto-merging
majors assumes you already keep external, tested backups of both Postgres and
`UPLOAD_DIR`.** If a repo built from this template doesn't, the fix is to change
the default and gate majors, not to hope.

**Why `workflow_run` auto-merge instead of branch protection plus native
auto-merge:** native auto-merge needs a required-status-check blocker on main,
which also blocks direct pushes to main. This keeps main unprotected for me
while still gating Dependabot on green CI. That reasoning is the foundation's
and I'm keeping it.

### D10 - Renaming the template is the first step, before anything is generated

A repo created from a GitHub template keeps this repo's identity until someone
changes it, and Go makes that more visible than most stacks: the module path is
in `go.mod` and every internal import, and `mcp.AppName` derives the MCP server
binary name and its `~/.config/<app>.json` path from the *basename* of the main
module path.

So the template ships `make init MODULE=github.com/owner/repo NAME=my-app`,
defaulting `MODULE` from the `origin` remote so the usual case is just
`make init`. It runs `go mod edit -module`, rewrites internal imports, and
updates the app title, binary name, `package.json` name, and
the PWA manifest.

Two constraints on its design:

- **A name alone isn't enough.** `github.com/<owner>/<repo>` can't be derived
  from `my-app`, which is why `MODULE` exists as a separate input.
- **Rename first, generate second.** `docs/openapi.json` embeds the API title
  and `web/build` embeds the manifest, so running `make setup` before
  `make init` leaves generated output carrying the old identity. `make init`
  therefore regenerates both at the end and fails if any old identifier
  survives anywhere in the tree. That last check is what makes this reliable
  rather than a checklist people half-follow.

The GHCR path is deliberately *not* rewritten: the workflow uses
`${{ github.repository }}` so there's nothing to rename.

This is boring, and skipping it is how you end up with three apps that all think
they're called `go-home-template`.

### D11 - Optional pieces, mostly off by default

Wired but inert unless configured, so an app opts in by setting an env var
rather than by writing plumbing. API tokens are the one exception - they're on,
which means `/api/tokens` exists on a fresh app:

- **API tokens** - on, because the MCP server needs them and they cost nothing
  when unused. No UI (D6); mint one with `curl`. Since v0.1.4 this is a pair:
  `server.Options{HumaConfig: authSvc.TokenHumaConfig}` at construction, then
  `authSvc.RegisterTokens(api)` at registration. `RegisterTokens` panics if the
  config wasn't applied, which is the right trade - a missing bearer scheme in
  the spec used to be silent. `HumaConfig` is a single function slot, so if the
  template ever wants its own huma tweaks it composes them inside one closure -
  and `TokenHumaConfig` goes **last**, because `RegisterTokens` re-checks the
  finished config and a later tweak that replaces `Components` or
  `SecuritySchemes` would strip the schemes back out and trip the panic.
- **Bearer beats cookie, so don't send both.** With tokens enabled, a request
  carrying an `Authorization: Bearer` header is committed to token auth and
  never falls back to the session cookie, so a stale token 401s a browser that
  has a perfectly good session. The SPA must not attach one.
- **Web push** - the server half is registered, and stays disabled while both
  VAPID keys are empty. Note that it's both or neither: `notify.NewService`
  validates the pair (shape, P-256 sizes, and that the public key really derives
  from the private one) whenever *either* is set, so a half-configured app fails
  at startup rather than at send time. The browser half is not here; see below.
- **LLM** (`llm` package) - not wired. Add it when the app calls a model.
  `llm.New` fails at startup when no provider key is set, which is right for an
  app that uses it and wrong as a default for one that doesn't.
- **MCP server** (`cmd/mcp`) - shipped with zero tools registered and a comment
  showing how to add one. The foundation's rule stands: an MCP tool is a thin
  client of the app's own HTTP API and never owns domain logic.

## Environment

All of these come from `go-home-server`'s `config.Load` (plus an optional
`.env`); the template adds none of its own. `.env.example` ships with the
required ones filled in for local development.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `ADDR` | no | defaults to `:8080` |
| `APP_ENV` | no | `production` turns on `Secure` cookies |
| `ALLOW_OPEN_REGISTRATION` | no | default is first-user-only |
| `UPLOAD_DIR` | yes | must already exist and be writable by UID 65532 |
| `UPLOAD_MAX_BYTES` | no | defaults to 25 MiB |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | no | both keys or neither; one alone is a startup error |
| `SESSION_SECRET` | no | read but unused by the foundation |

## Operations

The parts that make this a deployable app rather than a demo, and that a
homelab template gets wrong by omission more often than by design:

- **Backups.** Not in this template - I back up Postgres with the same thing
  that backs up everything else on the box, and a `make backup` here would be a
  worse copy of it. What the template owes you is the part that's easy to get
  half right: there are **two** things to back up, a `pg_dump` of Postgres *and*
  the `UPLOAD_DIR` tree, because file bytes live on disk and only their metadata
  is in the database. Restore one without the other and you get rows pointing at
  missing files, or orphaned files nobody can reach. Test the restore once
  rather than assuming it, especially before turning on major auto-merge - see
  D9.
- **Pulling the image.** GHCR packages are private by default, so the homelab
  host needs either `docker login ghcr.io` with a read-only PAT or the package
  set to public. The README covers both; pick one at setup time, not at 2am
  during a deploy.
- **Restarts.** `restart: unless-stopped` in the host's compose file, which also
  covers the case in D8 where the app exits because Postgres wasn't up yet.
- **Uptime.** `/healthz` returns 503 when the database ping fails, so point
  whatever you already run at it. The foundation gives this away for free as
  long as `server.Options.HealthCheck` is set to `pool.Ping`.

## Deliberately not here

- **SSR / server-side rendering.** See D4.
- **A service worker, and therefore the browser half of web push.** See D6.
  Still the most likely first addition to any app built from this template, but
  no longer undocumented: v0.1.4 added `docs/web-push.md` upstream with the
  minimal subscribe flow and service worker. Left out here because a template
  that ships a service worker ships a caching strategy, and the wrong caching
  strategy is worse than none.
- **A state management library.** Svelte 5 runes plus a couple of `.svelte.ts`
  modules cover a single-user app.
- **A component library.** See D5.
- **Redis, a job queue, a worker process.** Postgres and a goroutine until
  proven otherwise.
- **Kubernetes.** Compose on one box.
- **Multi-tenancy.** The foundation is first-user-only by default, and every
  foundation resource is scoped to a user id, so turning the app multi-user is
  `ALLOW_OPEN_REGISTRATION=true` and nothing more *for the foundation's
  endpoints*. Your own tables and handlers still have to do their own per-user
  authorization; nothing enforces that for you.
- **Rate limiting, a WAF, security headers middleware.** See the threat model.

## Threat model

Single-user apps on a private network, reachable through a tunnel rather than a
public IP. A failure mode that needs a hostile party already inside the LAN, or
that I can undo by re-registering, gets documented rather than coded around.
This mirrors `go-home-server`'s "Acknowledged, not fixed" section, and the same
request applies: if you think one of these has actually become a problem, make
the case rather than opening a hardening PR.

Accepted here:

- **No login rate limiting.** bcrypt at default cost is the throttle, and the
  endpoint isn't on the public internet. The foundation does compare against a
  dummy hash on the unknown-user path, so login timing doesn't leak whether an
  email exists.
- **huma's default metadata routes are unauthenticated.** `huma.DefaultConfig`
  mounts `/docs`, `/openapi.json`, `/openapi.yaml` (plus the 3.0 variants), and
  `/schemas/{schema}`. They leak the API shape, not data. Since v0.1.4 this is
  an actual choice rather than a constraint - `Options.HumaConfig` can blank
  those paths - and the choice is to leave them on, because the rendered docs
  are the fastest way to poke at the API and the spec they expose is committed
  to a public template repo anyway.
- **The CSRF caveats in D7.**
- **The first-user registration window**, inherited from the foundation.
- **Dependabot auto-merges major versions**, per D9.

## Foundation version

**This template requires `go-home-server` v0.1.5 or later.** Not a soft
preference: `auth.Service.TokenHumaConfig` landed in v0.1.4 and `RegisterTokens`
panics without it, and the `apisec` package landed in v0.1.5, so the wiring in
D3 and D11 won't compile or boot against anything earlier.

That work came out of writing this document's first draft against v0.1.3, which
turned up ten things that belonged upstream rather than worked around here. What
the document absorbed: D3 (the spec describes authentication now, token wiring
is a two-part pairing, and app routes declare security through `apisec`), D4
(the cache-prefix mismatch is gone and the `fs.Sub` mistake is a boot panic), D7
and the threat model (both cite upstream rather than assert), and D11.

[#33]: https://github.com/robert-crandall/go-home-server/issues/33
[#34]: https://github.com/robert-crandall/go-home-server/pull/34
