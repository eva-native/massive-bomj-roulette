package game

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
)

var (
	ErrUnknownPlayer = errors.New("участник не найден")
	ErrNotYourTurn   = errors.New("сейчас не ваш ход")
	ErrWrongStep     = errors.New("этот шаг уже не текущий")
	ErrNotJudge      = errors.New("это может только судья")
	ErrEmptyWheel    = errors.New("колесо пустое")
	ErrNotAllowed    = errors.New("сейчас нельзя")
	ErrTooLate       = errors.New("поздно: ход уже ушёл дальше")
	ErrBadInput      = errors.New("неверные данные")
)

const defaultStartSpins = 3

// Picker chooses a sector of a wheel. The default picks at random by weight;
// tests script the results.
type Picker interface {
	Pick(w WheelKind, sectors []Sector) (int, error)
}

type Engine struct {
	cat    *Catalog
	picker Picker
}

func NewEngine(cat *Catalog, picker Picker) *Engine {
	if picker == nil {
		picker = RandomPicker{}
	}
	return &Engine{cat: cat, picker: picker}
}

func (e *Engine) Catalog() *Catalog { return e.cat }

// run binds the engine to one state for the duration of an action.
type run struct {
	e *Engine
	s *State
}

func (e *Engine) on(s *State) *run { return &run{e: e, s: s} }

func (r *run) def(it *Item) *Def {
	d := r.e.cat.Def(it.DefID)
	if d == nil {
		panic(fmt.Sprintf("game: item %d has unknown def %q", it.ID, it.DefID))
	}
	return d
}

// --- joining and turns -----------------------------------------------------------

// Join adds a participant and starts their first turn.
func (e *Engine) Join(s *State, p Player) error {
	if s.Player(p.ID) != nil {
		return fmt.Errorf("участник %d уже в игре", p.ID)
	}
	s.Players = append(s.Players, &p)
	_, err := e.Start(s, p.ID)
	return err
}

// Start gives a player their first turn if they have none yet. It reports
// whether a turn was created.
func (e *Engine) Start(s *State, p PlayerID) (bool, error) {
	if s.Player(p) == nil {
		return false, ErrUnknownPlayer
	}
	if s.CurrentTurn(p) != nil {
		return false, nil
	}
	r := e.on(s)
	r.newTurn(p, ReasonStart, r.startSpins())
	return true, nil
}

// IsJudge reports whether the player may act as a judge.
func (s *State) IsJudge(id PlayerID) bool {
	if p := s.Player(id); p != nil && p.Judge {
		return true
	}
	return slices.Contains(s.Judges, id)
}

// Note returns the item's own note for its card, if it has one.
func (e *Engine) Note(s *State, itemID int64) string {
	r := e.on(s)
	it := s.Item(itemID)
	if it == nil {
		return ""
	}
	n, ok := r.def(it).Impl.(Noter)
	if !ok {
		return ""
	}
	return n.Note(r.ctx(it, s.Turn(it.TurnID)), r.self(it, 0))
}

// Blocked reports whether another item on the same game switches the item off.
func (e *Engine) Blocked(s *State, itemID int64) bool {
	r := e.on(s)
	it := s.Item(itemID)
	if it == nil {
		return false
	}
	var group []*Item
	for _, other := range s.Items {
		if other.Player != it.Player || other.Placement == PlaceVoided {
			continue
		}
		samePending := other.Placement == PlacePending && it.Placement == PlacePending && other.TurnID == it.TurnID
		shared := len(it.Chain) > 0 && slices.Contains(other.Chain, it.Chain[len(it.Chain)-1])
		if samePending || shared {
			group = append(group, other)
		}
	}
	return r.blocked(it, group)
}

