# The template's identity, and the only place it's written down. `make init`
# reads these as the OLD values to replace, which is why scripts/init.sh holds
# none of them itself: a shell script that rewrites its own text mid-run is a
# bug, and the "no old identifier survives" check would trip on the script
# forever. Rewriting this file mid-run is safe because make has already read it.
APP_MODULE ?= github.com/robert-crandall/go-home-template
APP_NAME   ?= Go Home Template
APP_SLUG   ?= go-home-template

.PHONY: help init setup build run dev test check spec clean

# So a frontend build that fails halfway doesn't leave an index.html behind that
# makes the target below look satisfied.
.DELETE_ON_ERROR:

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}'
init: ## Rename this template: make init [MODULE=github.com/you/thing] [NAME=Thing]
	@scripts/init.sh "$(APP_MODULE)" "$(APP_NAME)" "$(APP_SLUG)"

setup: ## First run after cloning: deps, upload dir, .env, and a frontend build
	cd web && bun install --frozen-lockfile
	mkdir -p uploads
	@test -f .env || { cp .env.example .env && echo "wrote .env from .env.example"; }
	cd web && bun run build

# The frontend build has to come first: web/dist.go does `//go:embed all:build`,
# so the Go compile fails outright until web/build exists. That ordering is the
# same reason CI's go job depends on the web job's artifact.
build: ## Build the frontend, then the binary into bin/
	cd web && bun run build
	go build -o bin/$(APP_SLUG) ./cmd/server

run: ## Run the built binary
	./bin/$(APP_SLUG)

dev: ## Vite on :5173 with the API server on :8080
	@scripts/dev.sh

# The embed means `go test ./...` doesn't compile without web/build either, so
# `make clean && make test` needs something there. Building only when it's
# missing keeps the Go test loop fast; `make build` always rebuilds it, because
# that one has to produce a shippable binary.
web/build/index.html:
	cd web && bun run build

test: web/build/index.html ## Run the Go tests
	go test ./...

check: ## Type-check the frontend
	cd web && bun run check

# Regenerate the API contract. cmd/openapi imports internal/app, not web, so
# this needs neither a database nor a frontend build - which is what lets CI
# check for drift in a job that has neither. Both outputs are committed; CI
# fails if running this produces a diff.
spec: ## Regenerate docs/openapi.json and the typed client from the routes
	go run ./cmd/openapi
	cd web && bun run gen:api

clean: ## Remove build output
	rm -rf bin .bin web/build web/.svelte-kit
