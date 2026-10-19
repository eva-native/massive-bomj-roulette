package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
)

type client struct {
	t    *testing.T
	base string
	http *http.Client
}

func newClient(t *testing.T, base, name string) *client {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	c := &client{t: t, base: base, http: &http.Client{Jar: jar}}
	if name != "" {
		c.do(http.MethodPost, "/auth/dev/login", map[string]string{"name": name}, http.StatusOK, nil)
	}
	return c
}

// do sends a JSON request, checks the status and decodes the body into out.
func (c *client) do(method, path string, body any, wantStatus int, out any) string {
	c.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, r)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		c.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, wantStatus, raw)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			c.t.Fatalf("%s %s: decode: %v", method, path, err)
		}
	}
	return string(raw)
}

func TestEventsAPI(t *testing.T) {
	srv, _ := newTestServer(t)
	admin := newClient(t, srv.URL, "Alice") // dev:alice is an admin in newTestServer
	bob := newClient(t, srv.URL, "Bob")
	anon := newClient(t, srv.URL, "")

	anon.do("POST", "/api/events", api.CreateEventRequest{Title: "ЛБР", Slug: "lbr"}, http.StatusUnauthorized, nil)
	bob.do("POST", "/api/events", api.CreateEventRequest{Title: "ЛБР", Slug: "lbr"}, http.StatusForbidden, nil)
	admin.do("POST", "/api/events", api.CreateEventRequest{Title: "ЛБР", Slug: "bad slug"}, http.StatusBadRequest, nil)

	var ev api.EventDetail
	admin.do("POST", "/api/events", api.CreateEventRequest{Title: "ЛБР", Slug: "lbr"}, http.StatusCreated, &ev)
	if ev.Me == nil || !ev.Me.IsJudge {
		t.Fatalf("creator = %+v", ev.Me)
	}
	if msg := admin.do("POST", "/api/events", api.CreateEventRequest{Title: "x", Slug: "lbr"}, http.StatusConflict, nil); !strings.Contains(msg, "занят") {
		t.Errorf("conflict message = %s", msg)
	}

	// Anyone can read; members are listed.
	var list []api.EventSummary
	anon.do("GET", "/api/events", nil, http.StatusOK, &list)
	if len(list) != 1 || list[0].Slug != "lbr" {
		t.Fatalf("list = %+v", list)
	}
	anon.do("GET", "/api/events/nope", nil, http.StatusNotFound, nil)

	bob.do("POST", "/api/events/lbr/games", api.GameInput{Title: "G", HLTBHours: 1, Rating: 50, Year: 2000}, http.StatusForbidden, nil)
	bob.do("POST", "/api/events/lbr/join", nil, http.StatusOK, &ev)
	var g api.Game
	bob.do("POST", "/api/events/lbr/games", api.GameInput{Title: "GTA San Andreas", HLTBHours: 30, Rating: 87, Year: 2004}, http.StatusCreated, &g)
	if g.BasePoints != 39 {
		t.Errorf("base points = %d", g.BasePoints)
	}
	bob.do("POST", "/api/events/lbr/movies", api.MovieInput{Title: "Шрек"}, http.StatusCreated, nil)

	var games []api.Game
	anon.do("GET", "/api/events/lbr/games", nil, http.StatusOK, &games)
	var movies []api.Movie
	anon.do("GET", "/api/events/lbr/movies", nil, http.StatusOK, &movies)
	if len(games) != 1 || len(movies) != 1 {
		t.Fatalf("pool = %d games, %d movies", len(games), len(movies))
	}

	// Settings and roles are for judges.
	settings := api.EventSettings{StartSpins: 5}
	bob.do("PATCH", "/api/events/lbr", api.UpdateEventRequest{Settings: &settings}, http.StatusForbidden, nil)
	admin.do("PATCH", "/api/events/lbr", api.UpdateEventRequest{Settings: &settings}, http.StatusOK, &ev)
	if ev.Settings.StartSpins != 5 {
		t.Fatalf("settings = %+v", ev.Settings)
	}
	var items []api.ItemDef
	anon.do("GET", "/api/events/lbr/items", nil, http.StatusOK, &items)
	if len(items) == 0 {
		t.Fatal("no items")
	}

	tr := true
	var bobID int64
	for _, m := range ev.Members {
		if m.Name == "Bob" {
			bobID = m.UserID
		}
	}
	admin.do("PATCH", "/api/events/lbr/members/"+itoa(bobID), api.UpdateMemberRequest{IsJudge: &tr}, http.StatusOK, &ev)
	admin.do("PATCH", "/api/events/lbr/members/abc", api.UpdateMemberRequest{IsJudge: &tr}, http.StatusNotFound, nil)

	// Bob is a judge now and may delete anything; the game goes away.
	bob.do("DELETE", "/api/events/lbr/games/"+itoa(g.ID), nil, http.StatusNoContent, nil)
	bob.do("DELETE", "/api/events/lbr/games/"+itoa(g.ID), nil, http.StatusNotFound, nil)
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