func (r *run) newTurn(p PlayerID, reason TurnReason, spins int) *Turn {
	t := &Turn{ID: r.s.id(), Seq: r.s.seq(), Player: p, Reason: reason}
	add := func(k StepKind) {
		t.Steps = append(t.Steps, &Step{ID: r.s.id(), Kind: k, CreatedSeq: r.s.seq()})
	}
	switch reason {
	case ReasonStart, ReasonCompleted:
		for range spins {
			add(StepSpinItems)
		}
	case ReasonDropped:
		add(StepSpinDrop)
	case ReasonTech: // only the game wheel
	}
	add(StepSpinGame)
	add(StepPlay)
	r.s.Turns = append(r.s.Turns, t)
	return t
}

func (r *run) startSpins() int {
	if r.s.Settings.StartSpins > 0 {
		return r.s.Settings.StartSpins
	}
	return defaultStartSpins
}

// currentStep checks that stepID is the actor's current step.
func (r *run) currentStep(actor PlayerID, stepID int64) (*Turn, *Step, error) {
	if r.s.Player(actor) == nil {
		return nil, nil, ErrUnknownPlayer
	}
	t := r.s.CurrentTurn(actor)
	if t == nil {
		return nil, nil, ErrNotYourTurn
	}
	st := t.CurrentStep()
	if st == nil || st.ID != stepID {
		return nil, nil, ErrWrongStep
	}
	return t, st, nil
}

func (r *run) finishStep(st *Step) {
	st.Done = true
	st.DoneSeq = r.s.seq()
}

func (r *run) requireJudge(actor PlayerID) error {
	if !r.s.IsJudge(actor) {
		return ErrNotJudge
	}
	return nil
}

// --- spins -------------------------------------------------------------------------

// Wheel returns the wheel of the actor's current step without spinning it,
// so the UI can draw it.
func (e *Engine) Wheel(s *State, actor PlayerID, stepID int64) (WheelKind, []Sector, error) {
	r := e.on(s)
	t, st, err := r.currentStep(actor, stepID)
	if err != nil {
		return "", nil, err
	}
	return r.wheelFor(t, st)
}

func (r *run) wheelFor(t *Turn, st *Step) (WheelKind, []Sector, error) {
	var (
		wheel   WheelKind
		sectors []Sector
		err     error
	)
	switch st.Kind {
	case StepSpinItems:
		wheel, sectors = WheelItems, r.itemWheel(t.Player, KindEffect, KindBonus)
	case StepSpinDrop:
		wheel, sectors = WheelDrops, r.itemWheel(t.Player, KindDrop)
	case StepSpinGame:
		wheel = WheelGames
		sectors, err = r.gameWheel(t)
	case StepSpinMovie:
		wheel, sectors = WheelMovie, r.movieWheel(t.Player)
	default:
		return "", nil, fmt.Errorf("%w: шаг %s — не крутка", ErrWrongStep, st.Kind)
	}
	if err == nil && len(sectors) == 0 {
		err = ErrEmptyWheel
	}
	return wheel, sectors, err
}

// Spin spins the wheel of the actor's current step (items, drops, games or movies).
func (e *Engine) Spin(s *State, actor PlayerID, stepID int64) (*Spin, error) {
	r := e.on(s)
	t, st, err := r.currentStep(actor, stepID)
	if err != nil {
		return nil, err
	}
	wheel, sectors, err := r.wheelFor(t, st)
	if err != nil {
		return nil, err
	}

	idx, err := e.picker.Pick(wheel, sectors)
	if err != nil {
		return nil, err
	}
	if idx < 0 || idx >= len(sectors) {
		return nil, fmt.Errorf("game: picker returned %d for %d sectors", idx, len(sectors))
	}
	sp := &Spin{
		ID: s.id(), Seq: s.seq(), Player: actor, TurnID: t.ID, StepID: st.ID,
		Wheel: wheel, Sectors: sectors, Result: idx,
	}
	s.Spins = append(s.Spins, sp)
	st.SpinID = sp.ID
	r.finishStep(st)

	switch wheel {
	case WheelItems, WheelDrops:
		it := r.rollItem(t, st, sp)
		st.Result = it.ID
	case WheelGames:
		st.Result = sp.Picked().ID
		t.Game = st.Result
		r.afterGameSpin(t, st)
	case WheelMovie:
		st.Result = sp.Picked().ID
		r.stepDone(t, st)
	}
	return sp, nil
}

