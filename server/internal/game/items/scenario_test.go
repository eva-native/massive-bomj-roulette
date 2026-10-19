package items_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game/items"
)

// scriptedPicker returns the sector named by the next queued label: an item
// def id for item wheels, a title for games and movies.
type scriptedPicker struct{ queue []string }

func (p *scriptedPicker) Pick(w game.WheelKind, sectors []game.Sector) (int, error) {
	if len(p.queue) == 0 {
		return 0, fmt.Errorf("no scripted result for the %s wheel", w)
	}
	want := p.queue[0]
	p.queue = p.queue[1:]
	for i, s := range sectors {
		if s.DefID == want || s.Label == want {
			return i, nil
		}
	}
	var have []string
	for _, s := range sectors {
		have = append(have, s.DefID+s.Label)
	}
	return 0, fmt.Errorf("%q is not on the %s wheel (have %s)", want, w, strings.Join(have, ", "))
}

// scenario drives one event through the engine.
type scenario struct {
	t      *testing.T
	s      *game.State
	e      *game.Engine
	picker *scriptedPicker
	judge  game.PlayerID
}

func newScenario(t *testing.T) *scenario {
	t.Helper()
	cat, err := items.NewCatalog()
	if err != nil {
		t.Fatal(err)
	}
	p := &scriptedPicker{}
	sc := &scenario{t: t, s: &game.State{}, e: game.NewEngine(cat, p), picker: p}
	sc.judge = sc.join("Судья", true)
	return sc
}

// roundTrip saves the state as JSON and loads it back, as the service layer
// will do between actions.
func (sc *scenario) roundTrip() {
	sc.t.Helper()
	b, err := json.Marshal(sc.s)
	if err != nil {
		sc.t.Fatal(err)
	}
	var s game.State
	if err := json.Unmarshal(b, &s); err != nil {
		sc.t.Fatal(err)
	}
	sc.s = &s
}

func (sc *scenario) join(name string, judge bool) game.PlayerID {
	sc.t.Helper()
	id := game.PlayerID(len(sc.s.Players) + 100)
	if err := sc.e.Join(sc.s, game.Player{ID: id, Name: name, Judge: judge}); err != nil {
		sc.t.Fatal(err)
	}
	return id
}

func (sc *scenario) player(name string) game.PlayerID { return sc.join(name, false) }

func (sc *scenario) addGame(title string, hltb, rating, year int, by game.PlayerID) *game.Game {
	return sc.s.AddGame(game.Game{Title: title, HLTB: hltb, Rating: rating, Year: year, AddedBy: by})
}

func (sc *scenario) game(title string) *game.Game {
	for _, g := range sc.s.Games {
		if g.Title == title {
			return g
		}
	}
	sc.t.Fatalf("no game %q", title)
	return nil
}

func (sc *scenario) step(p game.PlayerID) *game.Step {
	sc.t.Helper()
	st := sc.s.CurrentTurn(p).CurrentStep()
	if st == nil {
		sc.t.Fatalf("player %d has no current step", p)
	}
	return st
}

func (sc *scenario) steps(p game.PlayerID) []game.StepKind {
	var out []game.StepKind
	for _, st := range sc.s.CurrentTurn(p).Steps {
		if !st.Done {
			out = append(out, st.Kind)
		}
	}
	return out
}

// spin spins the current step of p, scripting the result.
func (sc *scenario) spin(p game.PlayerID, result string) {
	sc.t.Helper()
	sc.picker.queue = append(sc.picker.queue, result)
	if _, err := sc.e.Spin(sc.s, p, sc.step(p).ID); err != nil {
		sc.t.Fatalf("spin %q: %v", result, err)
	}
}

