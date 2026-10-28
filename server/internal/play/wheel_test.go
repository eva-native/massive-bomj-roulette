package play

import (
	"fmt"
	"slices"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game/items"
)

func TestWheelOrderIsAStableShuffle(t *testing.T) {
	const n = 20
	a := wheelOrder(7, n)
	if !slices.Equal(a, wheelOrder(7, n)) {
		t.Fatal("the same step must give the same order")
	}
	if slices.Equal(a, wheelOrder(8, n)) {
		t.Fatal("another step should give another order")
	}
	sorted := slices.Sorted(slices.Values(a))
	for i, v := range sorted {
		if v != i {
			t.Fatalf("order %v is not a permutation of 0..%d", a, n-1)
		}
	}
	if slices.Equal(a, sorted) {
		t.Fatal("the sectors must not stay in catalog order")
	}
}

// wheelView must report where each engine sector ends up, so the spin result
// points at the right sector of the shuffled wheel.
func TestWheelViewPositions(t *testing.T) {
	cat, err := items.NewCatalog()
	if err != nil {
		t.Fatal(err)
	}
	s := New(nil, game.NewEngine(cat, nil), nil)
	const n = 20
	sectors := make([]game.Sector, n)
	for i := range sectors {
		sectors[i] = game.Sector{Label: fmt.Sprint("sector ", i), Weight: 1}
	}
	for step := int64(1); step <= 50; step++ {
		wv, pos := s.wheelView(game.WheelItems, sectors, step)
		if len(wv.Sectors) != n || len(pos) != n {
			t.Fatalf("step %d: %d sectors, %d positions, want %d", step, len(wv.Sectors), len(pos), n)
		}
		moved := false
		for i, sec := range sectors {
			if got := wv.Sectors[pos[i]].Label; got != sec.Label {
				t.Fatalf("step %d: engine sector %d is at %d, which shows %q", step, i, pos[i], got)
			}
			moved = moved || pos[i] != i
		}
		if !moved {
			t.Fatalf("step %d: the sectors stayed in engine order", step)
		}
	}
}