// itemWheel lists enabled items of the given kinds with the event's weights.
func (r *run) itemWheel(p PlayerID, kinds ...Kind) []Sector {
	var out []Sector
	for _, d := range r.e.cat.All() {
		if !slices.Contains(kinds, d.Kind) || r.s.Settings.Disabled[d.ID] {
			continue
		}
		w := d.Weight
		if v, ok := r.s.Settings.Weights[d.ID]; ok {
			w = v
		}
		if w <= 0 || (d.OncePerPlayer && r.hadItem(p, d.ID)) {
			continue
		}
		out = append(out, Sector{DefID: d.ID, Label: d.Name, Weight: w})
	}
	return out
}

func (r *run) hadItem(p PlayerID, defID string) bool {
	for _, it := range r.s.Items {
		if it.Player == p && it.DefID == defID && it.Placement != PlaceVoided {
			return true
		}
	}
	return false
}

// gameWheel is the shared pool minus games the player already finished
// (since their last wheel reset), narrowed by the turn's items.
func (r *run) gameWheel(t *Turn) ([]Sector, error) {
	finished := r.finishedGames(t.Player)
	w := &GameWheel{r: r}
	for _, g := range r.s.Games {
		if g.SpecialKey == "" && !finished[g.ID] {
			w.sectors = append(w.sectors, Sector{ID: g.ID, Label: g.Title, Weight: 1})
		}
	}
	for _, it := range r.activeTurnItems(t) {
		if h, ok := r.def(it).Impl.(GameWheelShaper); ok {
			h.ShapeGameWheel(r.ctx(it, t), w, r.self(it, 0))
		}
	}
	if len(w.sectors) == 0 {
		return nil, ErrEmptyWheel
	}
	return w.sectors, nil
}

func (r *run) finishedGames(p PlayerID) map[int64]bool {
	var reset int64
	for _, wr := range r.s.WheelResets {
		if wr.Player == p && wr.Seq > reset {
			reset = wr.Seq
		}
	}
	out := map[int64]bool{}
	for _, pt := range r.s.Playthroughs {
		if pt.Player == p && pt.Outcome != OutcomeNone && pt.Seq > reset {
			out[pt.Game] = true
		}
	}
	return out
}

// movieWheel lists movies the player has not watched yet. A movie counts as
// watched once the item that spun it is confirmed.
func (r *run) movieWheel(p PlayerID) []Sector {
	watched := map[int64]bool{}
	for _, sp := range r.s.Spins {
		if sp.Player != p || sp.Wheel != WheelMovie || sp.Voided {
			continue
		}
		t := r.s.Turn(sp.TurnID)
		if _, st := t.step(sp.StepID); st != nil {
			if it := r.s.Item(st.CreatedBy); it != nil && it.Confirmed {
				watched[sp.Picked().ID] = true
			}
		}
	}
	var out []Sector
	for _, m := range r.s.Movies {
		if !watched[m.ID] {
			out = append(out, Sector{ID: m.ID, Label: m.Title, Weight: 1})
		}
	}
	return out
}

// --- items -------------------------------------------------------------------------

func (r *run) rollItem(t *Turn, st *Step, sp *Spin) *Item {
	d := r.e.cat.Def(sp.Picked().DefID)
	it := &Item{ID: r.s.id(), Seq: r.s.seq(), DefID: d.ID, Player: t.Player, TurnID: t.ID, SpinID: sp.ID}
	r.s.Items = append(r.s.Items, it)

	if d.Kind == KindBonus {
		it.Placement = PlacePocket
	} else {
		it.Placement = PlacePending
	}

	if h, ok := d.Impl.(Roller); ok {
		h.Roll(r.ctx(it, t), newTurnOps(r, t, st, it), r.self(it, 0))
	}

	// Tell items that listen for later rolls («Голосование за Путина»).
	for _, other := range r.s.Items {
		if other == it || other.Player != it.Player || other.Seq > it.Seq || !r.listening(other, t) {
			continue
		}
		if h, ok := r.def(other).Impl.(ItemRolledListener); ok {
			h.OnItemRolled(r.ctx(other, t), &RolledItem{r: r, item: it, turn: t}, r.self(other, it.ID))
		}
	}

	// Rolled after the game is final («Закаленный ветеран»): works on it at once.
	if it.Placement == PlacePending && t.Playthrough != 0 {
		r.attach(it, t.Playthrough)
		r.callAttach(it, t, st)
	}
	return it
}

