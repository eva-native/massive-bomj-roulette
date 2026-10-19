package items_test

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

func TestBabina(t *testing.T) {
	sc := newScenario(t)
	a, b := sc.player("Алиса"), sc.player("Боб")
	sc.addGame("G1", 10, 80, 2015, a) // base 17
	sc.addGame("G2", 10, 80, 2015, a)
	m1 := sc.s.AddMovie(game.Movie{Title: "Шрек", AddedBy: b})
	sc.s.AddMovie(game.Movie{Title: "Матрица", AddedBy: b})

	spinItems(sc, a, "babina", "reflex", "reflex")
	sc.spin(a, "G1")
	sc.expectSteps(a, game.StepSpinMovie, game.StepPlay) // the movie wheel comes after the game
	sc.spin(a, "Шрек")
	sc.roundTrip()

	bab := sc.item(a, "babina")
	var st struct{ Movie int64 }
	if err := json.Unmarshal(bab.State, &st); err != nil || st.Movie != m1.ID {
		t.Fatalf("babina state = %s, want movie %d", bab.State, m1.ID)
	}

	// Only the owner (or a judge) may tick «Посмотрено».
	expectErr(t, sc.e.SetInput(sc.s, b, bab.ID, map[string]any{"watched": true}), game.ErrNotAllowed)
	expectErr(t, sc.e.SetInput(sc.s, a, bab.ID, map[string]any{"watched": "yes"}), game.ErrBadInput)
	if err := sc.e.SetInput(sc.s, a, bab.ID, map[string]any{"watched": true}); err != nil {
		t.Fatal(err)
	}

	sc.play(a, game.OutcomeCompleted, 10)
	sc.expectTotal(a, 17+1) // +10 waits for the judge
	if err := sc.e.ConfirmItem(sc.s, sc.judge, bab.ID, true); err != nil {
		t.Fatal(err)
	}
	sc.expectTotal(a, 17+1+10)

	// A watched movie never comes up again for Alice.
	sc.spin(a, "babina")
	sc.spin(a, "G2")
	sc.expectWheel(a, "Матрица")
}

func TestGeraltKeepsTheLongerGame(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("Short", 5, 80, 2015, a)
	sc.addGame("Long", 40, 80, 2015, a)
	sc.addGame("Mid", 20, 80, 2015, a)

	spinItems(sc, a, "geralt", "reflex", "reflex")
	sc.spin(a, "Long")
	sc.expectSteps(a, game.StepSpinGame, game.StepPlay)
	sc.expectWheel(a, "Short", "Mid") // the second spin cannot repeat the first game
	sc.spin(a, "Short")
	sc.expectSteps(a, game.StepPlay)
	if got := sc.currentGame(a); got != "Long" {
		t.Fatalf("game = %q, want Long", got)
	}
}

func TestGeraltTieLetsThePlayerChoose(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	e1 := sc.addGame("Equal 1", 10, 80, 2015, a)
	sc.addGame("Equal 2", 10, 80, 2015, a)

	spinItems(sc, a, "geralt", "reflex", "reflex")
	sc.spin(a, "Equal 2")
	sc.spin(a, "Equal 1")
	sc.expectSteps(a, game.StepChooseGame, game.StepPlay)
	if err := sc.e.Choose(sc.s, a, sc.step(a).ID, 9999); err == nil {
		t.Fatal("a game outside the options must be rejected")
	}
	sc.choose(a, e1.ID)
	if got := sc.currentGame(a); got != "Equal 1" {
		t.Fatalf("game = %q, want Equal 1", got)
	}
}

func TestJohnnyTieTakesTheSecondGame(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("First", 10, 80, 2015, a)
	sc.addGame("Equal 1", 10, 80, 2015, a)
	sc.addGame("Equal 2", 10, 80, 2015, a)

	spinItems(sc, a, "reflex", "reflex", "reflex")
	sc.spin(a, "First")
	sc.play(a, game.OutcomeDropped, 1)

	// The drop wheel has only drop debuffs.
	cat := sc.e.Catalog()
	for _, id := range sc.wheel(a) {
		if cat.Def(id).Kind != game.KindDrop {
			t.Fatalf("%s is on the drop wheel", id)
		}
	}
	sc.spin(a, "johnny")
	sc.spin(a, "Equal 1")
	sc.spin(a, "Equal 2")
	if got := sc.currentGame(a); got != "Equal 2" {
		t.Fatalf("game = %q, want Equal 2", got)
	}
}

func TestBorrowGame(t *testing.T) {
	sc := newScenario(t)
	a, b := sc.player("Алиса"), sc.player("Боб")
	sc.addGame("A1", 10, 80, 2015, a)
	sc.addGame("B1", 10, 80, 2015, b)
	sc.addGame("B2", 10, 80, 2015, b)

	sc.spin(a, "borrow_game")
	sc.expectSteps(a, game.StepSpinItems, game.StepSpinItems, game.StepChoosePlayer, game.StepSpinGame, game.StepPlay)
	spinItems(sc, a, "reflex", "reflex")

	if err := sc.e.Choose(sc.s, a, sc.step(a).ID, int64(a)); err == nil {
		t.Fatal("choosing yourself must fail")
	}
	sc.choose(a, int64(b))
	sc.roundTrip()
	sc.expectWheel(a, "B1", "B2")
	sc.spin(a, "B2")
	if got := sc.currentGame(a); got != "B2" {
		t.Fatalf("game = %q, want B2", got)
	}
}

