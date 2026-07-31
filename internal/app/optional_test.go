package app_test

import (
	"testing"

	"github.com/robert-crandall/go-home-server/server"

	"github.com/robert-crandall/go-home-template/internal/app"
)

// Uploads are optional: cmd/server leaves Deps.Files nil when UPLOAD_DIR is
// unset, and RegisterRoutes then mounts no file endpoints.
//
// This is the only check on that guard that runs on every pull request.
// scripts/docker-smoke.sh proves the same thing against a real container, but
// it isn't in CI - so if the guard is deleted, this is what catches it.
//
// Note what is deliberately *not* asserted: that the committed spec loses those
// paths. It doesn't. cmd/openapi always passes a real files service (see
// SpecModeDeps), so docs/openapi.json describes the template's whole surface and
// an uploads-off deployment serves a subset of it.
func TestFileRoutesAreSkippedWithoutAFilesService(t *testing.T) {
	deps, err := app.SpecModeDeps(t.TempDir())
	if err != nil {
		t.Fatalf("SpecModeDeps: %v", err)
	}
	deps.Files = nil

	// The same wiring SpecJSON uses. HumaConfig is not optional here:
	// RegisterTokens re-checks the finished config and panics without it, which
	// would fail this test for a reason that has nothing to do with files.
	srv := server.New(server.Options{
		Title:      app.Title,
		Version:    app.Version,
		HumaConfig: deps.Auth.TokenHumaConfig,
	})
	app.RegisterRoutes(srv.API, deps)

	paths := srv.API.OpenAPI().Paths

	// Every file path, not a representative sample: the claim is that the file
	// routes are gone, and naming three of four would leave one unasserted.
	for _, p := range []string{
		"/api/files",
		"/api/files/{id}",
		"/api/files/{id}/thumbnail",
	} {
		if _, ok := paths[p]; ok {
			t.Errorf("%s is registered with a nil files service", p)
		}
	}

	// Non-vacuity: registration really did run, so the absences above mean
	// something.
	if _, ok := paths["/api/auth/login"]; !ok {
		t.Error("/api/auth/login is missing - registration didn't run at all")
	}
}