func (r *run) listening(it *Item, t *Turn) bool {
	if it.Placement == PlaceVoided || it.Finished {
		return false
	}
	if r.def(it).Lifetime == UntilDone {
		return true
	}
	return it.TurnID == t.ID && (it.Placement == PlacePending || it.Placement == PlaceAttached)
}

func (r *run) attach(it *Item, pt int64) {
	it.Placement = PlaceAttached
	if !slices.Contains(it.Chain, pt) {
		it.Chain = append(it.Chain, pt)
	}
}

func (r *run) voidItem(it *Item) {
	it.Placement = PlaceVoided
	for _, other := range r.s.Items {
		if other.FinishedBy == it.ID {
			other.Finished, other.FinishedBy = false, 0
		}
	}
}

// turnItems are the items working on the turn's game: pending items before
// the game is final, attached ones after.
func (r *run) turnItems(t *Turn) []*Item {
	var out []*Item
	for _, it := range r.s.Items {
		if it.Player != t.Player || it.Placement == PlaceVoided {
			continue
		}
		pending := it.Placement == PlacePending && it.TurnID == t.ID
		attached := t.Playthrough != 0 && slices.Contains(it.Chain, t.Playthrough)
		if pending || attached {
			out = append(out, it)
		}
	}
	return out
}

// activeTurnItems are turnItems without blocked ones.
func (r *run) activeTurnItems(t *Turn) []*Item {
	group := r.turnItems(t)
	return slices.DeleteFunc(slices.Clone(group), func(it *Item) bool { return r.blocked(it, group) })
}

// blocked reports whether another item of the group blocks it. Items that
// block others are never blocked themselves.
func (r *run) blocked(it *Item, group []*Item) bool {
	d := r.def(it)
	if len(d.Blocks) > 0 {
		return false
	}
	for _, b := range group {
		if b != it && r.def(b).blocks(d.Kind) {
			return true
		}
	}
	return false
}

func (r *run) ctx(it *Item, t *Turn) *Ctx { return &Ctx{r: r, item: it, turn: t} }

func (r *run) self(it *Item, finishedBy int64) *Self {
	return &Self{r: r, item: it, finishedBy: finishedBy}
}

// --- game choice -------------------------------------------------------------------

func (r *run) afterGameSpin(t *Turn, st *Step) {
	ops := newTurnOps(r, t, st, &Item{})
	for _, it := range r.activeTurnItems(t) {
		if h, ok := r.def(it).Impl.(GameSpunHandler); ok {
			ops.item = it
			h.OnGameSpun(r.ctx(it, t), ops, r.self(it, 0))
		}
	}
	r.maybeFinalizeGame(t, st)
}

// maybeFinalizeGame creates the playthrough once no more game steps follow.
func (r *run) maybeFinalizeGame(t *Turn, st *Step) {
	if next := t.CurrentStep(); next != nil && (next.Kind == StepSpinGame || next.Kind == StepChooseGame) {
		return
	}
	pt := &Playthrough{ID: r.s.id(), Seq: r.s.seq(), Player: t.Player, Game: t.Game, TurnID: t.ID}
	r.s.Playthroughs = append(r.s.Playthroughs, pt)
	t.Playthrough = pt.ID

	var attached []*Item
	for _, it := range r.s.Items {
		if it.Player != t.Player || it.Placement == PlaceVoided {
			continue
		}
		if it.Placement == PlacePending && it.TurnID == t.ID {
			r.attach(it, pt.ID)
			attached = append(attached, it)
		} else if r.statusContinues(it) {
			r.attach(it, pt.ID)
		}
	}
	for _, it := range attached {
		if !slices.Contains(t.Carried, it.ID) {
			r.callAttach(it, t, st)
		}
	}
}