// wheel lists the labels of p's current wheel (def ids for item wheels).
func (sc *scenario) wheel(p game.PlayerID) []string {
	sc.t.Helper()
	_, sectors, err := sc.e.Wheel(sc.s, p, sc.step(p).ID)
	if err != nil {
		sc.t.Fatalf("wheel: %v", err)
	}
	var out []string
	for _, s := range sectors {
		if s.DefID != "" {
			out = append(out, s.DefID)
		} else {
			out = append(out, s.Label)
		}
	}
	return out
}

func (sc *scenario) expectWheel(p game.PlayerID, want ...string) {
	sc.t.Helper()
	if got := sc.wheel(p); !slices.Equal(got, want) {
		sc.t.Fatalf("wheel = %v, want %v", got, want)
	}
}

func (sc *scenario) choose(p game.PlayerID, id int64) {
	sc.t.Helper()
	if err := sc.e.Choose(sc.s, p, sc.step(p).ID, id); err != nil {
		sc.t.Fatalf("choose %d: %v", id, err)
	}
}

func (sc *scenario) finish(p game.PlayerID, outcome game.Outcome, hours float64) {
	sc.t.Helper()
	if err := sc.e.FinishGame(sc.s, p, sc.step(p).ID, outcome, hours, ""); err != nil {
		sc.t.Fatalf("finish: %v", err)
	}
}

// confirm makes the judge accept p's current game.
func (sc *scenario) confirm(p game.PlayerID) {
	sc.t.Helper()
	if err := sc.e.ConfirmGame(sc.s, sc.judge, sc.playthrough(p).ID, true); err != nil {
		sc.t.Fatalf("confirm: %v", err)
	}
}

// play finishes and confirms p's current game in one go.
func (sc *scenario) play(p game.PlayerID, outcome game.Outcome, hours float64) {
	sc.t.Helper()
	sc.finish(p, outcome, hours)
	sc.confirm(p)
}

func (sc *scenario) playthrough(p game.PlayerID) *game.Playthrough {
	sc.t.Helper()
	pt := sc.s.Playthrough(sc.s.CurrentTurn(p).Playthrough)
	if pt == nil {
		sc.t.Fatalf("player %d has no game yet", p)
	}
	return pt
}

func (sc *scenario) currentGame(p game.PlayerID) string {
	return sc.s.Game(sc.playthrough(p).Game).Title
}

// item returns p's latest item with the given def that was not rerolled.
func (sc *scenario) item(p game.PlayerID, defID string) *game.Item {
	sc.t.Helper()
	var found *game.Item
	for _, it := range sc.s.Items {
		if it.Player == p && it.DefID == defID && it.Placement != game.PlaceVoided {
			found = it
		}
	}
	if found == nil {
		sc.t.Fatalf("player %d has no %s", p, defID)
	}
	return found
}

func (sc *scenario) use(p game.PlayerID, defID string) error {
	return sc.e.Use(sc.s, p, sc.item(p, defID).ID)
}

func (sc *scenario) mustUse(p game.PlayerID, defID string) {
	sc.t.Helper()
	if err := sc.use(p, defID); err != nil {
		sc.t.Fatalf("use %s: %v", defID, err)
	}
}

func (sc *scenario) total(p game.PlayerID) int {
	return game.Totals(sc.e.Score(sc.s))[p]
}

func (sc *scenario) expectTotal(p game.PlayerID, want int) {
	sc.t.Helper()
	if got := sc.total(p); got != want {
		var lines []string
		for _, e := range sc.e.Score(sc.s) {
			if e.Player == p {
				lines = append(lines, fmt.Sprintf("%s %+d", e.Source, e.Points))
			}
		}
		sc.t.Fatalf("total = %d, want %d (%s)", got, want, strings.Join(lines, ", "))
	}
}

func (sc *scenario) expectSteps(p game.PlayerID, want ...game.StepKind) {
	sc.t.Helper()
	if got := sc.steps(p); !slices.Equal(got, want) {
		sc.t.Fatalf("pending steps = %v, want %v", got, want)
	}
}

func expectErr(t *testing.T, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
}
