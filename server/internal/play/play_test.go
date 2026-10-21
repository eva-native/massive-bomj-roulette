package play

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game/items"
	"github.com/eva-native/massive-bomj-roulette/server/internal/live"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store"
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
	st                *store.Store
	admin, alice, bob *auth.User
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	st := storetest.New(t)
	cat, err := items.NewCatalog()
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, ctx: context.Background(), picker: &labelPicker{}, broker: live.NewBroker(), st: st}
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
		if _, err := f.events.Join(f.ctx, u, "lbr", ""); err != nil {
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
	if v.Points != 39+5+game.DefaultRecordPoints+4 || v.Turn.Number != 2 || v.Turn.Current.Kind != "spin_items" || len(v.History) != 1 {
		t.Fatalf("after confirm: points %d, turn %+v, history %d", v.Points, v.Turn, len(v.History))
	}

	board, err := f.play.Leaderboard(f.ctx, "lbr", nil)
	if err != nil || board[0].Player.Name != "Алиса" || board[0].Points != 39+5+game.DefaultRecordPoints+4 || board[0].Completed != 1 {
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

type fakeSender struct {
	mu   sync.Mutex
	sent []string
}

func (f *fakeSender) Send(webhook, text string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, webhook+" "+text)
}

func TestSpinSnapshotAndDiscord(t *testing.T) {
	f := newFixture(t)
	sender := &fakeSender{}
	f.play.SetNotifier(sender)
	f.addGame(f.alice, "G", 10, 80, 2015)

	// No webhook yet: nothing is sent.
	f.spin(f.alice, "reflex")
	if len(sender.sent) != 0 {
		t.Fatalf("sent without a webhook: %v", sender.sent)
	}

	d, err := f.events.Get(f.ctx, "lbr", f.admin)
	if err != nil {
		t.Fatal(err)
	}
	s := d.Settings
	s.WebhookURL = "https://discord.com/api/webhooks/1/x"
	if _, err := f.events.Update(f.ctx, f.admin, "lbr", api.UpdateEventRequest{Settings: &s}); err != nil {
		t.Fatal(err)
	}
	s.WebhookURL = "https://evil.example/hook"
	var ie *events.InvalidError
	if _, err := f.events.Update(f.ctx, f.admin, "lbr", api.UpdateEventRequest{Settings: &s}); !errors.As(err, &ie) {
		t.Fatalf("a non-Discord webhook was accepted: %v", err)
	}

	f.spin(f.alice, "opaaa")
	if len(sender.sent) != 1 || sender.sent[0] != "https://discord.com/api/webhooks/1/x Алиса крутит колесо эффектов и бонусов: ОПАААА" {
		t.Fatalf("sent = %v", sender.sent)
	}

	acts, err := f.play.Activity(f.ctx, "lbr", 1)
	if err != nil {
		t.Fatal(err)
	}
	sp := acts[0].Spin
	if sp == nil || sp.Player != "Алиса" || sp.Label != "ОПАААА" || sp.Wheel.Sectors[sp.Result].Label != "ОПАААА" {
		t.Fatalf("spin snapshot = %+v", sp)
	}
}

func TestJudgeTools(t *testing.T) {
	f := newFixture(t)
	f.addGame(f.alice, "G1", 10, 80, 2015) // base 17
	for range 3 {
		f.spin(f.alice, "reflex")
	}
	f.spin(f.alice, "G1")

	if err := f.play.UndoStep(f.ctx, "lbr", f.bob, f.alice.ID); !errors.Is(err, events.ErrForbidden) {
		t.Fatalf("a player undid a step: %v", err)
	}
	if err := f.play.UndoStep(f.ctx, "lbr", f.admin, f.alice.ID); err != nil {
		t.Fatal(err)
	}
	if cur := f.view(f.alice).Turn.Current; cur.Kind != "spin_game" {
		t.Fatalf("after undo the current step is %s", cur.Kind)
	}
	f.spin(f.alice, "G1")
	v := f.view(f.alice)
	if _, err := f.play.Finish(f.ctx, "lbr", f.alice, v.Turn.Current.ID, api.FinishRequest{Outcome: "completed", Hours: 20}); err != nil {
		t.Fatal(err)
	}
	ptID := f.view(f.alice).Turn.Playthrough.ID
	if err := f.play.ConfirmGame(f.ctx, "lbr", f.admin, ptID, true); err != nil {
		t.Fatal(err)
	}
	if got := f.view(f.alice).Points; got != 17-10+game.DefaultRecordPoints {
		t.Fatalf("points = %d", got)
	}
	if err := f.play.EditPlaythrough(f.ctx, "lbr", f.alice, ptID, api.EditPlaythroughRequest{Hours: 5}); !errors.Is(err, events.ErrForbidden) {
		t.Fatalf("a player edited hours: %v", err)
	}
	if err := f.play.EditPlaythrough(f.ctx, "lbr", f.admin, ptID, api.EditPlaythroughRequest{Hours: 8, Proof: "https://proof"}); err != nil {
		t.Fatal(err)
	}
	if got := f.view(f.alice).Points; got != 17+2+game.DefaultRecordPoints {
		t.Fatalf("points after the edit = %d", got)
	}
	acts, _ := f.play.Activity(f.ctx, "lbr", 1)
	if acts[0].Kind != "edit" {
		t.Fatalf("journal = %+v", acts[0])
	}
}

func TestFinishFreezesTheEvent(t *testing.T) {
	f := newFixture(t)
	f.addGame(f.alice, "G", 10, 80, 2015) // base 17
	for range 3 {
		f.spin(f.alice, "reflex")
	}
	f.spin(f.alice, "G")
	v := f.view(f.alice)
	if _, err := f.play.Finish(f.ctx, "lbr", f.alice, v.Turn.Current.ID, api.FinishRequest{Outcome: "completed", Hours: 10}); err != nil {
		t.Fatal(err)
	}
	if err := f.play.ConfirmGame(f.ctx, "lbr", f.admin, f.view(f.alice).Turn.Playthrough.ID, true); err != nil {
		t.Fatal(err)
	}

	if err := f.play.FinishEvent(f.ctx, "lbr", f.alice); !errors.Is(err, events.ErrForbidden) {
		t.Fatalf("a player finished the event: %v", err)
	}
	if err := f.play.FinishEvent(f.ctx, "lbr", f.admin); err != nil {
		t.Fatal(err)
	}
	if err := f.play.FinishEvent(f.ctx, "lbr", f.admin); !errors.Is(err, events.ErrConflict) {
		t.Fatalf("finishing twice: %v", err)
	}

	// Nothing can change any more.
	frozen := f.view(f.alice)
	if frozen.CanAct || frozen.Turn.Waiting != "Ивент завершён" || frozen.Points != 17+game.DefaultRecordPoints {
		t.Fatalf("frozen view = canAct %v, waiting %q, points %d", frozen.CanAct, frozen.Turn.Waiting, frozen.Points)
	}
	if _, err := f.play.Spin(f.ctx, "lbr", f.alice, frozen.Turn.Current.ID); !errors.Is(err, events.ErrConflict) {
		t.Fatalf("spinning in a finished event: %v", err)
	}
	if err := f.play.UndoStep(f.ctx, "lbr", f.admin, f.alice.ID); !errors.Is(err, events.ErrConflict) {
		t.Fatalf("undo in a finished event: %v", err)
	}

	// Even if the data underneath changes, the standings stay as they were.
	if _, err := f.st.Pool.Exec(f.ctx, "UPDATE games SET hltb_hours = 100"); err != nil {
		t.Fatal(err)
	}
	board, err := f.play.Leaderboard(f.ctx, "lbr", nil)
	if err != nil || board[0].Points != 17+game.DefaultRecordPoints {
		t.Fatalf("frozen leaderboard = %+v, %v", board, err)
	}
	if v := f.view(f.alice); v.Points != 17+game.DefaultRecordPoints {
		t.Fatalf("frozen points = %d", v.Points)
	}
	if q, _ := f.play.Queue(f.ctx, "lbr", f.admin); len(q) != 0 {
		t.Fatalf("queue of a finished event = %+v", q)
	}
	acts, _ := f.play.Activity(f.ctx, "lbr", 1)
	if acts[0].Kind != "finish_event" || acts[0].Message != "Судья Судья завершает ивент: победитель — Алиса (22)" {
		t.Fatalf("journal = %+v", acts[0])
	}
}

func TestRulesVersionAndExport(t *testing.T) {
	f := newFixture(t)
	d, _ := f.events.Get(f.ctx, "lbr", f.admin)
	s := d.Settings
	s.WebhookURL = "https://discord.com/api/webhooks/1/secret"
	if _, err := f.events.Update(f.ctx, f.admin, "lbr", api.UpdateEventRequest{Settings: &s}); err != nil {
		t.Fatal(err)
	}

	// The event was created with the current rules: nothing to note.
	cat, _ := items.NewCatalog()
	if err := f.play.MarkRulesVersion(f.ctx, cat.Fingerprint()); err != nil {
		t.Fatal(err)
	}
	if acts, _ := f.play.Activity(f.ctx, "lbr", 10); len(acts) != 0 {
		t.Fatalf("journal = %+v", acts)
	}
	// New rules: the journal says so, once.
	for range 2 {
		if err := f.play.MarkRulesVersion(f.ctx, "new-version"); err != nil {
			t.Fatal(err)
		}
	}
	acts, _ := f.play.Activity(f.ctx, "lbr", 10)
	if len(acts) != 1 || acts[0].Kind != "rules" {
		t.Fatalf("journal = %+v", acts)
	}

	if _, err := f.play.Export(f.ctx, "lbr", f.alice); !errors.Is(err, events.ErrForbidden) {
		t.Fatalf("a player exported: %v", err)
	}
	b, err := f.play.Export(f.ctx, "lbr", f.admin)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	if doc["event"].(map[string]any)["slug"] != "lbr" || len(doc["members"].([]any)) != 3 {
		t.Fatalf("export = %s", b[:200])
	}
	if strings.Contains(string(b), "secret") {
		t.Fatal("the webhook leaked into the export")
	}
}

func TestPlayTimeAndReview(t *testing.T) {
	f := newFixture(t)
	f.addGame(f.alice, "G1", 10, 80, 2015)
	f.addGame(f.alice, "G2", 10, 80, 2015)
	hour := int64(time.Hour / time.Millisecond)
	update := func(u *auth.User, req api.PlayTimeRequest) (api.PlayTime, error) {
		return f.play.UpdatePlayTime(f.ctx, "lbr", u, f.alice.ID, req)
	}
	get := func(u *auth.User) api.PlayTime {
		t.Helper()
		v, err := f.play.PlayTime(f.ctx, "lbr", u, f.alice.ID)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	set := func(ms int64) api.PlayTimeRequest { return api.PlayTimeRequest{SetMs: &ms} }

	// No game yet: nothing to save.
	if _, err := update(f.alice, api.PlayTimeRequest{AddMs: hour}); !errors.Is(err, events.ErrConflict) {
		t.Fatalf("time before the game: %v", err)
	}
	for range 3 {
		f.spin(f.alice, "reflex")
	}
	f.spin(f.alice, "G1")

	// Sessions add up.
	if v, err := update(f.alice, api.PlayTimeRequest{AddMs: hour}); err != nil || v.TotalMs != hour {
		t.Fatalf("first session = %+v, %v", v, err)
	}
	if v, err := update(f.alice, api.PlayTimeRequest{AddMs: hour / 2}); err != nil || v.TotalMs != hour+hour/2 {
		t.Fatalf("second session = %+v, %v", v, err)
	}
	if _, err := update(f.alice, api.PlayTimeRequest{AddMs: 500}); err == nil {
		t.Fatal("a session shorter than a second was saved")
	}
	if _, err := update(f.alice, set(-1)); err == nil {
		t.Fatal("negative time was saved")
	}
	if _, err := update(f.bob, api.PlayTimeRequest{AddMs: hour}); !errors.Is(err, events.ErrForbidden) {
		t.Fatalf("bob changed alice's time: %v", err)
	}
	if v := get(f.bob); v.TotalMs != hour+hour/2 || v.CanEdit {
		t.Fatalf("bob sees %+v", v)
	}
	// The player and a judge may correct the total.
	if v, err := update(f.alice, set(3*hour)); err != nil || v.TotalMs != 3*hour || !get(f.alice).CanEdit {
		t.Fatalf("set = %+v, %v", v, err)
	}
	if v, err := update(f.admin, set(2*hour)); err != nil || v.TotalMs != 2*hour {
		t.Fatalf("judge set = %+v, %v", v, err)
	}

	// The review goes with the outcome.
	step := f.view(f.alice).Turn.Current.ID
	if _, err := f.play.Finish(f.ctx, "lbr", f.alice, step, api.FinishRequest{Outcome: "completed", Hours: 2, Review: strings.Repeat("я", 2001)}); err == nil {
		t.Fatal("a too long review was accepted")
	}
	if _, err := f.play.Finish(f.ctx, "lbr", f.alice, step, api.FinishRequest{Outcome: "completed", Hours: 2, Review: " Отличная игра "}); err != nil {
		t.Fatal(err)
	}
	pt := f.view(f.alice).Turn.Playthrough
	if pt.Review != "Отличная игра" {
		t.Fatalf("review = %q", pt.Review)
	}
	// The judge sees the saved time next to the hours; the player cannot change it any more.
	q, err := f.play.Queue(f.ctx, "lbr", f.admin)
	if err != nil || len(q) == 0 || q[0].Playthrough == nil || q[0].Playthrough.TimerMs != 2*hour {
		t.Fatalf("queue = %+v, %v", q, err)
	}
	if _, err := update(f.alice, api.PlayTimeRequest{AddMs: hour}); !errors.Is(err, events.ErrConflict) {
		t.Fatalf("time changed after sending: %v", err)
	}
	if err := f.play.ConfirmGame(f.ctx, "lbr", f.admin, pt.ID, true); err != nil {
		t.Fatal(err)
	}
	acts, _ := f.play.Activity(f.ctx, "lbr", 10)
	found := false
	for _, a := range acts {
		found = found || a.Message == "Алиса прошёл «G1» за 2 ч"
	}
	if !found {
		t.Errorf("journal has no «за 2 ч»: %+v", acts)
	}

	// The next game starts from zero.
	f.spin(f.alice, "reflex")
	f.spin(f.alice, "G2")
	if v := get(f.alice); v.TotalMs != 0 || v.Playthrough == pt.ID || v.Playthrough == 0 {
		t.Fatalf("time on the next game = %+v", v)
	}
}

func TestJudgeQueueWaitsForThePlayersPart(t *testing.T) {
	f := newFixture(t)
	// Add «100 к 1» to the wheel: the player enters the opponent and the result.
	ev, err := f.events.Get(f.ctx, "lbr", f.admin)
	if err != nil {
		t.Fatal(err)
	}
	s := ev.Settings
	s.Disabled = slices.DeleteFunc(slices.Clone(s.Disabled), func(id string) bool { return id == "sto_k_odnomu" })
	if _, err := f.events.Update(f.ctx, f.admin, "lbr", api.UpdateEventRequest{Settings: &s}); err != nil {
		t.Fatal(err)
	}
	f.addGame(f.alice, "G1", 10, 80, 2015)
	f.spin(f.alice, "100 к 1")
	f.spin(f.alice, "reflex")
	f.spin(f.alice, "reflex")
	f.spin(f.alice, "G1")

	items := func() int {
		q, err := f.play.Queue(f.ctx, "lbr", f.admin)
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, e := range q {
			if e.Kind == "item" {
				n++
			}
		}
		return n
	}
	if n := items(); n != 0 {
		t.Fatalf("an empty «100 к 1» waits for the judge: %d items", n)
	}
	duel := f.view(f.alice).Turn.Items[0]
	if err := f.play.Input(f.ctx, "lbr", f.alice, duel.ID, map[string]any{"opponent": float64(f.bob.ID), "won": true}); err != nil {
		t.Fatal(err)
	}
	if n := items(); n != 1 {
		t.Fatalf("a filled «100 к 1» is not in the queue: %d items", n)
	}
}
