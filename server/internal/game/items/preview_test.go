package items_test

import (
	"encoding/json"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

func TestPreviewOutcome(t *testing.T) {
	sc := newScenario(t)
	a := sc.player("Алиса")
	sc.addGame("G1", 10, 80, 2015, a) // 17

	spinItems(sc, a, "parachute", "parachute", "parachute")
	sc.spin(a, "G1")
	pt := sc.playthrough(a)
	preview := func() game.Preview {
		t.Helper()
		p, ok := sc.e.PreviewOutcome(sc.s, pt.ID)
		if !ok {
			t.Fatal("no preview for a game in progress")
		}
		return p
	}

	before, _ := json.Marshal(sc.s)
	if got, want := preview(), (game.Preview{Dropped: -8, CompletedAtHLTB: 17 + rec}); got != want {
		t.Fatalf("preview = %+v, want %+v (half the base rounded towards zero; base, no speed, the record)", got, want)
	}
	if after, _ := json.Marshal(sc.s); string(after) != string(before) {
		t.Fatal("the preview changed the state")
	}

	sc.mustUse(a, "parachute")
	if got := preview().Dropped; got != 0 {
		t.Fatalf("with «Парашют» a drop costs %d, want 0", got)
	}

	sc.finish(a, game.OutcomeDropped, 1)
	if _, ok := sc.e.PreviewOutcome(sc.s, pt.ID); ok {
		t.Fatal("a game sent to the judge has no preview")
	}
}
