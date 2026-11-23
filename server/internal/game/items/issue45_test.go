package items_test

import (
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

func TestAlphabetUsesOriginalEligibleSectors(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	for _, title := range []string{"Ёж", "ёжик", "Ель", "Юла"} {
		sc.addGame(title, 4, 80, 2015, a)
	}
	sc.addGame("Ёлка", 4, 80, 2015, sc.judge)
	startGame(sc, a, "Ёж", "alphabet", "alphabet")
	sc.mustUse(a, "alphabet")
	sc.roundTrip()
	sc.expectWheel(a, "ёжик")
	sc.spin(a, "ёжик")
	if err := sc.e.Use(sc.s, a, sc.item(a, "alphabet").ID); err == nil {
		t.Fatal("rerolled a singleton wheel")
	}
}

func TestFateCopiesFinalGameScore(t *testing.T) {
	for _, outcome := range []game.Outcome{game.OutcomeCompleted, game.OutcomeDropped} {
		t.Run(string(outcome), func(t *testing.T) {
			sc := newScenario(t)
			a, b := sc.player("Алиса"), sc.player("Боб")
			sc.addGame("G", 10, 80, 2015, a)
			spinItems(sc, a, "shared_fate", "opaaa", "reflex")
			sc.choose(a, int64(b))
			sc.spin(a, "G")
			sc.finish(a, outcome, 6)
			sc.expectTotal(b, 0)
			sc.roundTrip()
			sc.confirm(a)
			want := 17 + 4 + rec + 4
			if outcome == game.OutcomeDropped {
				want = -8 + 4
			}
			sc.expectTotal(a, want)
			sc.expectTotal(b, want)
		})
	}
}

func TestDeadlineThreshold(t *testing.T) {
	for _, tc := range []struct {
		outcome game.Outcome
		hours   float64
		extra   int
	}{
		{game.OutcomeCompleted, 6.99, 15}, {game.OutcomeCompleted, 7, 0}, {game.OutcomeDropped, 2, 0},
	} {
		sc := newScenario(t)
		a := sc.player("Алиса")
		sc.addGame("G", 10, 80, 2015, a)
		startGame(sc, a, "G", "deadline")
		sc.mustUse(a, "deadline")
		sc.play(a, tc.outcome, tc.hours)
		got := 0
		for _, en := range sc.e.Score(sc.s) {
			if en.Source == "deadline" {
				got += en.Points
			}
		}
		if got != tc.extra {
			t.Errorf("%+v: got %d", tc, got)
		}
	}
}

func TestVampirismAndHighscoreConfirmation(t *testing.T) {
	sc := newScenario(t)
	a, b := sc.player("Алиса"), sc.player("Боб")
	sc.addGame("G", 10, 80, 2015, a)
	startGame(sc, a, "G", "vampirism", "highscore")
	sc.mustUse(a, "vampirism")
	v, h := sc.item(a, "vampirism"), sc.item(a, "highscore")
	sc.input(a, v, map[string]any{"opponent": int(b)})
	sc.input(a, h, map[string]any{"first": true})
	sc.expectTotal(a, 0)
	sc.confirmItem(v)
	sc.confirmItem(h)
	sc.roundTrip()
	sc.expectTotal(a, 13)
	sc.expectTotal(b, -3)
	_ = sc.e.ConfirmItem(sc.s, sc.judge, h.ID, true, "")
	sc.expectTotal(a, 13)
}

func TestAceDaysAndExclusiveHolder(t *testing.T) {
	sc := newScenario(t)
	a, b := sc.player("Алиса"), sc.player("Боб")
	sc.spin(a, "pocket_ace")
	ace := sc.item(a, "pocket_ace")
	ace.State, _ = json.Marshal(map[string]any{"Received": time.Now().Add(-49 * time.Hour)})
	sc.spin(b, "pocket_ace")
	sc.expectTotal(b, 1)
	if sc.item(b, "pocket_ace").Placement != game.PlaceUsed {
		t.Fatal("second player retained the ace")
	}
	sc.roundTrip()
	sc.mustUse(a, "pocket_ace")
	sc.expectTotal(a, 3)
	sc.spin(b, "pocket_ace")
	if sc.item(b, "pocket_ace").Placement != game.PlacePocket {
		t.Fatal("ace unavailable after holder spent it")
	}
}

func TestChoosingItemsHonorsWheelAndRunsMechanics(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a)
	sc.spin(a, "pick_item")
	sc.s.Settings.Disabled = map[string]bool{"minus3": true}
	sc.mustUse(a, "pick_item")
	st := sc.step(a)
	options := sc.e.ItemOptions(sc.s, sc.s.CurrentTurn(a), st)
	if _, enabled := options[int64(1+slices.Index(st.ItemChoices, "minus3"))]; enabled || slices.Contains(st.ItemChoices, "outcast") {
		t.Fatal("ineligible choice")
	}
	if err := sc.e.Choose(sc.s, a, st.ID, 0); err == nil {
		t.Fatal("invalid choice accepted")
	}
	sc.choose(a, int64(1+slices.Index(st.ItemChoices, "pick_debuff")))
	sc.spin(a, "reflex")
	sc.spin(a, "G")
	sc.play(a, game.OutcomeDropped, 1)
	sc.mustUse(a, "pick_debuff")
	sc.roundTrip()
	st = sc.step(a)
	if slices.Contains(st.ItemChoices, "reflex") {
		t.Fatal("effect on debuff wheel")
	}
	sc.choose(a, int64(1+slices.Index(st.ItemChoices, "retro_vibe")))
	if sc.item(a, "retro_vibe").Placement != game.PlacePending {
		t.Fatal("chosen debuff not applied")
	}
}

func TestForcedChoiceRestoresWheelOnUndo(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.spin(a, "putin_vote")
	sc.spin(a, "pick_item")
	if sc.step(a).Kind != game.StepChooseItem {
		t.Fatal("forced bonus did not prepare a choice")
	}
	if _, err := sc.e.UndoLastStep(sc.s, sc.judge, a); err != nil {
		t.Fatal(err)
	}
	sc.expectSteps(a, game.StepSpinItems, game.StepSpinItems, game.StepSpinGame, game.StepPlay)
}

func TestCommunicationDropRules(t *testing.T) {
	for _, id := range []string{"outcast", "kiosk_charged"} {
		t.Run(id, func(t *testing.T) {
			sc := newScenario(t)
			a := sc.player("Алиса")
			sc.addGame("A", 10, 80, 2015, a)
			sc.addGame("B", 10, 80, 2015, a)
			startGame(sc, a, "A")
			sc.play(a, game.OutcomeDropped, 1)
			sc.spin(a, id)
			sc.spin(a, "B")
			item := sc.item(a, id)
			if item.Placement != game.PlaceAttached || len(item.Chain) != 1 || item.Chain[0] != sc.playthrough(a).ID {
				t.Fatal("rule did not apply to the next game")
			}
		})
	}
}
