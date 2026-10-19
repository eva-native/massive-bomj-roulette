# Common development commands. Run `make help` for the list.

SHELL := /bin/bash
TOOLS := go tool -modfile=tools/go.mod
TEST_DB ?= postgres://mbr:mbr@localhost:5433/postgres?sslmode=disable

.PHONY: help db db-stop dev-server dev-web gen check-gen test test-server test-web lint build docker

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  %-12s %s\n", $$1, $$2}'

db: ## Start the local PostgreSQL (port 5433)
	docker compose up -d --wait db

db-stop: ## Stop the local PostgreSQL
	docker compose stop db

dev-server: ## Run the Go server on :8080 with settings from .env
	set -a && source .env && set +a && cd server && go run ./cmd/mbr

dev-web: ## Run the Vite dev server on :5173 (proxies /api and /auth to :8080)
	cd web && npm run dev

gen: ## Regenerate sqlc queries and TypeScript API types
	cd server && $(TOOLS) sqlc generate && $(TOOLS) tygo generate

check-gen: gen ## Fail if generated code is out of date
	git diff --exit-code -- server/internal/store/db web/src/api/types.gen.ts

test: test-server test-web ## Run all tests

test-server: ## Go tests; database tests use $(TEST_DB)
	cd server && MBR_TEST_DATABASE_URL="$(TEST_DB)" go test ./...

test-web: ## Frontend tests
	cd web && npm test

lint: ## go vet + frontend typecheck and lint
	cd server && go vet ./...
	cd web && npm run typecheck && npm run lint

build: ## Build the frontend and a server binary with it embedded (bin/mbr)
	cd web && npm run build
	find server/internal/webui/dist -mindepth 1 ! -name .gitkeep -exec rm -rf {} +
	cp -R web/dist/. server/internal/webui/dist/
	cd server && CGO_ENABLED=0 go build -o ../bin/mbr ./cmd/mbr

docker: ## Build the Docker image
	docker build -t mbr .