func TestNoStepBackThreeCompletions(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a) // 10 + 3 + 4 = 17
	sc.addGame("G2", 20, 70, 2010, a) // 20 + 5 + 4 = 29
	sc.addGame("G3", 30, 90, 2024, a) // 30 + 1 + 1 = 32
	sc.addGame("G4", 10, 80, 2015, a)

	spinItems(sc, a, "no_step_back", "reflex", "reflex")
	sc.spin(a, "G1")
	sc.play(a, game.OutcomeCompleted, 10)
	for _, g := range []string{"G2", "G3"} {
		sc.roundTrip()
		sc.spin(a, "reflex")
		sc.spin(a, g)
		sc.play(a, game.OutcomeCompleted, float64(sc.game(g).HLTB))
	}
	// 3 completions with a record each, plus 30% of 17+29+32=78 → 23.
	sc.expectTotal(a, 17+1+29+1+32+1+23)

	sc.spin(a, "reflex")
	sc.spin(a, "G4")
	if n := len(sc.item(a, "no_step_back").Chain); n != 3 {
		t.Fatalf("chain has %d games, want 3 (the 4th game is outside)", n)
	}
}

func TestNoStepBackDropEndsTheChain(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a) // 17
	sc.addGame("G2", 20, 70, 2010, a) // 29
	sc.addGame("G3", 10, 80, 2015, a)

	spinItems(sc, a, "no_step_back", "reflex", "reflex")
	sc.spin(a, "G1")
	sc.play(a, game.OutcomeCompleted, 10)
	sc.spin(a, "reflex")
	sc.spin(a, "G2")
	sc.play(a, game.OutcomeDropped, 5)
	sc.expectTotal(a, 17+1-29) // −100% instead of −50%

	sc.spin(a, "self_sufficient")
	sc.spin(a, "G3")
	if n := len(sc.item(a, "no_step_back").Chain); n != 2 {
		t.Fatalf("chain has %d games, want 2 (the drop ended it)", n)
	}
}

func TestParachuteCancelsNoStepBackPenalty(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a) // 17
	sc.addGame("G2", 20, 70, 2010, a) // 29

	spinItems(sc, a, "no_step_back", "reflex", "reflex")
	sc.spin(a, "G1")
	sc.play(a, game.OutcomeCompleted, 10)
	sc.spin(a, "parachute") // goes to the pocket
	if sc.item(a, "parachute").Placement != game.PlacePocket {
		t.Fatal("a rolled bonus belongs in the pocket")
	}
	sc.spin(a, "G2")
	sc.mustUse(a, "parachute")
	sc.play(a, game.OutcomeDropped, 5)
	sc.expectTotal(a, 17+1) // the drop costs nothing
}

func TestPutinVoteForcesTheNextBonus(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 20, 70, 2010, a) // 29

	spinItems(sc, a, "putin_vote", "parachute", "parachute")
	putin := sc.item(a, "putin_vote")
	var first, second *game.Item
	for _, it := range sc.s.Items {
		if it.Player == a && it.DefID == "parachute" {
			if first == nil {
				first = it
			} else {
				second = it
			}
		}
	}
	if !putin.Finished || !first.Forced || first.Placement != game.PlacePending {
		t.Fatalf("first parachute should be forced onto the next game: putin finished=%v, parachute %+v", putin.Finished, first)
	}
	if second.Placement != game.PlacePocket {
		t.Fatalf("second parachute placement = %s, want pocket", second.Placement)
	}

	sc.spin(a, "G1")
	sc.play(a, game.OutcomeDropped, 2)
	sc.expectTotal(a, 0) // the forced parachute saved the drop
}

func TestDevilDealRerollsTheGameAndResetsTheWheel(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("Old", 10, 80, 2015, a)
	sc.addGame("New", 10, 80, 2015, a)

	spinItems(sc, a, "reflex", "reflex", "reflex")
	sc.spin(a, "Old")
	sc.play(a, game.OutcomeCompleted, 10)

	sc.spin(a, "devil_deal")
	if err := sc.use(a, "devil_deal"); err == nil {
		t.Fatal("nothing to reroll before the game is spun")
	}
	sc.expectWheel(a, "New")
	sc.spin(a, "New")
	ptBefore := sc.playthrough(a).ID

	sc.mustUse(a, "devil_deal")
	sc.expectSteps(a, game.StepSpinGame, game.StepPlay)
	if sc.s.Playthrough(ptBefore) != nil {
		t.Fatal("the old playthrough must be gone")
	}
	sc.expectWheel(a, "Old", "New") // finished games are back
	sc.spin(a, "Old")
	if sc.item(a, "devil_deal").Placement != game.PlaceAttached {
		t.Fatal("the deal keeps working on the new game")
	}
	if err := sc.use(a, "devil_deal"); err == nil {
		t.Fatal("the deal can be used only once")
	}
}

