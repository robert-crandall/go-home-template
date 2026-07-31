// Package app holds everything both entry points need to agree on: the API's
// identity, its dependencies, and the one function that registers its routes.
//
// The split exists so cmd/openapi can produce the committed spec without a
// database. If cmd/server registered routes inline, the only way to learn the
// contract would be to boot the app against Postgres, and the spec would drift
// the moment someone forgot to.
package app

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/robert-crandall/go-home-server/apisec"
	"github.com/robert-crandall/go-home-server/auth"
	"github.com/robert-crandall/go-home-server/files"
	"github.com/robert-crandall/go-home-server/notify"
)

// Title and Version identify the API. They live here rather than in cmd/server
// because they end up in the committed spec, so the generator and the running
// server have to read the same values or every regeneration is a diff.
const (
	Title   = "Go Home Template"
	Version = "1.0.0"
)

// Deps are the services the routes are registered against.
type Deps struct {
	Auth   *auth.Service
	Notify *notify.Service
	// Files is nil for an app that doesn't store files. cmd/server leaves it
	// nil when UPLOAD_DIR is unset, and RegisterRoutes then mounts no file
	// endpoints at all.
	Files *files.Service
}

// RegisterRoutes mounts every operation on the shared huma API.
//
// It only describes and wires routes; it never queries. That is what lets
// SpecJSON pass services built over a nil pool - and the spec test is the
// enforcement, since a query on a nil pool panics.
func RegisterRoutes(api huma.API, deps Deps) {
	deps.Auth.Register(api)
	deps.Auth.RegisterTokens(api) // /api/tokens + bearer auth for scripts/MCP

	currentUser := func(ctx context.Context) (int64, error) {
		u, err := auth.RequireUser(ctx)
		return u.ID, err
	}
	notify.Register(api, deps.Notify, currentUser)

	// Uploads are optional. cmd/openapi always passes a real files service, so
	// the committed spec keeps describing the whole template; a deployment with
	// UPLOAD_DIR unset serves a subset of it.
	if deps.Files != nil {
		files.Register(api, deps.Files, currentUser)
	}

	// Add your app's own routes here.
	registerAppState(api, deps.Auth)
}

// AppState is what the SPA needs to know before anyone has signed in. One field
// today; it's a struct rather than a bare bool so adding the next one isn't a
// breaking change to the contract.
type AppState struct {
	// RegistrationOpen reports whether POST /api/auth/register would be
	// accepted right now. Advisory: under the default gate the register
	// handler re-checks inside its transaction, holding an advisory lock, so a
	// caller can lose the race between asking and posting.
	RegistrationOpen bool `json:"registrationOpen" doc:"Whether registration is currently accepted"`
}

// registerAppState mounts GET /api/app.
//
// This is the template's one app-owned route, and the worked example for the
// line above: an operation registered here, with its security declared through
// apisec rather than by naming schemes by hand (D3).
//
// Public because its whole purpose is to be read by a signed-out visitor on the
// login page. Under the default gate that exposes one bit - whether a
// non-deleted account exists - which `POST /api/auth/register` already gives
// away by refusing. With open registration on it's a constant.
//
// Note it only *describes* the operation here; the query runs per request, so
// spec generation against a nil pool is unaffected.
func registerAppState(api huma.API, authSvc *auth.Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-app-state",
		Summary:     "App state",
		Description: "State the SPA needs before anyone has signed in.",
		Method:      http.MethodGet,
		Path:        "/api/app",
		Errors:      []int{http.StatusInternalServerError},
		Security:    apisec.Public(),
	}, func(ctx context.Context, _ *struct{}) (*appStateOutput, error) {
		open, err := authSvc.RegistrationOpen(ctx)
		if err != nil {
			// Deliberately not the wrapped error: huma renders err.Error() as
			// the problem detail, and a Postgres error is not something an
			// unauthenticated caller should read.
			return nil, huma.Error500InternalServerError("could not read app state")
		}
		return &appStateOutput{Body: AppState{RegistrationOpen: open}}, nil
	})
}

type appStateOutput struct {
	Body AppState
}
