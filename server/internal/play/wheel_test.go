package play

import (
	"slices"
	"testing"
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
