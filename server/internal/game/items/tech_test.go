package items_test

import (
	"slices"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

func TestTechDropCarriesItemsToTheNextGame(t *testing.T) {
	sc := newScenario(t)
	a, b := sc.player("Алиса"), sc.player("Боб")
	sc.addGame("G1", 10, 80, 2015, b) // base 17
	sc.addGame("G2", 10, 80, 2015, b)
	sc.addGame("G3", 10, 80, 2015, b)
	sc.s.AddMovie(game.Movie{Title: "Шрек", AddedBy: b})
	sc.s.AddMovie(game.Movie{Title: "Матрица", AddedBy: b})

	spinItems(sc, a, "babina", "opaaa", "no_step_back")
	sc.spin(a, "G1")
	sc.spin(a, "Шрек")
	first := sc.playthrough(a)

	// Hours are optional: the game could not be played.
	sc.play(a, game.OutcomeTech, 0)
	sc.roundTrip()
	sc.expectTotal(a, 0)

	// Only the game wheel, and the broken game does not come back.
	sc.expectSteps(a, game.StepSpinGame, game.StepPlay)
	sc.expectWheel(a, "G2", "G3")
	sc.spin(a, "G2")
	// «Бабина» already spun its movie: no second movie spin.
	sc.expectSteps(a, game.StepPlay)

	second := sc.playthrough(a)
	for _, id := range []string{"babina", "opaaa", "no_step_back"} {
		it := sc.item(a, id)
		if !slices.Equal(it.Chain, []int64{second.ID}) || it.Placement != game.PlaceAttached {
			t.Errorf("%s: chain %v, placement %s; want only the new game %d", id, it.Chain, it.Placement, second.ID)
		}
		if slices.Contains(it.Chain, first.ID) {
			t.Errorf("%s still works on the broken game", id)
		}
	}

	sc.play(a, game.OutcomeCompleted, 10)
	sc.expectTotal(a, 17+rec+4) // «ОПАААА» counts on the new game
	// The next turn is a normal one again.
	sc.expectSteps(a, game.StepSpinItems, game.StepSpinGame, game.StepPlay)
}

func TestTechDropDoesNotUseUpMultiGameItems(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	for _, g := range []string{"G1", "G2", "G3", "G4"} {
		sc.addGame(g, 10, 80, 2015, a)
	}
	spinItems(sc, a, "no_step_back", "reflex", "reflex")
	sc.spin(a, "G1")
	sc.play(a, game.OutcomeCompleted, 10)
	sc.spin(a, "reflex")
	sc.spin(a, "G2")
	sc.play(a, game.OutcomeTech, 0)
	sc.spin(a, "G3")

	// G2 does not count: the chain is G1, G3 and has room for one more.
	nsb := sc.item(a, "no_step_back")
	if len(nsb.Chain) != 2 {
		t.Fatalf("chain = %v, want 2 games", nsb.Chain)
	}
}

func TestRecordPointsAreAnEventSetting(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a)
	two := 2
	sc.s.Settings.RecordPoints = &two

	spinItems(sc, a, "reflex", "reflex", "reflex")
	sc.spin(a, "G")
	sc.play(a, game.OutcomeCompleted, 10)
	sc.expectTotal(a, 17+2)
}