func TestRerollUndoesTheLastSpin(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a)
	sc.addGame("G2", 10, 80, 2015, a)

	sc.spin(a, "reroll")
	sc.spin(a, "opaaa")
	sc.mustUse(a, "reroll")
	if sc.item(a, "reroll").Placement != game.PlaceUsed {
		t.Fatal("the reroll is spent")
	}
	for _, it := range sc.s.Items {
		if it.DefID == "opaaa" && it.Placement != game.PlaceVoided {
			t.Fatal("the rerolled item must be voided")
		}
	}
	sc.expectSteps(a, game.StepSpinItems, game.StepSpinItems, game.StepSpinGame, game.StepPlay)

	sc.spin(a, "reflex")
	sc.spin(a, "reroll") // a second reroll, for the game spin
	sc.spin(a, "G1")
	sc.mustUse(a, "reroll")
	sc.expectSteps(a, game.StepSpinGame, game.StepPlay)
	if sc.s.CurrentTurn(a).Playthrough != 0 {
		t.Fatal("rerolling the game spin removes the playthrough")
	}
	sc.spin(a, "G2")
	if got := sc.currentGame(a); got != "G2" {
		t.Fatalf("game = %q, want G2", got)
	}
}

func TestRerollOnlyRightAfterASpin(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a)

	spinItems(sc, a, "reroll", "reflex", "reflex")
	sc.spin(a, "G1")
	sc.finish(a, game.OutcomeCompleted, 10)
	expectErr(t, sc.use(a, "reroll"), game.ErrNotAllowed)
}

func TestPlotArmorBlocksEffects(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a) // 17
	sc.addGame("G2", 30, 80, 2015, a)

	spinItems(sc, a, "geralt", "plot_armor", "opaaa")
	sc.spin(a, "G1")
	sc.expectSteps(a, game.StepPlay) // geralt is blocked: no second spin
	sc.play(a, game.OutcomeCompleted, 10)
	sc.expectTotal(a, 17+1) // opaaa is blocked too
}

func TestSelfSufficientBlocksBonuses(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a)
	sc.addGame("G2", 10, 80, 2015, a)

	spinItems(sc, a, "reflex", "parachute", "reflex")
	sc.spin(a, "G1")
	sc.play(a, game.OutcomeDropped, 1)
	sc.spin(a, "self_sufficient")
	sc.spin(a, "G2")
	expectErr(t, sc.use(a, "parachute"), game.ErrNotAllowed)
	if sc.item(a, "parachute").Placement != game.PlacePocket {
		t.Fatal("the bonus stays in the pocket")
	}
}

func TestLuckyWheelChoosesTheGame(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a)
	g2 := sc.addGame("G2", 10, 80, 2015, a)

	spinItems(sc, a, "lucky_wheel", "reflex")
	expectErr(t, sc.use(a, "lucky_wheel"), game.ErrNotAllowed) // only instead of the game spin
	sc.spin(a, "reflex")
	sc.mustUse(a, "lucky_wheel")
	sc.expectSteps(a, game.StepChooseGame, game.StepPlay)
	sc.choose(a, g2.ID)
	if got := sc.currentGame(a); got != "G2" {
		t.Fatalf("game = %q, want G2", got)
	}
}

func TestVeteranRerollsItselfOntoTheSameGame(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a) // 17

	spinItems(sc, a, "veteran", "reflex", "reflex")
	sc.spin(a, "G1")
	sc.mustUse(a, "veteran")
	sc.expectSteps(a, game.StepSpinItems, game.StepPlay)
	sc.spin(a, "opaaa")

	op := sc.item(a, "opaaa")
	if op.Placement != game.PlaceAttached || !slices.Contains(op.Chain, sc.playthrough(a).ID) {
		t.Fatalf("the new effect must work on the current game: %+v", op)
	}
	sc.play(a, game.OutcomeCompleted, 10)
	sc.expectTotal(a, 17+1+4)
}

func TestPutinVoteBurnsAForcedReroll(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a)

	spinItems(sc, a, "putin_vote", "reroll", "reflex")
	rr := sc.item(a, "reroll")
	if rr.Placement != game.PlaceUsed || len(rr.Chain) != 0 {
		t.Fatalf("a forced reroll must burn: %+v", rr)
	}
	sc.spin(a, "G1")
	for _, it := range sc.s.Items {
		if it.DefID == "reroll" && len(it.Chain) > 0 {
			t.Fatal("the burnt reroll must not sit on the game")
		}
	}
}

func TestPutinVoteForcesLuckyWheel(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a)
	g2 := sc.addGame("G2", 10, 80, 2015, a)

	spinItems(sc, a, "putin_vote", "lucky_wheel", "reflex")
	sc.expectSteps(a, game.StepChooseGame, game.StepPlay) // the game spin became a choice
	sc.choose(a, g2.ID)
	if got := sc.currentGame(a); got != "G2" {
		t.Fatalf("game = %q, want G2", got)
	}
}