// statusContinues reports whether a multi-game item from an earlier game
// also works on the next one.
func (r *run) statusContinues(it *Item) bool {
	d := r.def(it)
	if !d.multiGame() || it.Placement != PlaceAttached || len(it.Chain) == 0 || len(it.Chain) >= d.lifetime() {
		return false
	}
	if d.EndsOnDrop {
		for _, id := range it.Chain {
			if pt := r.s.Playthrough(id); pt != nil && pt.Outcome == OutcomeDropped {
				return false
			}
		}
	}
	return true
}

func (r *run) callAttach(it *Item, t *Turn, st *Step) {
	if r.blocked(it, r.turnItems(t)) {
		return
	}
	if h, ok := r.def(it).Impl.(Attacher); ok {
		h.OnAttach(r.ctx(it, t), newTurnOps(r, t, st, it), r.self(it, 0))
	}
}

func (r *run) stepDone(t *Turn, st *Step) {
	it := r.s.Item(st.CreatedBy)
	if it == nil || it.Placement == PlaceVoided || r.blocked(it, r.turnItems(t)) {
		return
	}
	if h, ok := r.def(it).Impl.(StepDoneHandler); ok {
		h.OnStepDone(r.ctx(it, t), *st, r.self(it, 0))
	}
}

// Choose completes a choose_player or choose_game step.
func (e *Engine) Choose(s *State, actor PlayerID, stepID, choice int64) error {
	r := e.on(s)
	t, st, err := r.currentStep(actor, stepID)
	if err != nil {
		return err
	}
	switch st.Kind {
	case StepChoosePlayer:
		if PlayerID(choice) == actor || s.Player(PlayerID(choice)) == nil {
			return fmt.Errorf("%w: выберите другого участника", ErrBadInput)
		}
		st.Result = choice
		r.finishStep(st)
		r.stepDone(t, st)
	case StepChooseGame:
		if !slices.Contains(st.Options, choice) {
			return fmt.Errorf("%w: этой игры нет среди вариантов", ErrBadInput)
		}
		st.Result = choice
		t.Game = choice
		r.finishStep(st)
		r.maybeFinalizeGame(t, st)
	default:
		return fmt.Errorf("%w: шаг %s — не выбор", ErrWrongStep, st.Kind)
	}
	return nil
}

// --- finishing a game and the judge ------------------------------------------------

// FinishGame records the outcome of the actor's current game.
func (e *Engine) FinishGame(s *State, actor PlayerID, stepID int64, outcome Outcome, hours float64, proof string) error {
	r := e.on(s)
	t, st, err := r.currentStep(actor, stepID)
	if err != nil {
		return err
	}
	if st.Kind != StepPlay {
		return fmt.Errorf("%w: сейчас не идёт игра", ErrWrongStep)
	}
	if outcome != OutcomeCompleted && outcome != OutcomeDropped && outcome != OutcomeTech {
		return fmt.Errorf("%w: итог — «прошёл», «дропнул» или «тех. дроп»", ErrBadInput)
	}
	if err := checkHours(outcome, hours); err != nil {
		return err
	}
	pt := s.Playthrough(t.Playthrough)
	pt.Outcome, pt.Hours, pt.Proof = outcome, hours, strings.TrimSpace(proof)
	r.finishStep(st)
	return nil
}

// MaxHours caps the hours a game can take, to catch typos.
const MaxHours = 10000

