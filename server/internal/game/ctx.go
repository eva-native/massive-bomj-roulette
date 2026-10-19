package game

import (
	"encoding/json"
	"fmt"
	"slices"
)

// Ctx is the read-only view a hook gets of the event.
type Ctx struct {
	r    *run
	item *Item
	turn *Turn
}

func (c *Ctx) Player() PlayerID { return c.item.Player }

// Players returns all participants of the event.
func (c *Ctx) Players() []Player {
	out := make([]Player, 0, len(c.r.s.Players))
	for _, p := range c.r.s.Players {
		out = append(out, *p)
	}
	return out
}

func (c *Ctx) Game(id int64) (Game, bool) {
	if g := c.r.s.Game(id); g != nil {
		return *g, true
	}
	return Game{}, false
}

func (c *Ctx) SpecialGame(key string) (Game, bool) {
	if g := c.r.s.GameBySpecialKey(key); g != nil {
		return *g, true
	}
	return Game{}, false
}

// GameSpins returns the games spun in the current turn, in order, without
// voided spins.
func (c *Ctx) GameSpins() []Game {
	var out []Game
	if c.turn == nil {
		return out
	}
	for _, sp := range c.r.s.Spins {
		if sp.TurnID == c.turn.ID && sp.Wheel == WheelGames && !sp.Voided {
			if g := c.r.s.Game(sp.Picked().ID); g != nil {
				out = append(out, *g)
			}
		}
	}
	return out
}

// CountEarlier counts this player's earlier items with the given def id,
// not counting rerolled ones.
func (c *Ctx) CountEarlier(defID string) int {
	n := 0
	for _, it := range c.r.s.Items {
		if it.Player == c.item.Player && it.DefID == defID && it.Seq < c.item.Seq && it.Placement != PlaceVoided {
			n++
		}
	}
	return n
}

// Self is the item whose hook is running.
type Self struct {
	r          *run
	item       *Item
	finishedBy int64
}

func (s *Self) ID() int64       { return s.item.ID }
func (s *Self) DefID() string   { return s.item.DefID }
func (s *Self) Confirmed() bool { return s.item.Confirmed }

// LoadState decodes the item state into v. It reports false if there is none.
func (s *Self) LoadState(v any) bool {
	if len(s.item.State) == 0 {
		return false
	}
	return json.Unmarshal(s.item.State, v) == nil
}

// SetState replaces the item state with v (any JSON-encodable value).
func (s *Self) SetState(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		panic(fmt.Sprintf("game: item %s: state is not JSON-encodable: %v", s.item.DefID, err))
	}
	s.item.State = b
}

// Finish ends an item that listens until done.
func (s *Self) Finish() {
	s.item.Finished = true
	s.item.FinishedBy = s.finishedBy
}

func (s *Self) Bool(name string) (bool, bool) {
	v, ok := s.item.Input[name].(bool)
	return v, ok
}

func (s *Self) Int(name string) (int, bool) { return toInt(s.item.Input[name]) }

func (s *Self) Text(name string) (string, bool) {
	v, ok := s.item.Input[name].(string)
	return v, ok
}

func (s *Self) Player(name string) (PlayerID, bool) {
	n, ok := toInt(s.item.Input[name])
	return PlayerID(n), ok
}

func (s *Self) Players(name string) []PlayerID {
	var out []PlayerID
	if list, ok := s.item.Input[name].([]any); ok {
		for _, v := range list {
			if n, ok := toInt(v); ok {
				out = append(out, PlayerID(n))
			}
		}
	}
	if list, ok := s.item.Input[name].([]PlayerID); ok {
		out = append(out, list...)
	}
	return out
}

// toInt accepts the number types that appear before and after a JSON round trip.
func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case PlayerID:
		return int(n), true
	case float64:
		if n == float64(int(n)) {
			return int(n), true
		}
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	}
	return 0, false
}

// TurnOps changes the steps of the current turn. Steps are inserted right
// after the step being processed, in the order they are added.
type TurnOps struct {
	r    *run
	turn *Turn
	item *Item
	pos  int // insert position in turn.Steps
}

func newTurnOps(r *run, t *Turn, anchor *Step, it *Item) *TurnOps {
	pos := len(t.Steps)
	if anchor != nil {
		if i, _ := t.step(anchor.ID); i >= 0 {
			pos = i + 1
		}
	}
	return &TurnOps{r: r, turn: t, item: it, pos: pos}
}

func (t *TurnOps) insert(st *Step, at int) {
	t.turn.Steps = slices.Insert(t.turn.Steps, at, st)
}

func (t *TurnOps) newStep(kind StepKind) *Step {
	return &Step{ID: t.r.s.id(), Kind: kind, CreatedBy: t.item.ID, CreatedSeq: t.r.s.seq()}
}

// AddStep inserts a step after the current one.
func (t *TurnOps) AddStep(kind StepKind) {
	t.insert(t.newStep(kind), t.pos)
	t.pos++
}

// AddStepBeforeGameSpin inserts a step before the turn's first pending game spin.
func (t *TurnOps) AddStepBeforeGameSpin(kind StepKind) {
	for i, st := range t.turn.Steps {
		if st.Kind == StepSpinGame && !st.Done {
			t.insert(t.newStep(kind), i)
			if i < t.pos {
				t.pos++
			}
			return
		}
	}
	t.AddStep(kind)
}

