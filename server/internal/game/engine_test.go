package game

import (
	"encoding/json"
	"errors"
	"testing"
)

// duel is a test item in the spirit of «100 к 1»: the judge enters the
// opponent and the result, and points go to both players.
type duel struct{}

func (duel) Score(c *ScoreCtx, l *Ledger) {
	opp, ok := c.InputPlayer("opponent")
	won, _ := c.Bool("won")
	stake, _ := c.Int("stake")
	if !ok {
		return
	}
	if !won {
		stake = -stake
	}
	l.Add(stake)
	l.AddFor(opp, -stake)
}

type firstPicker struct{}

func (firstPicker) Pick(WheelKind, []Sector) (int, error) { return 0, nil }

func testEngine(t *testing.T) (*Engine, *State) {
	t.Helper()
	cat, err := NewCatalog(&Def{
		ID: "duel", Name: "Дуэль", Kind: KindEffect, Weight: 1, NeedsConfirm: true,
		Input: []Field{
			{Name: "opponent", Type: FieldPlayer, By: RolePlayer},
			{Name: "won", Type: FieldBool, By: RoleJudge},
			{Name: "stake", Type: FieldInt, By: RoleJudge},
			{Name: "proof", Type: FieldURL, By: RolePlayer, Optional: true},
			{Name: "late", Type: FieldPlayers, By: RoleJudge, Optional: true},
		},
		Impl: duel{},
	})
	if err != nil {
		t.Fatal(err)
	}
	s := &State{Settings: Settings{StartSpins: 1}}
	e := NewEngine(cat, firstPicker{})
	for _, p := range []Player{{ID: 1, Name: "Алиса"}, {ID: 2, Name: "Боб"}, {ID: 3, Name: "Судья", Judge: true}} {
		if err := e.Join(s, p); err != nil {
			t.Fatal(err)
		}
	}
	s.AddGame(Game{Title: "G", HLTB: 10, Rating: 80, Year: 2015, AddedBy: 1})
	return e, s
}

// roundTrip simulates saving the state to the database and loading it back.
func roundTrip(t *testing.T, s *State) *State {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var out State
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return &out
}

func play(t *testing.T, e *Engine, s *State, p PlayerID) {
	t.Helper()
	for i := 0; i < 2; i++ { // the item spin and the game spin
		if _, err := e.Spin(s, p, s.CurrentTurn(p).CurrentStep().ID); err != nil {
			t.Fatal(err)
		}
	}
}

func TestInputPointsForTwoPlayersAfterRoundTrip(t *testing.T) {
	e, s := testEngine(t)
	play(t, e, s, 1)
	it := s.Items[0]

	// Who may fill what.
	if err := e.SetInput(s, 2, it.ID, map[string]any{"opponent": 2}); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("another player filled the owner's field: %v", err)
	}
	if err := e.SetInput(s, 1, it.ID, map[string]any{"won": true}); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("the player filled a judge field: %v", err)
	}
	for _, bad := range []map[string]any{
		{"opponent": 1},         // yourself
		{"opponent": 99},        // nobody
		{"proof": "not a link"}, // not a URL
		{"unknown": true},       // no such field
		{"opponent": "Боб"},     // not an id
	} {
		if err := e.SetInput(s, 1, it.ID, bad); err == nil {
			t.Errorf("input %v was accepted", bad)
		}
	}
	if err := e.SetInput(s, 3, it.ID, map[string]any{"late": []any{"x"}}); !errors.Is(err, ErrBadInput) {
		t.Errorf("bad player list accepted: %v", err)
	}

	if err := e.SetInput(s, 1, it.ID, map[string]any{"opponent": 2, "proof": " https://youtu.be/x "}); err != nil {
		t.Fatal(err)
	}
	if err := e.SetInput(s, 3, it.ID, map[string]any{"won": true, "stake": 5, "late": []any{1, 2}}); err != nil {
		t.Fatal(err)
	}
	if err := e.ConfirmItem(s, 1, it.ID, true); !errors.Is(err, ErrNotJudge) {
		t.Fatalf("a player confirmed: %v", err)
	}
	if err := e.ConfirmItem(s, 3, it.ID, true); err != nil {
		t.Fatal(err)
	}

	// After a JSON round trip numbers become float64; scoring must not care.
	s = roundTrip(t, s)
	got := Totals(e.Score(s))
	if got[1] != 5 || got[2] != -5 {
		t.Fatalf("totals = %v, want Алиса +5, Боб −5", got)
	}
	for _, en := range e.Score(s) {
		if en.Player == 2 && en.From != 1 {
			t.Errorf("Боб's entry should come from Алиса: %+v", en)
		}
	}

	// Changing the input drops the confirmation.
	if err := e.SetInput(s, 3, s.Items[0].ID, map[string]any{"won": false}); err != nil {
		t.Fatal(err)
	}
	if got := Totals(e.Score(s)); got[1] != 0 {
		t.Fatalf("unconfirmed points counted: %v", got)
	}
}

