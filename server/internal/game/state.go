// Package game is the rules engine: turns, wheels, items and scoring.
//
// The engine works on an in-memory snapshot of one event (State). An action
// (spin, choice, finishing a game, using a bonus, a judge's confirmation)
// changes the snapshot according to the rules; scoring is a pure function of
// the snapshot. The service layer loads the snapshot, applies an action and
// saves it in one transaction; tests use the snapshot directly.
package game

import "encoding/json"

type PlayerID int64

type Player struct {
	ID    PlayerID
	Name  string
	Judge bool
}

type Game struct {
	ID      int64
	Title   string
	AddedBy PlayerID
	HLTB    int // hours on HowLongToBeat
	Rating  int
	Year    int
	// SpecialKey marks games provided by items («Смута», «Земский собор»).
	// They never appear on the regular game wheel.
	SpecialKey string
}

type Movie struct {
	ID      int64
	Title   string
	AddedBy PlayerID
}

// Settings are per-event rule parameters.
type Settings struct {
	StartSpins int // spins of the effects-and-bonuses wheel at the start of the event
	// SpinsByHours gives the number of spins after a completed game by its HLTB
	// hours: the last row with MinHours <= hours wins. Empty means 1 spin.
	SpinsByHours []SpinsRow
	Weights      map[string]int  // item weight overrides by def id
	Disabled     map[string]bool // items switched off for this event
}

type SpinsRow struct {
	MinHours int
	Spins    int
}

func (s Settings) spinsAfter(hours int) int {
	n := 1
	for _, r := range s.SpinsByHours {
		if hours >= r.MinHours {
			n = r.Spins
		}
	}
	return n
}

type TurnReason string

const (
	ReasonStart     TurnReason = "start"
	ReasonCompleted TurnReason = "completed"
	ReasonDropped   TurnReason = "dropped"
)

type StepKind string

const (
	StepSpinItems    StepKind = "spin_items"    // effects-and-bonuses wheel
	StepSpinDrop     StepKind = "spin_drop"     // drop-debuff wheel
	StepChoosePlayer StepKind = "choose_player" // pick a participant
	StepSpinGame     StepKind = "spin_game"     // game wheel
	StepChooseGame   StepKind = "choose_game"   // pick a game from Options
	StepSpinMovie    StepKind = "spin_movie"    // movie wheel
	StepPlay         StepKind = "play"          // the game is being played
)

type Step struct {
	ID   int64
	Kind StepKind
	// CreatedBy is the item that added this step; 0 for steps of the turn itself.
	CreatedBy  int64
	CreatedSeq int64
	Done       bool
	DoneSeq    int64
	Options    []int64 // choose_game: allowed game ids
	Result     int64   // spin/choose result: item, game, movie or player id
	SpinID     int64
}

type Turn struct {
	ID     int64
	Seq    int64
	Player PlayerID
	Reason TurnReason
	Steps  []*Step
	// Game is the current game of the turn: the last game spin result, unless
	// an item set another one.
	Game int64
	// Playthrough is created once the game is final.
	Playthrough int64
}

type WheelKind string

const (
	WheelItems WheelKind = "items"
	WheelDrops WheelKind = "drops"
	WheelGames WheelKind = "games"
	WheelMovie WheelKind = "movies"
)

// Sector is one slot of a wheel. Item wheels fill DefID, game and movie wheels fill ID.
type Sector struct {
	ID     int64
	DefID  string
	Label  string
	Weight int
}

// Spin is a snapshot of a wheel at spin time and its result.
type Spin struct {
	ID      int64
	Seq     int64
	Player  PlayerID
	TurnID  int64
	StepID  int64
	Wheel   WheelKind
	Sectors []Sector
	Result  int // index into Sectors
	Voided  bool
}

func (s *Spin) Picked() Sector { return s.Sectors[s.Result] }

type Outcome string

const (
	OutcomeNone      Outcome = ""
	OutcomeCompleted Outcome = "completed"
	OutcomeDropped   Outcome = "dropped"
)

type Playthrough struct {
	ID        int64
	Seq       int64
	Player    PlayerID
	Game      int64
	TurnID    int64
	Outcome   Outcome
	Hours     float64
	Proof     string
	Confirmed bool
}

