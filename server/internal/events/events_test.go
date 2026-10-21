package events

import (
	"context"
	"errors"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game/items"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/storetest"
)

type fixture struct {
	t                 *testing.T
	svc               *Service
	admin, alice, bob *auth.User
	ctx               context.Context
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	st := storetest.New(t)
	cat, err := items.NewCatalog()
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, svc: New(st, cat), ctx: context.Background()}
	user := func(name string, admin bool) *auth.User {
		u, err := st.UpsertUserByDiscordID(f.ctx, db.UpsertUserByDiscordIDParams{DiscordID: "dev:" + name, Name: name})
		if err != nil {
			t.Fatal(err)
		}
		return &auth.User{ID: u.ID, Name: u.Name, IsAdmin: admin}
	}
	f.admin, f.alice, f.bob = user("admin", true), user("alice", false), user("bob", false)
	return f
}

func (f *fixture) create(slug string) api.EventDetail {
	f.t.Helper()
	d, err := f.svc.Create(f.ctx, f.admin, api.CreateEventRequest{Title: "ЛБР " + slug, Slug: slug})
	if err != nil {
		f.t.Fatal(err)
	}
	return d
}

func (f *fixture) join(u *auth.User, slug string) {
	f.t.Helper()
	if _, err := f.svc.Join(f.ctx, u, slug, ""); err != nil {
		f.t.Fatal(err)
	}
}

func expect(t *testing.T, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
}

func expectInvalid(t *testing.T, err error) {
	t.Helper()
	var ie *InvalidError
	if !errors.As(err, &ie) {
		t.Fatalf("err = %v, want a validation error", err)
	}
}

func TestCreateEvent(t *testing.T) {
	f := newFixture(t)

	_, err := f.svc.Create(f.ctx, f.alice, api.CreateEventRequest{Title: "x", Slug: "lbr-1"})
	expect(t, err, ErrForbidden)
	_, err = f.svc.Create(f.ctx, nil, api.CreateEventRequest{Title: "x", Slug: "lbr-1"})
	expect(t, err, ErrUnauthenticated)
	for _, slug := range []string{"ab", "-lbr", "lbr-", "ЛБР", "lbr_1", "a/b"} {
		_, err := f.svc.Create(f.ctx, f.admin, api.CreateEventRequest{Title: "x", Slug: slug})
		expectInvalid(t, err)
	}

	d := f.create("lbr-1")
	if d.Me == nil || !d.Me.IsJudge || d.Me.IsParticipant {
		t.Fatalf("creator should be the judge only: %+v", d.Me)
	}
	if d.Settings.StartSpins != 3 || d.Status != StatusActive {
		t.Fatalf("defaults: %+v", d)
	}
	_, err = f.svc.Create(f.ctx, f.admin, api.CreateEventRequest{Title: "dup", Slug: "LBR-1"})
	expect(t, err, ErrConflict)

	list, err := f.svc.List(f.ctx, f.alice)
	if err != nil || len(list) != 1 || list[0].IsJudge || list[0].Slug != "lbr-1" {
		t.Fatalf("list for alice = %+v, %v", list, err)
	}
}