func TestFinishGameValidation(t *testing.T) {
	e, s := testEngine(t)
	play(t, e, s, 1)
	step := s.CurrentTurn(1).CurrentStep().ID
	for _, c := range []struct {
		outcome Outcome
		hours   float64
	}{{"won", 1}, {OutcomeCompleted, 0}, {OutcomeDropped, -1}} {
		if err := e.FinishGame(s, 1, step, c.outcome, c.hours, ""); !errors.Is(err, ErrBadInput) {
			t.Errorf("%v: err = %v, want ErrBadInput", c, err)
		}
	}
	if err := e.FinishGame(s, 2, step, OutcomeDropped, 0, ""); !errors.Is(err, ErrWrongStep) {
		t.Errorf("another player's step: %v", err)
	}
	if err := e.FinishGame(s, 1, step, OutcomeDropped, 0, ""); err != nil {
		t.Fatal(err)
	}
	if err := e.ConfirmGame(s, 3, s.Playthroughs[0].ID, true); err != nil {
		t.Fatal(err)
	}
	if err := e.ConfirmGame(s, 3, s.Playthroughs[0].ID, true); !errors.Is(err, ErrNotAllowed) {
		t.Errorf("confirming twice: %v", err)
	}
}

func TestCatalogValidation(t *testing.T) {
	ok := func() *Def { return &Def{ID: "x", Name: "X", Kind: KindEffect} }
	cases := map[string]*Def{
		"no name":       {ID: "x", Kind: KindEffect},
		"bad kind":      {ID: "x", Name: "X", Kind: "curse"},
		"neg weight":    {ID: "x", Name: "X", Kind: KindEffect, Weight: -1},
		"bonus offer":   {ID: "x", Name: "X", Kind: KindBonus, Use: UseOffer},
		"effect pocket": {ID: "x", Name: "X", Kind: KindEffect, Use: UsePlaythrough},
		"no OnUse":      {ID: "x", Name: "X", Kind: KindBonus, Use: UseAfterSpin},
		"bad field":     {ID: "x", Name: "X", Kind: KindEffect, Input: []Field{{Name: "f", Type: FieldBool}}},
	}
	for name, d := range cases {
		if _, err := NewCatalog(d); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := NewCatalog(ok(), ok()); err == nil {
		t.Error("duplicate ids accepted")
	}
	if _, err := NewCatalog(ok()); err != nil {
		t.Errorf("valid def rejected: %v", err)
	}
}

func TestRandomPickerRespectsWeights(t *testing.T) {
	sectors := []Sector{{Label: "never", Weight: 0}, {Label: "rare", Weight: 1}, {Label: "often", Weight: 9}}
	counts := map[string]int{}
	for range 2000 {
		i, err := RandomPicker{}.Pick(WheelItems, sectors)
		if err != nil {
			t.Fatal(err)
		}
		counts[sectors[i].Label]++
	}
	if counts["never"] != 0 || counts["rare"] == 0 || counts["often"] < 5*counts["rare"] {
		t.Fatalf("counts = %v", counts)
	}
	if _, err := (RandomPicker{}).Pick(WheelItems, []Sector{{Weight: 0}}); !errors.Is(err, ErrEmptyWheel) {
		t.Fatalf("all-zero wheel: %v", err)
	}
}

func TestEventSettingsShapeTheItemWheel(t *testing.T) {
	e, s := testEngine(t)
	step := s.CurrentTurn(1).CurrentStep().ID
	s.Settings.Disabled = map[string]bool{"duel": true}
	if _, _, err := e.Wheel(s, 1, step); !errors.Is(err, ErrEmptyWheel) {
		t.Fatalf("disabled item still on the wheel: %v", err)
	}
	s.Settings.Disabled = nil
	s.Settings.Weights = map[string]int{"duel": 7}
	_, sectors, err := e.Wheel(s, 1, step)
	if err != nil || len(sectors) != 1 || sectors[0].Weight != 7 {
		t.Fatalf("weight override not applied: %v %v", sectors, err)
	}
}
