package wheel

import (
	"crypto/rand"
	"errors"
	"math/big"
)

var ErrEmpty = errors.New("wheel: empty sectors")

func Pick[T any](items []T, weight func(T) int) (int, error) {
	total := 0
	for _, it := range items {
		if w := weight(it); w > 0 {
			total += w
		}
	}

	if total <= 0 {
		return 0, ErrEmpty
	}

	roll, err := randInt(total)
	if err != nil {
		return 0, err
	}

	for i, it := range items {
		w := weight(it)
		if w <= 0 {
			continue
		}
		if roll < w {
			return i, nil
		}
		roll -= w
	}
	return len(items) - 1, nil
}

func PickUniform(n int) (int, error) {
	if n <= 0 {
		return 0, ErrEmpty
	}
	return randInt(n)
}

func randInt(n int) (int, error) {
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return 0, err
	}
	return int(v.Int64()), nil
}