func TestJoinAndRoles(t *testing.T) {
	f := newFixture(t)
	f.create("lbr")
	f.join(f.alice, "lbr")
	f.join(f.alice, "lbr") // joining twice is fine

	d, err := f.svc.Get(f.ctx, "lbr", f.alice)
	if err != nil || d.Me == nil || !d.Me.IsParticipant || len(d.Members) != 2 {
		t.Fatalf("after join: %+v %v", d, err)
	}

	tr, fl := true, false
	_, err = f.svc.UpdateMember(f.ctx, f.alice, "lbr", f.alice.ID, api.UpdateMemberRequest{IsJudge: &tr})
	expect(t, err, ErrForbidden) // only judges manage roles

	// The admin is the only judge and cannot step down…
	_, err = f.svc.UpdateMember(f.ctx, f.admin, "lbr", f.admin.ID, api.UpdateMemberRequest{IsJudge: &fl})
	expect(t, err, ErrConflict)
	// …until Alice is a judge too. The admin may also play.
	if _, err := f.svc.UpdateMember(f.ctx, f.admin, "lbr", f.alice.ID, api.UpdateMemberRequest{IsJudge: &tr}); err != nil {
		t.Fatal(err)
	}
	d, err = f.svc.UpdateMember(f.ctx, f.admin, "lbr", f.admin.ID, api.UpdateMemberRequest{IsParticipant: &tr, IsJudge: &fl})
	if err != nil || !d.Me.IsParticipant || d.Me.IsJudge {
		t.Fatalf("admin roles = %+v, %v", d.Me, err)
	}

	// A member without roles stays in the list as a visitor.
	f.join(f.bob, "lbr")
	d, err = f.svc.UpdateMember(f.ctx, f.alice, "lbr", f.bob.ID, api.UpdateMemberRequest{IsParticipant: &fl, IsJudge: &fl})
	if err != nil || len(d.Members) != 3 {
		t.Fatalf("after taking bob's roles: %d members, %v", len(d.Members), err)
	}
	for _, m := range d.Members {
		if m.UserID == f.bob.ID && (m.IsParticipant || m.IsJudge) {
			t.Fatalf("bob still has roles: %+v", m)
		}
	}
	if d, err = f.svc.Get(f.ctx, "lbr", f.bob); err != nil || d.Me != nil {
		t.Fatalf("bob without roles: me = %+v, %v", d.Me, err)
	}
	if _, err := f.svc.AddGame(f.ctx, f.bob, "lbr", api.GameInput{Title: "Portal", HLTBHours: 3, Rating: 90, Year: 2007}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("bob without roles adds a game: %v", err)
	}
	// Joining again makes him a participant.
	if d, err = f.svc.Join(f.ctx, f.bob, "lbr", ""); err != nil || d.Me == nil || !d.Me.IsParticipant {
		t.Fatalf("bob after rejoin: %+v, %v", d.Me, err)
	}

	// «Убрать» removes the member.
	d, err = f.svc.RemoveMember(f.ctx, f.alice, "lbr", f.bob.ID)
	if err != nil || len(d.Members) != 2 {
		t.Fatalf("after removing bob: %d members, %v", len(d.Members), err)
	}
	// Alice is now the only judge and cannot be removed either.
	_, err = f.svc.RemoveMember(f.ctx, f.alice, "lbr", f.alice.ID)
	expect(t, err, ErrConflict)
	_, err = f.svc.RemoveMember(f.ctx, f.alice, "lbr", 999999)
	expect(t, err, ErrNotFound)
}

