# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MBR (Massive Bomj Roulette) is a web app for the ЛБР event: players spin wheels of effects, bonuses, games and movies, complete or drop games and score points; a judge confirms results; viewers watch live and on an OBS overlay. Go backend (`server/`), React + TypeScript frontend (`web/`), PostgreSQL. The UI, the game rules and the user-facing docs are in Russian.

## Commands

All from the repo root unless noted; `make help` lists everything.

```bash
cp .env.example .env   # dev login (any name, no Discord) is on
make db                # PostgreSQL 17 in Docker on port 5433
make dev-server        # Go server on :8080; migrations run at startup
make dev-web           # Vite on :5173, proxies /api and /auth to :8080

make gen               # sqlc + tygo + item texts from docs/rules — after any change to SQL, migrations, server/internal/api or docs/rules
make check-gen         # gen + fail if generated files differ (CI does this)
make test              # Go + frontend tests
make lint              # go vet, tsc, eslint (CI also runs golangci-lint and `go test -race`)
make build             # bin/mbr with the frontend embedded
```

Single tests:

```bash
cd server && MBR_TEST_DATABASE_URL="postgres://mbr:mbr@localhost:5433/postgres?sslmode=disable" go test ./internal/play/ -run TestFullTurn
cd server && go test ./internal/game/items/ -run TechDrop      # engine/item tests need no database
cd web && npx vitest run src/pages/play.test.tsx -t "locks item fields"
```

Database tests create and drop their own database on the server from `MBR_TEST_DATABASE_URL`; without it they are **skipped silently**, so set it when touching `events`, `play`, `httpapi` or `auth`.

Generated code is committed: `server/internal/store/db` (sqlc), `web/src/api/types.gen.ts` (tygo from `server/internal/api`), `server/internal/game/items/texts_gen.go` (from `docs/rules`). Never edit these by hand.

## Git workflow

Git flow; never commit or push to `main` or `develop` directly.

- `develop` is the integration branch. Work in `feature/<name>` or `fix/<name>` from `develop`, open a PR into `develop` (`gh pr create --base develop`).
- Releases: `release/<version>` from `develop` → PR into `main`, tag the merge. Urgent production fixes: `hotfix/<name>` from `main` → PR into `main`.
- Anything that lands in `main` reaches `develop` only through `main`: once the PR into `main` is merged, open a PR `main` → `develop` (`gh pr create --base develop --head main`). Never open a second PR from the release/hotfix branch into `develop`. Merge both with «Create a merge commit» (no squash or rebase), so the fix keeps one commit hash and `develop` always contains `main`.
- CI runs on PRs and on pushes to `main` and `develop`. Open the PR and wait for green CI; the repo owner reviews and merges.

## Rules come first

`docs/rules/` is the single source of truth for the game rules (item names, kinds, texts, scoring, defaults). Change the rules there first, then the code. Item texts reach the code only through `make gen`; `TestCatalogMatchesDocs` fails if `docs/rules` and the catalog disagree. When a rule is ambiguous, pick the simplest unambiguous behaviour and record it in `docs/rules/README.md`, section «Решения по умолчанию». How to add or change an item: `docs/dev/items.md`. Full developer guide: `docs/dev/README.md`.

## Architecture

**Rules engine (`server/internal/game`)** works on an in-memory snapshot of one event (`game.State`). Actions (`Spin`, `Choose`, `FinishGame`, `ConfirmGame`, `Use`, `SetInput`, `ConfirmItem`, judge undo/edit) mutate the snapshot; `Engine.Score` is a pure function of it. Points are never stored — they are recomputed every time, so changing scoring code changes the points of running events.

- A turn is a list of steps: `spin_items × N` (or `spin_drop` after a drop, or nothing after a technical drop) → `spin_game` → `play`. Items insert extra steps. The next turn starts when the judge confirms the playthrough.
- Items (`game.Def` in `items/catalog.go`) implement hook interfaces from `game/def.go`; each hook gets only the operations it may use (`TurnOps`, `UseOps`, `GameWheel`, `Ledger`). Hooks are re-run on every action, so item data lives in the item's state (`Self.SetState`), never in struct fields.
- `Catalog.Fingerprint` (`game/def.go`) identifies the rules version; at startup running events get a journal line «Правила обновлены» when it changes. It sees item definitions only — **bump `engineRules` when you change engine rules** (turns, scoring).
- Engine tests use a scripted `Picker` (`items/scenario_test.go`: `newScenario`, `sc.spin(p, "label")`); production uses `RandomPicker` with `crypto/rand`.

**Persistence.** What the engine creates (turns, spins, items, playthroughs) is one `jsonb` document per event in `event_states`. Members, games, movies and settings live in their own tables and are put into the snapshot on load. Playthrough ids live only in that document, so tables referring to them (`play_times`) have no foreign key.

**Service layer (`server/internal/play`).** `write()` loads the snapshot under the event's `pg_advisory_xact_lock`, applies the action, saves snapshot + journal (`activity`) in one transaction, then publishes to `live` (SSE) and Discord (`notify`). Views for the player board, leaderboard and judge queue are built here (`views.go`). A finished event serves a frozen copy of its views (`frozenDoc`), not the engine.

**`server/internal/events`** — events, members/roles, pool (games, movies), settings, invites: permission checks and validation. `api.EventSettings` is stored as JSON in `events.settings`; judge-only secrets (webhook, invite code) are blanked in `Get` for others. HTTP handlers (`httpapi`) only decode requests and map service errors (`ErrForbidden`, `ErrConflict`, `InvalidError`, …) to status codes.

**Frontend (`web/src`).** TanStack Query; every query key starts with `['events', slug]`, and `useEventStream` (SSE) invalidates that prefix on each server message, and after the stream reopens following any failure (the server does not replay missed messages; the hook also reopens a stream the browser gave up on), so anything shown refetches. The event page is `pages/event/EventLayout.tsx` with tabs, which reach the event via `useEventContext()` (outlet context). The player's board is `pages/event/play/PlayerBoard.tsx`. Page tests run the whole app against `src/test/fakeBackend.ts` (built-in routes plus `backend.on(method, regex, handler)` overrides); jsdom has no `EventSource`, so stream tests stub it with `src/test/fakeEventSource.ts`. Both themes follow the system (`dark:`); for secondary text, links, errors and success use `text-muted`, `text-link`, `text-danger`, `text-success` (`index.css`), not raw shades without a `dark:` pair for the same state (`hover:` included) or hand-written pairs equal to one of them — `src/lib/contrast.test.ts` checks every class string.

**Play time.** The running timer lives only in the player's browser (`lib/localTimer.ts`, `localStorage`, key per playthrough). «Сохранить сессию» adds its time to one total per game in `play_times` (`play/playtime.go`); the total is only a hint for the hours the player types, which the judge confirms.

**Auth.** Discord OAuth or dev login (`MBR_DEV_LOGIN`). The cookie holds a random token; the database stores only its SHA-256. Admins (`MBR_ADMIN_DISCORD_IDS`; dev ids look like `dev:<name>`) create events; the creator becomes the event's judge.