// checkHours validates the hours of a finished game.
func checkHours(outcome Outcome, hours float64) error {
	switch {
	case math.IsNaN(hours) || math.IsInf(hours, 0):
		return fmt.Errorf("%w: часы — это число", ErrBadInput)
	case outcome == OutcomeCompleted && hours <= 0:
		return fmt.Errorf("%w: укажите, за сколько часов пройдена игра", ErrBadInput)
	case hours < 0:
		return fmt.Errorf("%w: часы не могут быть отрицательными", ErrBadInput)
	case hours > MaxHours:
		return fmt.Errorf("%w: не больше %d часов", ErrBadInput, MaxHours)
	}
	return nil
}

// ConfirmGame is the judge's decision on a finished game. Accepting starts the
// player's next turn; rejecting sends the player back to playing.
func (e *Engine) ConfirmGame(s *State, actor PlayerID, playthroughID int64, accept bool) error {
	r := e.on(s)
	if err := r.requireJudge(actor); err != nil {
		return err
	}
	pt := s.Playthrough(playthroughID)
	if pt == nil || pt.Outcome == OutcomeNone {
		return fmt.Errorf("%w: нечего подтверждать", ErrNotAllowed)
	}
	if pt.Confirmed {
		return fmt.Errorf("%w: уже подтверждено", ErrNotAllowed)
	}
	t := s.Turn(pt.TurnID)
	if !accept {
		pt.Outcome, pt.Hours, pt.Proof = OutcomeNone, 0, ""
		for _, st := range t.Steps {
			if st.Kind == StepPlay {
				st.Done, st.DoneSeq = false, 0
			}
		}
		return nil
	}
	pt.Confirmed = true
	if s.CurrentTurn(pt.Player) == t {
		switch pt.Outcome {
		case OutcomeDropped:
			r.newTurn(pt.Player, ReasonDropped, 0)
		case OutcomeTech:
			r.carryItems(pt, r.newTurn(pt.Player, ReasonTech, 0))
		default:
			r.newTurn(pt.Player, ReasonCompleted, s.Settings.spinsAfter(s.Game(pt.Game).HLTB))
		}
	}
	return nil
}

// carryItems moves the items of a technically dropped game to the next turn.
// Single-game items wait there for the new game; multi-game items lose this
// game from their chain, so it does not count towards their lifetime.
func (r *run) carryItems(pt *Playthrough, next *Turn) {
	for _, it := range r.s.Items {
		if it.Placement == PlaceVoided || !slices.Contains(it.Chain, pt.ID) {
			continue
		}
		it.Chain = slices.DeleteFunc(it.Chain, func(id int64) bool { return id == pt.ID })
		if len(it.Chain) == 0 && it.Placement == PlaceAttached {
			it.Placement, it.TurnID = PlacePending, next.ID
			next.Carried = append(next.Carried, it.ID)
		}
	}
}

// ConfirmItem is the judge's decision on an item's result.
func (e *Engine) ConfirmItem(s *State, actor PlayerID, itemID int64, accept bool) error {
	r := e.on(s)
	if err := r.requireJudge(actor); err != nil {
		return err
	}
	it := s.Item(itemID)
	if it == nil || it.Placement == PlaceVoided {
		return fmt.Errorf("%w: предмет не найден", ErrNotAllowed)
	}
	if accept && !PlayerFieldsFilled(r.def(it), it) {
		return fmt.Errorf("%w: игрок ещё не заполнил результат", ErrBadInput)
	}
	it.Confirmed, it.Rejected = accept, !accept
	if !accept {
		it.Submitted = false // the owner may fix the input and send it again
	}
	return nil
}

// InputLocked reports whether the owner can no longer change the item's
// fields: they were sent to the judge, who has not rejected them.
func (e *Engine) InputLocked(s *State, itemID int64) bool {
	it := s.Item(itemID)
	if it == nil {
		return false
	}
	return e.on(s).def(it).NeedsConfirm && (it.Confirmed || it.Submitted)
}

