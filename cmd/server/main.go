// Command server is the app: it loads config, applies the foundation's shared
// migrations, wires auth, web push, and file uploads onto one huma API, and
// serves that API alongside the embedded SPA on a single port.
//
// It starts life as a copy of go-home-server's examples/minimal/main.go, with
// the SPA wired in. Routes live in internal/app so cmd/openapi can generate the
// committed spec from the same registration - add your own there.
package main

import (
	"context"
	"log"
	"net/http"

	"github.com/robert-crandall/go-home-server/auth"
	"github.com/robert-crandall/go-home-server/config"
	"github.com/robert-crandall/go-home-server/db"
	"github.com/robert-crandall/go-home-server/files"
	"github.com/robert-crandall/go-home-server/migrations"
	"github.com/robert-crandall/go-home-server/notify"
	"github.com/robert-crandall/go-home-server/server"

	"github.com/robert-crandall/go-home-template/internal/app"
	"github.com/robert-crandall/go-home-template/web"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx := context.Background()

	// Each migration source tracks its own goose version table, so an app's own
	// migrations can also start at 00001. A real app adds a second source:
	//
	//	db.MigrationSource{FS: myapp.MigrationsFS, Dir: "migrations"}
	if err := db.Migrate(cfg.DatabaseURL, db.MigrationSource{
		FS:        migrations.FS,
		Dir:       migrations.Dir,
		TableName: migrations.TableName,
	}); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	pool, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	authSvc := auth.NewService(pool, cfg.IsProduction())
	authSvc.OpenRegistration = cfg.AllowOpenRegistration

	notifySvc, err := notify.NewService(pool, notify.VAPID{
		Public:  cfg.VAPIDPublic,
		Private: cfg.VAPIDPrivate,
		Subject: cfg.VAPIDSubject,
	})
	if err != nil {
		log.Fatalf("notify: %v", err)
	}

	// A missing or unwritable upload directory is fatal on purpose: the
	// alternative is writing uploads to a container layer that gets thrown away
	// on the next deploy.
	filesSvc, err := files.NewService(pool, files.Options{
		Dir:      cfg.UploadDir,
		MaxBytes: cfg.UploadMaxBytes,
	})
	if err != nil {
		log.Fatal(err)
	}

	srv := server.New(server.Options{
		Title:       app.Title,
		Version:     app.Version,
		Addr:        cfg.Addr,
		SPA:         web.Dist,
		Middlewares: []func(http.Handler) http.Handler{authSvc.Middleware},
		HealthCheck: pool.Ping,
		HumaConfig:  authSvc.TokenHumaConfig,
	})

	// Shared with cmd/openapi, so the committed spec always describes the routes
	// this binary actually serves.
	app.RegisterRoutes(srv.API, app.Deps{
		Auth:   authSvc,
		Notify: notifySvc,
		Files:  filesSvc,
	})

	log.Printf("listening on %s (env=%s)", cfg.Addr, cfg.Env)
	if err := srv.Run(ctx); err != nil {
		log.Fatalf("server: %v", err)
	}
}