func TestSettings(t *testing.T) {
	f := newFixture(t)
	f.create("lbr")
	f.join(f.alice, "lbr")

	three, tooMany := 3, 101
	good := api.EventSettings{
		StartSpins:   4,
		SpinsByHours: []api.SpinsRow{{MinHours: 0, Spins: 1}, {MinHours: 20, Spins: 2}},
		Weights:      map[string]int{"opaaa": 5, "reflex": 1}, // reflex = default, not stored
		Disabled:     []string{"smuta", "smuta"},
		Params:       map[string]map[string]int{"opaaa": {"points": 6}, "minus3": {"points": -3}}, // -3 is the default
		WebhookURL:   "https://discord.com/api/webhooks/1/x",

		GameWheelSeconds: 60,
		ItemWheelSeconds: 30,
		RecordPoints:     &three,
		Icons:            map[string]string{"opaaa": "https://img/opaaa.png", "reflex": " "},
	}
	_, err := f.svc.Update(f.ctx, f.alice, "lbr", api.UpdateEventRequest{Settings: &good})
	expect(t, err, ErrForbidden)

	d, err := f.svc.Update(f.ctx, f.admin, "lbr", api.UpdateEventRequest{Settings: &good})
	if err != nil {
		t.Fatal(err)
	}
	if d.Settings.StartSpins != 4 || len(d.Settings.Weights) != 1 || len(d.Settings.Disabled) != 1 || d.Settings.WebhookURL == "" ||
		len(d.Settings.Params) != 1 || d.Settings.Params["opaaa"]["points"] != 6 ||
		d.Settings.GameWheelSeconds != 60 || d.Settings.ItemWheelSeconds != 30 || d.Settings.RecordPoints == nil || *d.Settings.RecordPoints != 3 ||
		len(d.Settings.Icons) != 1 || d.Settings.Icons["opaaa"] != "https://img/opaaa.png" {
		t.Fatalf("settings = %+v", d.Settings)
	}

	// The webhook is a secret: participants do not see it.
	if d, _ := f.svc.Get(f.ctx, "lbr", f.alice); d.Settings.WebhookURL != "" {
		t.Fatal("webhook leaked to a participant")
	}

	bad := []api.EventSettings{
		{StartSpins: 0},
		{StartSpins: 3, SpinsByHours: []api.SpinsRow{{MinHours: 10, Spins: 1}, {MinHours: 5, Spins: 2}}},
		{StartSpins: 3, Weights: map[string]int{"nope": 1}},
		{StartSpins: 3, Weights: map[string]int{"opaaa": -1}},
		{StartSpins: 3, Disabled: []string{"nope"}},
		{StartSpins: 3, WebhookURL: "http://insecure"},
		{StartSpins: 3, Params: map[string]map[string]int{"opaaa": {"points": 1000}}},
		{StartSpins: 3, Params: map[string]map[string]int{"opaaa": {"nope": 1}}},
		{StartSpins: 3, GameWheelSeconds: -1},
		{StartSpins: 3, ItemWheelSeconds: 121},
		{StartSpins: 3, RecordPoints: &tooMany},
		{StartSpins: 3, Icons: map[string]string{"nope": "https://img/x.png"}},
		{StartSpins: 3, Icons: map[string]string{"opaaa": "http://img/x.png"}},
		{StartSpins: 3, Params: map[string]map[string]int{"nope": {"points": 1}}},
	}
	for _, s := range bad {
		_, err := f.svc.Update(f.ctx, f.admin, "lbr", api.UpdateEventRequest{Settings: &s})
		expectInvalid(t, err)
	}

	items, err := f.svc.Items(f.ctx, "lbr")
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range items {
		switch it.ID {
		case "opaaa":
			if it.Weight != 5 || it.DefaultWeight != 1 || !it.Enabled || len(it.Params) != 1 || it.Params[0].Value != 6 || it.Params[0].Default != 4 {
				t.Errorf("opaaa = %+v", it)
			}
		case "smuta":
			if it.Enabled || len(it.SpecialGames) != 1 {
				t.Errorf("smuta = %+v", it)
			}
		}
	}
}

