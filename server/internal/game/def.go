package game

import (
	"fmt"
	"slices"
)

type Kind string

const (
	KindEffect Kind = "effect"
	KindBonus  Kind = "bonus"
	KindDrop   Kind = "drop"
)

// UseMode says when and how a player may use an item by hand.
type UseMode string

const (
	UseNone UseMode = ""
	// UsePlaythrough: a pocket bonus attached to the current game («Парашют»).
	UsePlaythrough UseMode = "playthrough"
	// UseAfterSpin: a pocket bonus used right after a spin («Реролл»).
	UseAfterSpin UseMode = "after_spin"
	// UseInsteadOfGameSpin: a pocket bonus used instead of the game spin («Колесо удачи»).
	UseInsteadOfGameSpin UseMode = "instead_of_game_spin"
	// UseOffer: an optional action of an effect on its game («Сделка», «Ветеран»).
	UseOffer UseMode = "offer"
)

type FieldType string

const (
	FieldBool    FieldType = "bool"
	FieldInt     FieldType = "int"
	FieldText    FieldType = "text"
	FieldURL     FieldType = "url"
	FieldPlayer  FieldType = "player"
	FieldPlayers FieldType = "players"
)

type Role string

const (
	RolePlayer Role = "player"
	RoleJudge  Role = "judge"
)

// Field is one input of an item, filled by the player or by the judge.
type Field struct {
	Name     string
	Label    string
	Type     FieldType
	By       Role
	Optional bool
}

// UntilDone keeps an item active until its hook calls Self.Finish.
const UntilDone = -1

// Def describes an item. Behaviour beyond the plain fields lives in Impl,
// which implements any of the hook interfaces below.
type Def struct {
	ID      string
	Name    string
	Concept string // rule text, must match docs/rules
	Kind    Kind
	Weight  int // default wheel weight; events may override

	// Lifetime is the number of games the item works on (0 or 1 = one game),
	// or UntilDone.
	Lifetime      int
	EndsOnDrop    bool
	OncePerPlayer bool
	Blocks        []Kind
	Use           UseMode
	Proof         bool // needs a proof link
	NeedsConfirm  bool // its points count only after the judge confirms
	Input         []Field

	Impl any
}

func (d *Def) lifetime() int {
	if d.Lifetime == 0 {
		return 1
	}
	return d.Lifetime
}

func (d *Def) multiGame() bool { return d.Lifetime > 1 }

func (d *Def) blocks(k Kind) bool { return slices.Contains(d.Blocks, k) }

func (d *Def) field(name string) *Field {
	for i := range d.Input {
		if d.Input[i].Name == name {
			return &d.Input[i]
		}
	}
	return nil
}

// --- hooks --------------------------------------------------------------------
//
// An item implements only the hooks it needs. Each hook receives only the
// operations it is allowed to perform, so the compiler enforces what a hook
// may change. Hooks keep no state of their own between calls: anything they
// must remember goes into the item state (Self.SetState).

// Roller runs when the item falls out of a wheel.
type Roller interface {
	Roll(c *Ctx, t *TurnOps, self *Self)
}

// ItemRolledListener runs when the same player rolls another item while this
// one is waiting for its game or still active («Голосование за Путина»).
type ItemRolledListener interface {
	OnItemRolled(c *Ctx, rolled *RolledItem, self *Self)
}

// GameWheelShaper narrows the game wheel before a game spin.
type GameWheelShaper interface {
	ShapeGameWheel(c *Ctx, w *GameWheel, self *Self)
}

// GameSpunHandler runs after every game spin of the turn.
type GameSpunHandler interface {
	OnGameSpun(c *Ctx, t *TurnOps, self *Self)
}

// Attacher runs when the game is final and the item is attached to it.
type Attacher interface {
	OnAttach(c *Ctx, t *TurnOps, self *Self)
}

// StepDoneHandler runs when a step added by this item is done.
type StepDoneHandler interface {
	OnStepDone(c *Ctx, step Step, self *Self)
}

// UseChecker refines whether the item can be used right now.
type UseChecker interface {
	CanUse(c *Ctx, self *Self) error
}

// User runs when the player uses the item.
type User interface {
	OnUse(c *Ctx, u *UseOps, self *Self) error
}

// Scorer adds points. It must be a pure function of its arguments.
type Scorer interface {
	Score(c *ScoreCtx, l *Ledger)
}

// --- catalog ------------------------------------------------------------------

type Catalog struct {
	defs  map[string]*Def
	order []*Def
}

func NewCatalog(defs ...*Def) (*Catalog, error) {
	c := &Catalog{defs: map[string]*Def{}}
	for _, d := range defs {
		if err := validateDef(d); err != nil {
			return nil, err
		}
		if _, dup := c.defs[d.ID]; dup {
			return nil, fmt.Errorf("catalog: duplicate item %q", d.ID)
		}
		c.defs[d.ID] = d
		c.order = append(c.order, d)
	}
	return c, nil
}

func validateDef(d *Def) error {
	switch {
	case d.ID == "" || d.Name == "":
		return fmt.Errorf("catalog: item %q: id and name are required", d.ID)
	case d.Kind != KindEffect && d.Kind != KindBonus && d.Kind != KindDrop:
		return fmt.Errorf("catalog: item %q: unknown kind %q", d.ID, d.Kind)
	case d.Weight < 0:
		return fmt.Errorf("catalog: item %q: negative weight", d.ID)
	case d.Kind == KindBonus && d.Use == UseOffer:
		return fmt.Errorf("catalog: item %q: offers are for effects", d.ID)
	case d.Kind != KindBonus && d.Use != UseNone && d.Use != UseOffer:
		return fmt.Errorf("catalog: item %q: only bonuses go to the pocket", d.ID)
	}
	if _, ok := d.Impl.(User); d.Use != UseNone && d.Use != UsePlaythrough && !ok {
		return fmt.Errorf("catalog: item %q: use mode %q needs an OnUse hook", d.ID, d.Use)
	}
	for _, f := range d.Input {
		if f.Name == "" || (f.By != RolePlayer && f.By != RoleJudge) {
			return fmt.Errorf("catalog: item %q: bad input field %+v", d.ID, f)
		}
	}
	return nil
}

func (c *Catalog) Def(id string) *Def { return c.defs[id] }

// All returns the items in catalog order.
func (c *Catalog) All() []*Def { return c.order }
