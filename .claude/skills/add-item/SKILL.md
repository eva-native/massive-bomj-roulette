---
name: add-item
description: Add a new item (effect, bonus or drop debuff) to the MBR game or change an existing one — rules in docs/rules first, then make gen, the definition in items/catalog.go, its mechanics and a scenario test. Use when the user asks to add, change or rename an item («предмет», «эффект», «бонус», «дроп-дебафф»).
argument-hint: "[item name and what it does]"
---

# Add or change an item

Request: $ARGUMENTS

`docs/dev/items.md` is the full guide and the source of truth: read it before you start; this skill is the checklist around it. Rules come first: `docs/rules/` decides names, kinds and texts; the code follows.

## 0. Branch

Git flow: from an up-to-date `develop`, work in `feature/item-<id>`. Never commit to `develop` or `main`.

## 1. Pin down the item

From the request, settle:
- **Kind** and file: effect → `docs/rules/effects.md`, bonus → `bonuses.md`, drop debuff → `drop-debuffs.md`. Put it in the section that fits (points, points by result, several games, game choice, …).
- **Name** as players see it, and the rule text in Russian, in the tone of the neighbouring items.
- **`id`**: Latin letters, digits and `_`. It is stored in the database and can never change, so for an existing item keep its `id`.
- **Mechanics**: fixed points, an input the judge confirms, a choice on the game wheel, a rule for people only, …

Ask the user only if the mechanics are unclear. If a detail is merely ambiguous, pick the simplest unambiguous behaviour and record it in `docs/rules/README.md`, section «Решения по умолчанию».

## 2. Rules document

Add the item to its file in the same format as the others:

```markdown
### Название
`id` · короткое описание механики

Текст правила.
```

The project hook runs `make gen` after every edit in `docs/rules`, which rewrites `server/internal/game/items/texts_gen.go`. If hooks are off, run `make gen` yourself. Never edit `texts_gen.go` by hand.

## 3. Definition

Add the item to `Defs()` in `server/internal/game/items/catalog.go`, in document order, under the matching `// ---` comment. Copy the closest existing item; the constructors (`Text`, `FlatPoints`, `Blocker`, `def(...)` with `Input`, `Confirm`, `Param`, `Lifetime`, `Use`, `Special`, …) are in the table in `docs/dev/items.md`. Ready-made `Impl`s for results are in `items/results.go` (`ifTrue`, `perUnit`, `eachListed`, `winnerTakes`, …): prefer them to a new type.

Changing an existing item: also look for its `id` in `items/*_test.go`, `docs/rules` and `web/src` (special handling, tests).

## 4. Own mechanics (only if no existing building block fits)

A type in `items/mechanics.go` (or `game_spin.go` for the game wheel) implementing the hook interfaces from `server/internal/game/def.go` (`Roller`, `GameWheelShaper`, `GameSpunHandler`, `Attacher`, `Scorer`, `User`, …). Rules that tests do not catch:
- Hooks run again on every action: keep data in the item's state (`self.SetState` / `self.LoadState`), never in struct fields.
- `Score` is a pure function: no randomness, no writes.
- A hook gets only the operations it may use; if one is missing, the design is probably wrong. Do not widen the interface without asking.
- Changing the engine itself (turns, scoring), not just an item: bump `engineRules` in `game/def.go` with a comment.

## 5. Scenario test

In `server/internal/game/items/*_test.go` (`mechanics_test.go`, `results_test.go`, …): `newScenario(t)`, players via `sc.player`, games via `sc.addGame`, wheel results via `spinItems(sc, p, "<id>", …)` and `sc.spin(p, "<game>")`, then `sc.play`, `sc.input`, `sc.confirmItem`, `sc.expectTotal`, `sc.expectSteps`. `TestBabina` in `mechanics_test.go` is a full example. Test the points and every branch of the rule text, including drops.

## 6. Check

```bash
cd server && go test ./internal/game/items/   # includes TestCatalogMatchesDocs; no database needed
make check-gen && make test && make lint      # from the repo root, before the PR
```

The UI draws inputs, the use button and steps from server data, so a new item usually needs no frontend change. Only a new kind of turn step needs a component in `web/src/pages/event/play/`.

## 7. Finish

- `CHANGELOG.md`: a line under `## [Unreleased]` (add the section at the top if it is missing).
- Commit the document, `texts_gen.go`, the code and the test together; open a PR into `develop` (`gh pr create --base develop`) and wait for green CI. The repo owner merges.
- In the summary, say that running events pick up the new rules on their next action (the journal notes «Правила обновлены»), and list any decision you recorded in «Решения по умолчанию».
