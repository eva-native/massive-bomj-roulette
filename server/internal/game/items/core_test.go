package items_test

import (
	"slices"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

// rec is what a speed record gives by default.
const rec = game.DefaultRecordPoints

func spinItems(sc *scenario, p game.PlayerID, results ...string) {
	sc.t.Helper()
	for _, r := range results {
		sc.spin(p, r)
	}
}

func TestBasePoints(t *testing.T) {
	// The example from docs/rules: GTA San Andreas = 30 + 2 + 7.
	if got := game.BasePoints(game.Game{HLTB: 30, Rating: 87, Year: 2004}); got != 39 {
		t.Fatalf("GTA SA base = %d, want 39", got)
	}
	for _, c := range []struct{ rating, year, want int }{
		{90, 2024, 2}, {89, 2023, 4}, {45, 2001, 14}, {44, 2000, 20}, {76, 2016, 6},
	} {
		if got := game.BasePoints(game.Game{Rating: c.rating, Year: c.year}); got != c.want {
			t.Errorf("rating %d year %d: %d, want %d", c.rating, c.year, got, c.want)
		}
	}
}

func TestTurnFlowAndCoreScoring(t *testing.T) {
	sc := newScenario(t)
	alice, bob := sc.player("Алиса"), sc.player("Боб")
	sc.addGame("GTA SA", 30, 87, 2004, alice) // base 39
	sc.addGame("Celeste", 8, 92, 2018, bob)   // base 8 + 1 + 3 = 12

	sc.expectSteps(alice, game.StepSpinItems, game.StepSpinItems, game.StepSpinItems, game.StepSpinGame, game.StepPlay)
	spinItems(sc, alice, "reflex", "reflex", "reflex")
	sc.spin(alice, "GTA SA")
	sc.expectSteps(alice, game.StepPlay)

	sc.finish(alice, game.OutcomeCompleted, 25)
	sc.expectTotal(alice, 0) // not confirmed yet
	if sc.s.CurrentTurn(alice).Reason != game.ReasonStart {
		t.Fatal("the next turn must wait for the judge")
	}

	sc.confirm(alice)
	sc.expectTotal(alice, 39+5+rec) // base + speed (30−25) + record
	sc.expectSteps(alice, game.StepSpinItems, game.StepSpinGame, game.StepPlay)

	// Bob completes the same game faster: the record moves to him.
	spinItems(sc, bob, "reflex", "reflex", "reflex")
	sc.spin(bob, "GTA SA")
	sc.play(bob, game.OutcomeCompleted, 20)
	sc.expectTotal(bob, 39+10+rec)
	sc.expectTotal(alice, 39+5)

	// GTA SA left Alice's wheel; only Celeste remains.
	sc.spin(alice, "reflex")
	sc.expectWheel(alice, "Celeste")
	sc.spin(alice, "Celeste")

	sc.play(alice, game.OutcomeDropped, 3)
	sc.expectTotal(alice, 39+5-6) // −50% of 12
	sc.expectSteps(alice, game.StepSpinDrop, game.StepSpinGame, game.StepPlay)
}

func TestSlowCompletionGivesNoSpeedPenalty(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a) // base 17
	startGame(sc, a, "G")
	sc.play(a, game.OutcomeCompleted, 15) // five hours over HLTB (issue #11)
	sc.expectTotal(a, 17+rec)             // speed 0, not −5
}

func TestSpinsByHours(t *testing.T) {
	sc := newScenario(t)
	sc.s.Settings.SpinsByHours = []game.SpinsRow{{MinHours: 0, Spins: 1}, {MinHours: 20, Spins: 2}, {MinHours: 40, Spins: 3}}
	a := sc.player("Алиса")
	sc.addGame("Long", 30, 80, 2015, a)
	spinItems(sc, a, "reflex", "reflex", "reflex")
	sc.spin(a, "Long")
	sc.play(a, game.OutcomeCompleted, 30)
	sc.expectSteps(a, game.StepSpinItems, game.StepSpinItems, game.StepSpinGame, game.StepPlay)
}

func TestJudgeRejectsOutcome(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a)
	spinItems(sc, a, "reflex", "reflex", "reflex")
	sc.spin(a, "G")
	sc.finish(a, game.OutcomeCompleted, 2)

	pt := sc.playthrough(a)
	expectErr(t, sc.e.ConfirmGame(sc.s, a, pt.ID, true), game.ErrNotJudge)
	if err := sc.e.ConfirmGame(sc.s, sc.judge, pt.ID, false); err != nil {
		t.Fatal(err)
	}
	if pt.Outcome != game.OutcomeNone {
		t.Fatalf("outcome = %q after rejection", pt.Outcome)
	}
	sc.expectSteps(a, game.StepPlay)
	sc.play(a, game.OutcomeCompleted, 9)
	sc.expectTotal(a, 17+1+rec)
}

func TestJudgeCanPlayAndConfirmThemselves(t *testing.T) {
	sc := newScenario(t)
	sc.addGame("G", 10, 80, 2015, sc.judge)
	spinItems(sc, sc.judge, "reflex", "reflex", "reflex")
	sc.spin(sc.judge, "G")
	sc.play(sc.judge, game.OutcomeCompleted, 10)
	sc.expectTotal(sc.judge, 17+0+rec)
}

func TestScoreIsDeterministic(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a)
	spinItems(sc, a, "opaaa", "reflex", "reflex")
	sc.spin(a, "G")
	sc.play(a, game.OutcomeCompleted, 7)
	if first, second := sc.e.Score(sc.s), sc.e.Score(sc.s); !slices.Equal(first, second) {
		t.Fatalf("scores differ:\n%v\n%v", first, second)
	}
}

func TestOncePerPlayerAndSpecialGame(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a)
	sc.addGame("G2", 10, 80, 2015, a)
	sc.s.AddGame(game.Game{Title: "Смута", HLTB: 12, Rating: 40, Year: 2024, SpecialKey: "smuta"})

	spinItems(sc, a, "smuta", "reflex", "reflex")
	sc.expectWheel(a, "G1", "G2") // special games are never on the wheel
	sc.spin(a, "G1")
	if got := sc.currentGame(a); got != "Смута" {
		t.Fatalf("game = %q, want Смута", got)
	}
	sc.play(a, game.OutcomeCompleted, 12)
	sc.expectTotal(a, 12+10+1+0+rec) // base 23, speed 0, record

	// «Внезапный ДЭБ» is gone from Alice's wheel now.
	if slices.Contains(sc.wheel(a), "smuta") {
		t.Fatal("smuta must not appear twice for the same player")
	}
}
