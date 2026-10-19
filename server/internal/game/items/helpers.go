// Package items is the catalog of effects, bonuses and drop debuffs.
//
// Names and rule texts must match docs/rules. Simple items are built with the
// constructors in this file; items with their own mechanics have their own
// files and implement the hook interfaces of package game.
package items

import "github.com/eva-native/massive-bomj-roulette/server/internal/game"

// Option tweaks a definition built by a constructor.
type Option func(*game.Def)

// WithProof asks for a proof link and the judge's confirmation.
func WithProof() Option {
	return func(d *game.Def) { d.Proof, d.NeedsConfirm = true, true }
}

func build(d *game.Def, opts []Option) *game.Def {
	if d.Weight == 0 {
		d.Weight = 1
	}
	for _, o := range opts {
		o(d)
	}
	return d
}

// Text is an item that is only a rule for people; it gives no points.
func Text(id string, kind game.Kind, name, concept string, opts ...Option) *game.Def {
	return build(&game.Def{ID: id, Kind: kind, Name: name, Concept: concept}, opts)
}

// FlatPoints is an effect worth a fixed number of points on its game, whether
// the game is completed or dropped.
func FlatPoints(id, name, concept string, points int, opts ...Option) *game.Def {
	return build(&game.Def{ID: id, Kind: game.KindEffect, Name: name, Concept: concept, Impl: flatPoints(points)}, opts)
}

type flatPoints int

func (p flatPoints) Score(c *game.ScoreCtx, l *game.Ledger) {
	if c.Outcome != game.OutcomeNone {
		l.Add(int(p))
	}
}

// Blocker switches off items of the given kinds on its game.
func Blocker(id string, kind game.Kind, name, concept string, blocks ...game.Kind) *game.Def {
	return build(&game.Def{ID: id, Kind: kind, Name: name, Concept: concept, Blocks: blocks}, nil)
}
