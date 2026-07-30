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

	"github.com/danielgtaylor/huma/v2"
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
	Files  *files.Service
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
	files.Register(api, deps.Files, currentUser)

	// Add your app's own routes here.
}
