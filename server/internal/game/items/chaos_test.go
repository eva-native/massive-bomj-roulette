package items_test

import (
	"encoding/json"
	"errors"
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game/items"
)

// seededPicker picks sectors with a seeded random source, so a failing run
// can be repeated.
type seededPicker struct{ rnd *rand.Rand }

func (p seededPicker) Pick(_ game.WheelKind, sectors []game.Sector) (int, error) {
	return p.rnd.IntN(len(sectors)), nil
}

// TestChaos plays many random but legal actions with every item in the
// catalog and checks that the engine never panics, scores every state the
// same way twice and survives a JSON round trip.
func TestChaos(t *testing.T) {
	seeds := []uint64{1, 2, 3, 4, 5, 6, 7, 8}
	if testing.Short() {
		seeds = seeds[:2]
	}
	for _, seed := range seeds {
		t.Run("", func(t *testing.T) { chaos(t, seed, 1500) })
	}
}

func chaos(t *testing.T, seed uint64, steps int) {
	rnd := rand.New(rand.NewPCG(seed, seed*7919))
	cat, err := items.NewCatalog()
	if err != nil {
		t.Fatal(err)
	}
	e := game.NewEngine(cat, seededPicker{rnd})
	s := &game.State{Settings: game.Settings{SpinsByHours: []game.SpinsRow{{MinHours: 0, Spins: 1}, {MinHours: 20, Spins: 2}}}}

	judge := game.PlayerID(1)
	s.Judges = []game.PlayerID{judge}
	players := []game.PlayerID{10, 11, 12}
	for _, p := range players {
		if err := e.Join(s, game.Player{ID: p, Name: "p"}); err != nil {
			t.Fatal(err)
		}
	}
	for i := range 60 {
		s.AddGame(game.Game{Title: "G", HLTB: 1 + rnd.IntN(40), Rating: rnd.IntN(101), Year: 1990 + rnd.IntN(35), AddedBy: players[i%3]})
	}
	s.AddGame(game.Game{Title: "Смута", HLTB: 12, Rating: 40, Year: 2024, SpecialKey: "smuta"})
	s.AddGame(game.Game{Title: "Земский собор", HLTB: 5, Rating: 30, Year: 2024, SpecialKey: "zemsky_sobor"})
	for range 4 {
		s.AddMovie(game.Movie{Title: "M"})
	}

	defer func() {
		if v := recover(); v != nil {
			t.Fatalf("seed %d: panic: %v", seed, v)
		}
	}()

	defer func() {
		defs := map[string]bool{}
		used := 0
		for _, it := range s.Items {
			defs[it.DefID] = true
			if it.Placement == game.PlaceUsed || it.Placement == game.PlaceAttached && e.Catalog().Def(it.DefID).Kind == game.KindBonus {
				used++
			}
		}
		done := 0
		for _, pt := range s.Playthroughs {
			if pt.Confirmed {
				done++
			}
		}
		t.Logf("STATS seed=%d turns=%d spins=%d items=%d distinct=%d bonusesUsed=%d confirmedGames=%d resets=%d", seed, len(s.Turns), len(s.Spins), len(s.Items), len(defs), used, done, len(s.WheelResets))
	}()
	for i := range steps {
		p := players[rnd.IntN(len(players))]
		act(t, e, s, rnd, p, judge)

		if i%50 == 0 {
			first, second := e.Score(s), e.Score(s)
			if !slices.Equal(first, second) {
				t.Fatalf("seed %d step %d: scoring is not deterministic", seed, i)
			}
			b, err := json.Marshal(s)
			if err != nil {
				t.Fatal(err)
			}
			var back game.State
			if err := json.Unmarshal(b, &back); err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(e.Score(&back), first) {
				t.Fatalf("seed %d step %d: scores differ after a JSON round trip", seed, i)
			}
			s = &back
		}
	}
}

