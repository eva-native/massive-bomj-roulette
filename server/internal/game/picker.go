package game

import (
	"crypto/rand"
	"fmt"
	"math/big"
)

// RandomPicker picks a sector at random, proportionally to its weight, using
// crypto/rand so results cannot be predicted.
type RandomPicker struct{}

func (RandomPicker) Pick(_ WheelKind, sectors []Sector) (int, error) {
	total := 0
	for _, s := range sectors {
		if s.Weight > 0 {
			total += s.Weight
		}
	}
	if total == 0 {
		return 0, ErrEmptyWheel
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(total)))
	if err != nil {
		return 0, fmt.Errorf("game: random: %w", err)
	}
	roll := int(n.Int64())
	for i, s := range sectors {
		if s.Weight <= 0 {
			continue
		}
		if roll < s.Weight {
			return i, nil
		}
		roll -= s.Weight
	}
	return len(sectors) - 1, nil
}
