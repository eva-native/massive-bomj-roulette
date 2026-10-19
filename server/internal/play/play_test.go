package play

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game/items"
	"github.com/eva-native/massive-bomj-roulette/server/internal/live"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/storetest"
)

// labelPicker picks the sector whose label (or item id) matches the next
// queued value, or the first sector when nothing is queued.
type labelPicker struct {
	mu    sync.Mutex
	queue []string
}

func (p *labelPicker) push(labels ...string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.queue = append(p.queue, labels...)
}

func (p *labelPicker) Pick(_ game.WheelKind, sectors []game.Sector) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.queue) == 0 {
		return 0, nil
	}
	want := p.queue[0]
	p.queue = p.queue[1:]
	for i, s := range sectors {
		if s.Label == want || s.DefID == want {
			return i, nil
		}
	}
	return 0, fmt.Errorf("%q is not on the wheel", want)
}

type fixture struct {
	t                 *testing.T
	ctx               context.Context
	play              *Service
	events            *events.Service
	picker            *labelPicker
	broker            *live.Broker
	admin, alice, bob *auth.User
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	st := storetest.New(t)
	cat, err := items.NewCatalog()
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, ctx: context.Background(), picker: &labelPicker{}, broker: live.NewBroker()}
	f.play = New(st, game.NewEngine(cat, f.picker), f.broker)
	f.events = events.New(st, cat)
	f.events.SetGameUsage(f.play)
	user := func(name string, admin bool) *auth.User {
		u, err := st.UpsertUserByDiscordID(f.ctx, db.UpsertUserByDiscordIDParams{DiscordID: "dev:" + name, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return &auth.User{ID: u.ID, Name: u.Name, IsAdmin: admin}
	}
	f.admin, f.alice, f.bob = user("Судья", true), user("Алиса", false), user("Боб", false)

	if _, err := f.events.Create(f.ctx, f.admin, api.CreateEventRequest{Title: "ЛБР", Slug: "lbr"}); err != nil {
		t.Fatal(err)
	}
	for _, u := range []*auth.User{f.alice, f.bob} {
		if _, err := f.events.Join(f.ctx, u, "lbr"); err != nil {
			t.Fatal(err)
		}
	}
	// Keep the item wheel predictable: only plain items.
	s := api.EventSettings{StartSpins: 3, Disabled: []string{}}
	for _, it := range cat.All() {
		if it.ID != "reflex" && it.ID != "opaaa" {
			s.Disabled = append(s.Disabled, it.ID)
		}
	}
	if _, err := f.events.Update(f.ctx, f.admin, "lbr", api.UpdateEventRequest{Settings: &s}); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *fixture) addGame(u *auth.User, title string, hltb, rating, year int) api.Game {
	f.t.Helper()
	g, err := f.events.AddGame(f.ctx, u, "lbr", api.GameInput{Title: title, HLTBHours: hltb, Rating: rating, Year: year})
	if err != nil {
		f.t.Fatal(err)
	}
	return g
}

func (f *fixture) view(u *auth.User) api.PlayerView {
	f.t.Helper()
	v, err := f.play.Player(f.ctx, "lbr", u, u.ID)
	if err != nil {
		f.t.Fatal(err)
	}
	return v
}

func (f *fixture) spin(u *auth.User, label string) api.SpinResult {
	f.t.Helper()
	f.picker.push(label)
	res, err := f.play.Spin(f.ctx, "lbr", u, f.view(u).Turn.Current.ID)
	if err != nil {
		f.t.Fatalf("spin %q: %v", label, err)
	}
	return res
}

func TestFullTurn(t *testing.T) {
	f := newFixture(t)
	f.addGame(f.alice, "GTA San Andreas", 30, 87, 2004) // base 39

	v := f.view(f.alice)
	if v.Turn == nil || len(v.Turn.Steps) != 5 || v.Turn.Current.Kind != "spin_items" || !v.CanAct {
		t.Fatalf("start turn = %+v", v.Turn)
	}
	if v.Turn.Wheel == nil || len(v.Turn.Wheel.Sectors) != 2 {
		t.Fatalf("item wheel = %+v", v.Turn.Wheel)
	}

	// Bob cannot take Alice's step.
	_, err := f.play.Spin(f.ctx, "lbr", f.bob, v.Turn.Current.ID)
	if !errors.Is(err, events.ErrConflict) {
		t.Fatalf("bob spun alice's step: %v", err)
	}

	res := f.spin(f.alice, "opaaa")
	if res.Label != "ОПАААА" || res.Wheel.Sectors[res.Result].Label != "ОПАААА" {
		t.Fatalf("spin result = %+v", res)
	}
	f.spin(f.alice, "reflex")
	f.spin(f.alice, "reflex")
	res = f.spin(f.alice, "GTA San Andreas")
	if res.View.Turn.Current.Kind != "play" || res.View.Turn.Playthrough.Game != "GTA San Andreas" {
		t.Fatalf("after game spin: %+v", res.View.Turn)
	}
	if len(res.View.Turn.Items) != 3 {
		t.Fatalf("items on the game = %d, want 3", len(res.View.Turn.Items))
	}

	_, err = f.play.Finish(f.ctx, "lbr", f.alice, res.View.Turn.Current.ID, api.FinishRequest{Outcome: "completed", Hours: 25, Proof: "not a link"})
	var ie *events.InvalidError
	if !errors.As(err, &ie) {
		t.Fatalf("bad proof: %v", err)
	}
	v, err = f.play.Finish(f.ctx, "lbr", f.alice, res.View.Turn.Current.ID, api.FinishRequest{Outcome: "completed", Hours: 25, Proof: "https://imgur.com/x"})
	if err != nil {
		t.Fatal(err)
	}
	if v.Turn.Current != nil || v.Turn.Waiting == "" || v.Points != 0 {
		t.Fatalf("waiting for the judge: %+v points %d", v.Turn, v.Points)
	}

	// The judge's queue has the game; players cannot see it.
	if _, err := f.play.Queue(f.ctx, "lbr", f.alice); !errors.Is(err, events.ErrForbidden) {
		t.Fatalf("player saw the queue: %v", err)
	}
	q, err := f.play.Queue(f.ctx, "lbr", f.admin)
	if err != nil || len(q) != 1 || q[0].Kind != "playthrough" {
		t.Fatalf("queue = %+v, %v", q, err)
	}
	// A judge who does not play confirms.
	if err := f.play.ConfirmGame(f.ctx, "lbr", f.admin, q[0].ID, true); err != nil {
		t.Fatal(err)
	}

	v = f.view(f.alice)
	if v.Points != 39+5+1+4 || v.Turn.Number != 2 || v.Turn.Current.Kind != "spin_items" || len(v.History) != 1 {
		t.Fatalf("after confirm: points %d, turn %+v, history %d", v.Points, v.Turn, len(v.History))
	}

	board, err := f.play.Leaderboard(f.ctx, "lbr", nil)
	if err != nil || board[0].Player.Name != "Алиса" || board[0].Points != 49 || board[0].Completed != 1 {
		t.Fatalf("leaderboard = %+v, %v", board, err)
	}
	acts, err := f.play.Activity(f.ctx, "lbr", 0)
	if err != nil || len(acts) != 6 || acts[0].Kind != "confirm" {
		t.Fatalf("activity = %+v, %v", acts, err)
	}

	// The played game cannot be deleted any more.
	g := f.view(f.alice).History[0]
	if err := f.events.DeleteGame(f.ctx, f.admin, "lbr", g.GameID); !errors.Is(err, events.ErrConflict) {
		t.Fatalf("deleting a played game: %v", err)
	}
}

func TestEmptyGameWheelIsExplained(t *testing.T) {
	f := newFixture(t)
	for range 3 {
		f.spin(f.alice, "reflex")
	}
	v := f.view(f.alice)
	if v.Turn.Wheel != nil || v.Turn.Waiting == "" {
		t.Fatalf("empty game wheel: %+v", v.Turn)
	}
}

func TestNonParticipantsCannotAct(t *testing.T) {
	f := newFixture(t)
	v := f.view(f.alice)
	if _, err := f.play.Spin(f.ctx, "lbr", f.admin, v.Turn.Current.ID); !errors.Is(err, events.ErrForbidden) {
		t.Fatalf("a judge who does not play spun: %v", err)
	}
	if _, err := f.play.Spin(f.ctx, "lbr", nil, v.Turn.Current.ID); !errors.Is(err, events.ErrUnauthenticated) {
		t.Fatalf("anonymous spun: %v", err)
	}
	if other := f.view(f.bob); other.CanAct != true {
		t.Fatal("bob should be able to act on his own turn")
	}
	if seen, _ := f.play.Player(f.ctx, "lbr", f.bob, f.alice.ID); seen.CanAct {
		t.Fatal("bob must not act on alice's turn")
	}
}

func TestPlayersActConcurrently(t *testing.T) {
	f := newFixture(t)
	f.addGame(f.alice, "G", 10, 80, 2015)
	// Load once so both players have their first turns saved.
	f.view(f.alice)
	f.view(f.bob)

	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for _, u := range []*auth.User{f.alice, f.bob} {
		wg.Add(1)
		go func(u *auth.User) {
			defer wg.Done()
			for range 3 {
				v, err := f.play.Player(f.ctx, "lbr", u, u.ID)
				if err != nil {
					errs <- err
					return
				}
				if _, err := f.play.Spin(f.ctx, "lbr", u, v.Turn.Current.ID); err != nil {
					errs <- err
					return
				}
			}
		}(u)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	for _, u := range []*auth.User{f.alice, f.bob} {
		if cur := f.view(u).Turn.Current; cur.Kind != "spin_game" {
			t.Fatalf("%s: current step = %s, want spin_game (no spin lost)", u.Name, cur.Kind)
		}
	}
}

func TestLiveNotification(t *testing.T) {
	f := newFixture(t)
	eventID, err := f.play.EventID(f.ctx, "lbr")
	if err != nil {
		t.Fatal(err)
	}
	f.view(f.alice)
	msgs, unsub := f.broker.Subscribe(eventID)
	defer unsub()
	f.spin(f.alice, "reflex")
	if m := <-msgs; m.Kind != "spin" || m.Message == "" {
		t.Fatalf("live message = %+v", m)
	}
}