// SetInput fills an item's input fields. Player fields belong to the item's
// owner (or a judge), judge fields to judges. Changing input resets the
// judge's confirmation.
func (e *Engine) SetInput(s *State, actor PlayerID, itemID int64, values map[string]any) error {
	r := e.on(s)
	it := s.Item(itemID)
	judge := s.IsJudge(actor)
	if it == nil || it.Placement == PlaceVoided || actor != it.Player && !judge {
		return fmt.Errorf("%w: предмет не найден", ErrNotAllowed)
	}
	d := r.def(it)
	if !judge && d.NeedsConfirm && (it.Confirmed || it.Submitted) {
		return fmt.Errorf("%w: уже отправлено судье, ждите решения", ErrNotAllowed)
	}
	clean := map[string]any{}
	for name, v := range values {
		f := d.field(name)
		if f == nil {
			return fmt.Errorf("%w: неизвестное поле %q", ErrBadInput, name)
		}
		if f.By == RoleJudge && !judge {
			return fmt.Errorf("%w: поле «%s» заполняет не вы", ErrNotAllowed, f.Label)
		}
		cv, err := r.checkField(f, v, it.Player)
		if err != nil {
			return err
		}
		clean[name] = cv
	}
	if it.Input == nil {
		it.Input = map[string]any{}
	}
	for k, v := range clean {
		// Empty text or an empty list clears the field: a field holding one would
		// count as filled (PlayerFieldsFilled) and could be sent to the judge empty.
		if blankInput(v) {
			delete(it.Input, k)
		} else {
			it.Input[k] = v
		}
	}
	if actor == it.Player {
		fillUnticked(d, it)
	}
	it.Confirmed, it.Rejected = false, false
	if !judge && d.NeedsConfirm {
		it.Submitted = PlayerFieldsFilled(d, it)
	}
	return nil
}

// fillUnticked records the owner's unticked yes/no boxes as «no»: when the
// owner sends their part, an empty «Победа» is a lost duel, not a missing
// answer (issue #11). A judge's edit never fills them, so it cannot turn an
// answer the player has not given yet into a loss.
func fillUnticked(d *Def, it *Item) {
	for _, f := range d.Input {
		if f.By != RolePlayer || f.Optional || f.Type != FieldBool {
			continue
		}
		if _, ok := it.Input[f.Name]; !ok {
			it.Input[f.Name] = false
		}
	}
}

// PlayerFieldsFilled reports whether every required player field of the item
// has a value: only then there is a result to confirm.
func PlayerFieldsFilled(d *Def, it *Item) bool {
	for _, f := range d.Input {
		if f.By != RolePlayer || f.Optional {
			continue
		}
		if _, ok := it.Input[f.Name]; !ok {
			return false
		}
	}
	return true
}

// blankInput reports a checked field value that holds nothing: empty text (it is
// trimmed by checkField) or an empty list of players. A bool false or an int 0 is
// an answer, not a blank.
func blankInput(v any) bool {
	switch x := v.(type) {
	case string:
		return x == ""
	case []any:
		return len(x) == 0
	}
	return false
}

func (r *run) checkField(f *Field, v any, owner PlayerID) (any, error) {
	bad := func(why string) error { return fmt.Errorf("%w: «%s» %s", ErrBadInput, f.Label, why) }
	isPlayer := func(id int) bool { return r.s.Player(PlayerID(id)) != nil }
	switch f.Type {
	case FieldBool:
		if b, ok := v.(bool); ok {
			return b, nil
		}
		return nil, bad("— да или нет")
	case FieldInt:
		if n, ok := toInt(v); ok && n >= 0 {
			return n, nil
		}
		return nil, bad("— целое число от нуля")
	case FieldText, FieldURL:
		str, ok := v.(string)
		if !ok {
			return nil, bad("— текст")
		}
		str = strings.TrimSpace(str)
		if f.Type == FieldURL && str != "" && !strings.HasPrefix(str, "http://") && !strings.HasPrefix(str, "https://") {
			return nil, bad("— ссылка (http:// или https://)")
		}
		return str, nil
	case FieldPlayer:
		if n, ok := toInt(v); ok && isPlayer(n) && PlayerID(n) != owner {
			return n, nil
		}
		return nil, bad("— другой участник")
	case FieldPlayers:
		list, ok := v.([]any)
		if !ok {
			return nil, bad("— список участников")
		}
		out := make([]any, 0, len(list))
		for _, x := range list {
			n, ok := toInt(x)
			if !ok || !isPlayer(n) {
				return nil, bad("— список участников")
			}
			out = append(out, n)
		}
		return out, nil
	}
	return nil, bad("— неизвестный тип поля")
}

