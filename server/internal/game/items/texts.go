package items

import "github.com/eva-native/massive-bomj-roulette/server/internal/game"

//go:generate go run ./gen ../../../../docs/rules texts_gen.go

// itemText is what docs/rules says about an item.
type itemText struct {
	Kind    game.Kind
	Name    string
	Concept string
}
