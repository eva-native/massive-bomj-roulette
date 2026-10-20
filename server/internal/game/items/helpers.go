// Package items is the catalog of effects, bonuses and drop debuffs.
//
// Names, kinds and rule texts come from docs/rules through texts_gen.go
// (go generate), so the catalog never repeats the documents. This package
// adds the mechanics: input fields, flags and hook implementations.
package items

import (
	"fmt"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

// Option sets up a definition.
type Option func(*game.Def)

// def builds the item with the given id from its text in docs/rules.
// Bonuses are used on a game unless an option says otherwise.
func def(id string, opts ...Option) *game.Def {
	t, ok := texts[id]
	if !ok {
		panic(fmt.Sprintf("items: %q is not in docs/rules", id))
	}
	d := &game.Def{ID: id, Kind: t.Kind, Name: t.Name, Concept: t.Concept, Weight: 1}
	if d.Kind == game.KindBonus {
		d.Use = game.UsePlaythrough
	}
	for _, o := range opts {
		o(d)
	}
	return d
}

// Text is an item that is only a rule for people.
func Text(id string, opts ...Option) *game.Def { return def(id, opts...) }

// FlatPoints is an effect worth a fixed number of points on its game,
// completed or dropped. Events may change the number.
func FlatPoints(id string, points int) *game.Def {
	return def(id, Param("points", "Очки", points, -100, 100), Impl(flatPoints{}))
}

// Blocker switches off items of the given kinds on its game.
func Blocker(id string, kinds ...game.Kind) *game.Def { return def(id, Blocks(kinds...)) }

func Impl(impl any) Option { return func(d *game.Def) { d.Impl = impl } }

func Input(fields ...game.Field) Option {
	return func(d *game.Def) { d.Input = append(d.Input, fields...) }
}

// Confirm makes the item's points wait for the judge's confirmation.
func Confirm() Option { return func(d *game.Def) { d.NeedsConfirm = true } }

// WithProof asks the player for a proof link and the judge to confirm it.
func WithProof() Option {
	return func(d *game.Def) {
		d.Proof, d.NeedsConfirm = true, true
		d.Input = append(d.Input, game.Field{Name: "proof", Label: "Доказательство (ссылка)", Type: game.FieldURL, By: game.RolePlayer})
	}
}

func Lifetime(n int) Option     { return func(d *game.Def) { d.Lifetime = n } }
func EndsOnDrop() Option        { return func(d *game.Def) { d.EndsOnDrop = true } }
func OncePerPlayer() Option     { return func(d *game.Def) { d.OncePerPlayer = true } }
func Use(m game.UseMode) Option { return func(d *game.Def) { d.Use = m } }

func Blocks(kinds ...game.Kind) Option {
	return func(d *game.Def) { d.Blocks = append(d.Blocks, kinds...) }
}

// Param declares a number of the rule that events may change.
func Param(name, label string, def, min, max int) Option {
	return func(d *game.Def) {
		d.Params = append(d.Params, game.Param{Name: name, Label: label, Default: def, Min: min, Max: max})
	}
}

func Special(key, title string) Option {
	return func(d *game.Def) { d.SpecialGames = append(d.SpecialGames, game.SpecialGame{Key: key, Title: title}) }
}

// --- input fields -------------------------------------------------------------------

func field(name, label string, t game.FieldType, by game.Role) game.Field {
	return game.Field{Name: name, Label: label, Type: t, By: by}
}

func optional(f game.Field) game.Field { f.Optional = true; return f }

// --- simple mechanics -----------------------------------------------------------------

type flatPoints struct{}

func (flatPoints) Score(c *game.ScoreCtx, l *game.Ledger) {
	if c.Outcome != game.OutcomeNone {
		l.Add(c.Param("points"))
	}
}
