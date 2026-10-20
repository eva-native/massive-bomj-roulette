package items_test

import (
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

func TestJudgeUndoesTheLastStep(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a)
	sc.addGame("G2", 10, 80, 2015, a)

	_, err := sc.e.UndoLastStep(sc.s, a, a)
	expectErr(t, err, game.ErrNotJudge)
	_, err = sc.e.UndoLastStep(sc.s, sc.judge, a)
	expectErr(t, err, game.ErrNotAllowed) // nothing done yet

	spinItems(sc, a, "opaaa", "reflex", "reflex")
	sc.spin(a, "G1")
	st, err := sc.e.UndoLastStep(sc.s, sc.judge, a)
	if err != nil || st.Kind != game.StepSpinGame {
		t.Fatalf("undo = %+v, %v", st, err)
	}
	sc.expectSteps(a, game.StepSpinGame, game.StepPlay)
	sc.spin(a, "G2")

	// A finished game that waits for the judge can be taken back too.
	sc.finish(a, game.OutcomeCompleted, 10)
	if st, err := sc.e.UndoLastStep(sc.s, sc.judge, a); err != nil || st.Kind != game.StepPlay {
		t.Fatalf("undo finish = %+v, %v", st, err)
	}
	sc.expectSteps(a, game.StepPlay)
	if sc.playthrough(a).Outcome != game.OutcomeNone {
		t.Fatal("the outcome must be cleared")
	}
}

func TestJudgeEditsHoursAfterConfirmation(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G", 10, 80, 2015, a) // base 17
	spinItems(sc, a, "reflex", "reflex", "reflex")
	sc.spin(a, "G")
	sc.play(a, game.OutcomeCompleted, 20)
	sc.expectTotal(a, 17-10+1)

	var pt *game.Playthrough
	for _, p := range sc.s.Playthroughs {
		if p.Player == a {
			pt = p
		}
	}
	expectErr(t, sc.e.EditPlaythrough(sc.s, sc.judge, pt.ID, 0, ""), game.ErrBadInput)
	if err := sc.e.EditPlaythrough(sc.s, sc.judge, pt.ID, 8, " https://proof "); err != nil {
		t.Fatal(err)
	}
	sc.expectTotal(a, 17+2+1)
	if pt.Proof != "https://proof" {
		t.Fatalf("proof = %q", pt.Proof)
	}
	expectErr(t, sc.e.EditPlaythrough(sc.s, a, pt.ID, 1, ""), game.ErrNotJudge)
}