func TestGames(t *testing.T) {
	f := newFixture(t)
	f.create("lbr")

	in := api.GameInput{Title: "GTA San Andreas", HLTBHours: 30, Rating: 87, Year: 2004}
	_, err := f.svc.AddGame(f.ctx, f.alice, "lbr", in)
	expect(t, err, ErrForbidden) // not a member yet

	f.join(f.alice, "lbr")
	f.join(f.bob, "lbr")
	g, err := f.svc.AddGame(f.ctx, f.alice, "lbr", in)
	if err != nil {
		t.Fatal(err)
	}
	if g.BasePoints != 39 || g.AddedByName != "alice" {
		t.Fatalf("game = %+v", g)
	}

	for _, bad := range []api.GameInput{
		{Title: " ", HLTBHours: 1, Rating: 50, Year: 2000},
		{Title: "x", HLTBHours: -1, Rating: 50, Year: 2000},
		{Title: "x", HLTBHours: 1, Rating: 101, Year: 2000},
		{Title: "x", HLTBHours: 1, Rating: 50, Year: 1800},
	} {
		_, err := f.svc.AddGame(f.ctx, f.alice, "lbr", bad)
		expectInvalid(t, err)
	}

	// Only judges mark special games.
	_, err = f.svc.AddGame(f.ctx, f.alice, "lbr", api.GameInput{Title: "Смута", HLTBHours: 12, Rating: 40, Year: 2024, SpecialKey: "smuta"})
	expect(t, err, ErrForbidden)
	_, err = f.svc.AddGame(f.ctx, f.admin, "lbr", api.GameInput{Title: "?", HLTBHours: 1, Rating: 1, Year: 2000, SpecialKey: "nope"})
	expectInvalid(t, err)
	smuta, err := f.svc.AddGame(f.ctx, f.admin, "lbr", api.GameInput{Title: "Смута", HLTBHours: 12, Rating: 40, Year: 2024, SpecialKey: "smuta"})
	if err != nil || smuta.SpecialKey != "smuta" {
		t.Fatalf("special game: %+v %v", smuta, err)
	}
	_, err = f.svc.AddGame(f.ctx, f.admin, "lbr", api.GameInput{Title: "Смута 2", HLTBHours: 1, Rating: 1, Year: 2024, SpecialKey: "smuta"})
	expect(t, err, ErrConflict)

	// The author or a judge may edit; others may not.
	in.HLTBHours = 31
	_, err = f.svc.UpdateGame(f.ctx, f.bob, "lbr", g.ID, in)
	expect(t, err, ErrForbidden)
	if g, err = f.svc.UpdateGame(f.ctx, f.alice, "lbr", g.ID, in); err != nil || g.HLTBHours != 31 {
		t.Fatalf("author edit: %+v %v", g, err)
	}
	if _, err := f.svc.UpdateGame(f.ctx, f.admin, "lbr", g.ID, in); err != nil {
		t.Fatalf("judge edit: %v", err)
	}
	// Alice did not add the special game, so she cannot edit it.
	_, err = f.svc.UpdateGame(f.ctx, f.alice, "lbr", smuta.ID, api.GameInput{Title: "Смута", HLTBHours: 12, Rating: 40, Year: 2024})
	expect(t, err, ErrForbidden)

	list, err := f.svc.Games(f.ctx, "lbr")
	if err != nil || len(list) != 2 {
		t.Fatalf("games = %+v, %v", list, err)
	}

	expect(t, f.svc.DeleteGame(f.ctx, f.bob, "lbr", g.ID), ErrForbidden)
	if err := f.svc.DeleteGame(f.ctx, f.alice, "lbr", g.ID); err != nil {
		t.Fatal(err)
	}
	expect(t, f.svc.DeleteGame(f.ctx, f.alice, "lbr", g.ID), ErrNotFound)
}