// --- using items -------------------------------------------------------------------

// CanUse reports whether the actor may use the item now.
func (e *Engine) CanUse(s *State, actor PlayerID, itemID int64) error {
	_, _, _, err := e.on(s).checkUse(actor, itemID)
	return err
}

func (r *run) checkUse(actor PlayerID, itemID int64) (*Item, *Def, *Turn, error) {
	it := r.s.Item(itemID)
	if it == nil || it.Player != actor || it.Placement == PlaceVoided {
		return nil, nil, nil, fmt.Errorf("%w: предмет не найден", ErrNotAllowed)
	}
	d := r.def(it)
	t := r.s.CurrentTurn(actor)
	cur := t.CurrentStep()

	if d.Kind == KindBonus {
		if it.Placement != PlacePocket {
			return nil, nil, nil, fmt.Errorf("%w: бонуса нет в кармане", ErrNotAllowed)
		}
		for _, other := range r.turnItems(t) {
			if r.def(other).blocks(KindBonus) {
				return nil, nil, nil, fmt.Errorf("%w: на этой игре бонусы запрещены («%s»)", ErrNotAllowed, r.def(other).Name)
			}
		}
	}

	switch d.Use {
	case UsePlaythrough:
		if t.Playthrough == 0 || cur == nil || cur.Kind != StepPlay {
			return nil, nil, nil, fmt.Errorf("%w: применяется во время игры", ErrNotAllowed)
		}
	case UseAfterSpin:
		if !r.lastStepWasSpin(t) {
			return nil, nil, nil, fmt.Errorf("%w: применяется сразу после крутки", ErrNotAllowed)
		}
	case UseInsteadOfGameSpin:
		if cur == nil || cur.Kind != StepSpinGame {
			return nil, nil, nil, fmt.Errorf("%w: применяется вместо крутки колеса игр", ErrNotAllowed)
		}
	case UseAnytime:
	case UseOffer:
		if !slices.Contains(r.turnItems(t), it) || r.blocked(it, r.turnItems(t)) {
			return nil, nil, nil, fmt.Errorf("%w: эффект не действует на эту игру", ErrNotAllowed)
		}
	default:
		return nil, nil, nil, fmt.Errorf("%w: этот предмет не применяется вручную", ErrNotAllowed)
	}
	if c, ok := d.Impl.(UseChecker); ok {
		if err := c.CanUse(r.ctx(it, t), r.self(it, 0)); err != nil {
			return nil, nil, nil, err
		}
	}
	return it, d, t, nil
}

// lastStepWasSpin reports whether the latest done step of the turn is a spin
// and nothing has happened after it.
func (r *run) lastStepWasSpin(t *Turn) bool {
	var last *Step
	for _, st := range t.Steps {
		if st.Done && (last == nil || st.DoneSeq > last.DoneSeq) {
			last = st
		}
	}
	return last != nil && last.SpinID != 0
}

// Use uses an item: spends a pocket bonus or takes an effect's offer.
func (e *Engine) Use(s *State, actor PlayerID, itemID int64) error {
	r := e.on(s)
	it, d, t, err := r.checkUse(actor, itemID)
	if err != nil {
		return err
	}
	if h, ok := d.Impl.(User); ok {
		if err := h.OnUse(r.ctx(it, t), &UseOps{r: r, turn: t, item: it}, r.self(it, 0)); err != nil {
			return err
		}
	}
	if d.Kind == KindBonus && it.Placement == PlacePocket {
		it.TurnID = t.ID
		if d.Use == UsePlaythrough {
			r.attach(it, t.Playthrough)
		} else {
			it.Placement = PlaceUsed
		}
	}
	return nil
}