// ChooseGame lets the player pick one of the given games.
func (t *TurnOps) ChooseGame(options []int64) {
	st := t.newStep(StepChooseGame)
	st.Options = slices.Clone(options)
	t.insert(st, t.pos)
	t.pos++
}

// SetGame makes the given game the game of the turn.
func (t *TurnOps) SetGame(id int64) { t.turn.Game = id }

// UseOps are the operations available when a player uses an item.
type UseOps struct {
	r    *run
	turn *Turn
	item *Item
}

// RedoLastSpin cancels the last spin of the turn as if it never happened.
func (u *UseOps) RedoLastSpin() error {
	var last *Step
	for _, st := range u.turn.Steps {
		if st.Done && (last == nil || st.DoneSeq > last.DoneSeq) {
			last = st
		}
	}
	if last == nil || last.SpinID == 0 {
		return fmt.Errorf("%w: последний шаг — не крутка", ErrNotAllowed)
	}
	return u.r.rewindTo(u.turn, last)
}

// RedoGameSpin goes back to the turn's first game spin, dropping later game
// spins and choices and the playthrough if it was already created.
func (u *UseOps) RedoGameSpin() error {
	for _, st := range u.turn.Steps {
		if st.Kind == StepSpinGame && st.Done {
			return u.r.rewindTo(u.turn, st)
		}
	}
	return fmt.Errorf("%w: игра ещё не выпала", ErrNotAllowed)
}

// ResetWheel returns the player's finished games to their game wheel.
func (u *UseOps) ResetWheel() {
	u.r.s.WheelResets = append(u.r.s.WheelResets, WheelReset{Player: u.item.Player, Seq: u.r.s.seq()})
}

// ReplaceGameSpinWithChoice turns the pending game spin into a choice from
// the same wheel.
func (u *UseOps) ReplaceGameSpinWithChoice() error {
	st := u.turn.CurrentStep()
	if st == nil || st.Kind != StepSpinGame {
		return fmt.Errorf("%w: сейчас не крутка колеса игр", ErrNotAllowed)
	}
	return u.r.gameSpinToChoice(u.turn, st)
}

// gameSpinToChoice turns a game spin step into a choice from the same wheel.
func (r *run) gameSpinToChoice(t *Turn, st *Step) error {
	sectors, err := r.gameWheel(t)
	if err != nil {
		return err
	}
	st.Kind = StepChooseGame
	st.Options = st.Options[:0]
	for _, sec := range sectors {
		st.Options = append(st.Options, sec.ID)
	}
	return nil
}

// RerollSelf voids this item and adds a spin of the effects-and-bonuses wheel
// before the current step; what it rolls works on the same game.
func (u *UseOps) RerollSelf() error {
	st := u.turn.CurrentStep()
	if st == nil {
		return fmt.Errorf("%w: ход закончен", ErrNotAllowed)
	}
	i, _ := u.turn.step(st.ID)
	u.r.voidItem(u.item)
	u.turn.Steps = slices.Insert(u.turn.Steps, i, &Step{
		ID: u.r.s.id(), Kind: StepSpinItems, CreatedBy: u.item.ID, CreatedSeq: u.r.s.seq(),
	})
	return nil
}

// RolledItem is the item another item's listener is told about.
type RolledItem struct {
	r    *run
	item *Item
	turn *Turn
}

func (ri *RolledItem) ID() int64     { return ri.item.ID }
func (ri *RolledItem) DefID() string { return ri.item.DefID }
func (ri *RolledItem) Kind() Kind    { return ri.r.def(ri.item).Kind }

// ForceActivate activates a pocket bonus right away instead of keeping it:
//   - a bonus for a game works on the next game;
//   - «Колесо удачи» (instead of the game spin) turns the turn's next game
//     spin into a choice;
//   - «Реролл» (after a spin) burns: there is nothing left to reroll.
func (ri *RolledItem) ForceActivate() {
	if ri.item.Placement != PlacePocket {
		return
	}
	ri.item.Forced = true
	switch ri.r.def(ri.item).Use {
	case UseAfterSpin:
		ri.item.Placement = PlaceUsed
	case UseInsteadOfGameSpin:
		ri.item.Placement = PlaceUsed
		for _, st := range ri.turn.Steps {
			if st.Kind == StepSpinGame && !st.Done {
				_ = ri.r.gameSpinToChoice(ri.turn, st) // an empty wheel leaves the spin as it is
				break
			}
		}
	default:
		ri.item.Placement = PlacePending
		if ri.turn.Playthrough != 0 {
			ri.r.attach(ri.item, ri.turn.Playthrough)
		}
	}
}

// GameWheel is the game wheel before a spin.
type GameWheel struct {
	r       *run
	sectors []Sector
}

// OnlyAddedBy keeps only games added by the given player.
func (w *GameWheel) OnlyAddedBy(p PlayerID) {
	w.sectors = slices.DeleteFunc(w.sectors, func(s Sector) bool {
		g := w.r.s.Game(s.ID)
		return g == nil || g.AddedBy != p
	})
}

// Exclude removes a game from the wheel.
func (w *GameWheel) Exclude(gameID int64) {
	w.sectors = slices.DeleteFunc(w.sectors, func(s Sector) bool { return s.ID == gameID })
}