// Placement says where an item currently is.
type Placement string

const (
	PlacePending  Placement = "pending"  // waits for the next game of its turn
	PlacePocket   Placement = "pocket"   // a bonus kept for later
	PlaceAttached Placement = "attached" // works on a playthrough (Chain)
	PlaceUsed     Placement = "used"     // a bonus spent on a spin or a choice
	PlaceVoided   Placement = "voided"   // undone by a reroll
)

type Item struct {
	ID        int64
	Seq       int64
	DefID     string
	Player    PlayerID
	TurnID    int64 // turn it was rolled or used in
	SpinID    int64 // spin that produced it; 0 if not rolled
	Placement Placement
	// Chain lists the playthroughs the item works on, in order. Usually one;
	// multi-game items («Ни шагу назад») collect up to their Lifetime.
	Chain     []int64
	State     json.RawMessage
	Input     map[string]any
	Confirmed bool
	Rejected  bool
	// Forced marks a bonus activated at once instead of going to the pocket.
	Forced bool
	// Finished ends a listening item («Голосование за Путина»). FinishedBy is
	// the item that caused it, so a reroll of that item can undo it.
	Finished   bool
	FinishedBy int64
}

// State is everything the engine knows about one event.
type State struct {
	Settings Settings
	// Players are everyone who plays or played in the event.
	Players []*Player
	// Judges who do not play; they may confirm and fill judge fields too.
	Judges       []PlayerID
	Games        []*Game
	Movies       []*Movie
	Turns        []*Turn
	Spins        []*Spin
	Items        []*Item
	Playthroughs []*Playthrough
	WheelResets  []WheelReset

	NextID  int64
	NextSeq int64
}

// WheelReset returns a player's finished games to their wheel («Сделка»).
type WheelReset struct {
	Player PlayerID
	Seq    int64
}

func (s *State) id() int64  { s.NextID++; return s.NextID }
func (s *State) seq() int64 { s.NextSeq++; return s.NextSeq }

func (s *State) Player(id PlayerID) *Player {
	for _, p := range s.Players {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func (s *State) Game(id int64) *Game {
	for _, g := range s.Games {
		if g.ID == id {
			return g
		}
	}
	return nil
}

func (s *State) GameBySpecialKey(key string) *Game {
	for _, g := range s.Games {
		if g.SpecialKey == key {
			return g
		}
	}
	return nil
}

func (s *State) Movie(id int64) *Movie {
	for _, m := range s.Movies {
		if m.ID == id {
			return m
		}
	}
	return nil
}

func (s *State) Turn(id int64) *Turn {
	for _, t := range s.Turns {
		if t.ID == id {
			return t
		}
	}
	return nil
}

func (s *State) Spin(id int64) *Spin {
	for _, sp := range s.Spins {
		if sp.ID == id {
			return sp
		}
	}
	return nil
}

func (s *State) Item(id int64) *Item {
	for _, it := range s.Items {
		if it.ID == id {
			return it
		}
	}
	return nil
}

func (s *State) Playthrough(id int64) *Playthrough {
	for _, p := range s.Playthroughs {
		if p.ID == id {
			return p
		}
	}
	return nil
}

// CurrentTurn returns the player's latest turn.
func (s *State) CurrentTurn(p PlayerID) *Turn {
	var cur *Turn
	for _, t := range s.Turns {
		if t.Player == p {
			cur = t
		}
	}
	return cur
}

// CurrentStep returns the first step of the turn that is not done.
func (t *Turn) CurrentStep() *Step {
	for _, st := range t.Steps {
		if !st.Done {
			return st
		}
	}
	return nil
}

func (t *Turn) step(id int64) (int, *Step) {
	for i, st := range t.Steps {
		if st.ID == id {
			return i, st
		}
	}
	return -1, nil
}

// AddGame, AddMovie and AddPlayer are used by setup code and tests.

func (s *State) AddGame(g Game) *Game {
	g.ID = s.id()
	s.Games = append(s.Games, &g)
	return &g
}

func (s *State) AddMovie(m Movie) *Movie {
	m.ID = s.id()
	s.Movies = append(s.Movies, &m)
	return &m
}