func TestMovies(t *testing.T) {
	f := newFixture(t)
	f.create("lbr")
	f.join(f.alice, "lbr")
	f.join(f.bob, "lbr")

	m, err := f.svc.AddMovie(f.ctx, f.alice, "lbr", api.MovieInput{Title: "Шрек"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.AddMovie(f.ctx, f.alice, "lbr", api.MovieInput{Title: ""})
	expectInvalid(t, err)
	_, err = f.svc.UpdateMovie(f.ctx, f.bob, "lbr", m.ID, api.MovieInput{Title: "Шрек 2"})
	expect(t, err, ErrForbidden)
	if m, err = f.svc.UpdateMovie(f.ctx, f.admin, "lbr", m.ID, api.MovieInput{Title: "Шрек 2"}); err != nil || m.Title != "Шрек 2" || m.AddedByName != "alice" {
		t.Fatalf("judge edit: %+v %v", m, err)
	}
	list, _ := f.svc.Movies(f.ctx, "lbr")
	if len(list) != 1 {
		t.Fatalf("movies = %+v", list)
	}
	if err := f.svc.DeleteMovie(f.ctx, f.alice, "lbr", m.ID); err != nil {
		t.Fatal(err)
	}
}

func TestUnknownEvent(t *testing.T) {
	f := newFixture(t)
	_, err := f.svc.Get(f.ctx, "nope", nil)
	expect(t, err, ErrNotFound)
	_, err = f.svc.Games(f.ctx, "nope")
	expect(t, err, ErrNotFound)
}

func TestGameLimitAndCovers(t *testing.T) {
	f := newFixture(t)
	f.create("lbr")
	f.join(f.alice, "lbr")
	s := api.EventSettings{StartSpins: 3, MaxGamesPerMember: 1}
	if _, err := f.svc.Update(f.ctx, f.admin, "lbr", api.UpdateEventRequest{Settings: &s}); err != nil {
		t.Fatal(err)
	}

	game := func(title, cover string) api.GameInput {
		return api.GameInput{Title: title, HLTBHours: 10, Rating: 80, Year: 2015, CoverURL: cover}
	}
	_, err := f.svc.AddGame(f.ctx, f.alice, "lbr", game("G1", "http://insecure/x.png"))
	expectInvalid(t, err)
	g, err := f.svc.AddGame(f.ctx, f.alice, "lbr", game("G1", " https://img/x.png "))
	if err != nil || g.CoverURL != "https://img/x.png" {
		t.Fatalf("cover = %q, %v", g.CoverURL, err)
	}
	_, err = f.svc.AddGame(f.ctx, f.alice, "lbr", game("G2", ""))
	expect(t, err, ErrConflict) // the limit is 1
	// Judges are not limited.
	for _, title := range []string{"J1", "J2"} {
		if _, err := f.svc.AddGame(f.ctx, f.admin, "lbr", game(title, "")); err != nil {
			t.Fatal(err)
		}
	}
	// A judge fills in the cover.
	if g, err = f.svc.UpdateGame(f.ctx, f.admin, "lbr", g.ID, game("G1", "https://img/y.png")); err != nil || g.CoverURL != "https://img/y.png" {
		t.Fatalf("judge cover = %q, %v", g.CoverURL, err)
	}
	list, _ := f.svc.Games(f.ctx, "lbr")
	if list[0].CoverURL != "https://img/y.png" {
		t.Fatalf("list = %+v", list)
	}
}

func TestInviteOnly(t *testing.T) {
	f := newFixture(t)
	f.create("lbr")
	f.join(f.alice, "lbr")
	s := api.EventSettings{StartSpins: 3, InviteOnly: true, InviteCode: "chosen-by-client"}
	d, err := f.svc.Update(f.ctx, f.admin, "lbr", api.UpdateEventRequest{Settings: &s})
	if err != nil {
		t.Fatal(err)
	}
	code := d.Settings.InviteCode
	if code == "" || code == "chosen-by-client" {
		t.Fatalf("invite code = %q, want one made by the server", code)
	}
	// Only judges see it.
	if d, _ := f.svc.Get(f.ctx, "lbr", f.alice); d.Settings.InviteCode != "" {
		t.Fatal("invite code leaked to a participant")
	}

	_, err = f.svc.Join(f.ctx, f.bob, "lbr", "")
	expect(t, err, ErrForbidden)
	_, err = f.svc.Join(f.ctx, f.bob, "lbr", "wrong")
	expect(t, err, ErrForbidden)
	if _, err := f.svc.Join(f.ctx, f.bob, "lbr", code); err != nil {
		t.Fatal(err)
	}
	// Members come back without the code.
	if _, err := f.svc.Join(f.ctx, f.alice, "lbr", ""); err != nil {
		t.Fatal(err)
	}

	// Saving the settings keeps the code; a new invite replaces it.
	if d, _ = f.svc.Update(f.ctx, f.admin, "lbr", api.UpdateEventRequest{Settings: &s}); d.Settings.InviteCode != code {
		t.Fatalf("code changed on save: %q", d.Settings.InviteCode)
	}
	_, err = f.svc.NewInvite(f.ctx, f.alice, "lbr")
	expect(t, err, ErrForbidden)
	d, err = f.svc.NewInvite(f.ctx, f.admin, "lbr")
	if err != nil || d.Settings.InviteCode == code || d.Settings.InviteCode == "" {
		t.Fatalf("new invite = %q, %v", d.Settings.InviteCode, err)
	}
}