// act makes one random legal move for p (or the judge).
func act(t *testing.T, e *game.Engine, s *game.State, rnd *rand.Rand, p, judge game.PlayerID) {
	t.Helper()
	ok := func(err error) {
		t.Helper()
		// Rule refusals are expected in a random walk; anything else is a bug.
		if err != nil && !isRuleRefusal(err) {
			t.Fatalf("unexpected error: %v", err)
		}
	}

	// Often play with items: use one or fill its fields.
	if rnd.IntN(2) == 0 {
		var mine []*game.Item
		for _, it := range s.Items {
			if it.Player == p && it.Placement != game.PlaceVoided {
				mine = append(mine, it)
			}
		}
		if len(mine) > 0 {
			it := mine[rnd.IntN(len(mine))]
			if rnd.IntN(2) == 0 {
				ok(e.Use(s, p, it.ID))
			} else {
				fillInput(e, s, rnd, it, p, judge, ok)
			}
			return
		}
	}

	// The judge confirms what waits.
	if rnd.IntN(3) == 0 {
		for _, pt := range s.Playthroughs {
			if pt.Outcome != game.OutcomeNone && !pt.Confirmed {
				ok(e.ConfirmGame(s, judge, pt.ID, rnd.IntN(5) != 0))
				return
			}
		}
		for _, it := range s.Items {
			if !it.Confirmed && !it.Rejected && it.Placement != game.PlaceVoided && e.Catalog().Def(it.DefID).NeedsConfirm {
				ok(e.ConfirmItem(s, judge, it.ID, true))
				return
			}
		}
	}

	t0 := s.CurrentTurn(p)
	st := t0.CurrentStep()
	if st == nil {
		return // waiting for the judge
	}
	switch st.Kind {
	case game.StepSpinItems, game.StepSpinDrop, game.StepSpinGame, game.StepSpinMovie:
		_, err := e.Spin(s, p, st.ID)
		ok(err)
	case game.StepChoosePlayer:
		var others []game.PlayerID
		for _, pl := range s.Players {
			if pl.ID != p {
				others = append(others, pl.ID)
			}
		}
		ok(e.Choose(s, p, st.ID, int64(others[rnd.IntN(len(others))])))
	case game.StepChooseGame:
		ok(e.Choose(s, p, st.ID, st.Options[rnd.IntN(len(st.Options))]))
	case game.StepPlay:
		if rnd.IntN(3) == 0 {
			ok(e.FinishGame(s, p, st.ID, game.OutcomeDropped, float64(rnd.IntN(10)), ""))
		} else {
			ok(e.FinishGame(s, p, st.ID, game.OutcomeCompleted, 1+float64(rnd.IntN(50)), "https://proof"))
		}
	}
}

func fillInput(e *game.Engine, s *game.State, rnd *rand.Rand, it *game.Item, p, judge game.PlayerID, ok func(error)) {
	d := e.Catalog().Def(it.DefID)
	for _, f := range d.Input {
		actor := p
		if f.By == game.RoleJudge {
			actor = judge
		}
		var v any
		switch f.Type {
		case game.FieldBool:
			v = rnd.IntN(2) == 0
		case game.FieldInt:
			v = float64(rnd.IntN(20))
		case game.FieldText:
			v = "решение"
		case game.FieldURL:
			v = "https://example.com"
		case game.FieldPlayer:
			for _, pl := range s.Players {
				if pl.ID != it.Player {
					v = float64(pl.ID)
				}
			}
		case game.FieldPlayers:
			v = []any{float64(s.Players[0].ID)}
		}
		ok(e.SetInput(s, actor, it.ID, map[string]any{f.Name: v}))
	}
}

func isRuleRefusal(err error) bool {
	for _, want := range []error{game.ErrNotAllowed, game.ErrTooLate, game.ErrEmptyWheel, game.ErrWrongStep, game.ErrNotYourTurn, game.ErrBadInput} {
		if errors.Is(err, want) {
			return true
		}
	}
	// Item hooks refuse with plain errors («уже использовано»).
	return err.Error() == "уже использовано" || err.Error() == "игра ещё не выпала"
}
