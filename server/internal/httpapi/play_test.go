package httpapi

import (
	"bufio"
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

// firstPicker always stops the wheel on the first sector.
type firstPicker struct{}

func (firstPicker) Pick(game.WheelKind, []game.Sector) (int, error) { return 0, nil }

var testPicker game.Picker = firstPicker{}

func TestPlayAPIAndStream(t *testing.T) {
	srv, _ := newTestServer(t)
	judge := newClient(t, srv.URL, "Alice") // admin → creates the event and judges it
	bob := newClient(t, srv.URL, "Bob")

	var ev api.EventDetail
	judge.do("POST", "/api/events", api.CreateEventRequest{Title: "ЛБР", Slug: "lbr"}, http.StatusCreated, &ev)
	bob.do("POST", "/api/events/lbr/join", nil, http.StatusOK, &ev)
	bob.do("POST", "/api/events/lbr/games", api.GameInput{Title: "G", HLTBHours: 10, Rating: 80, Year: 2015}, http.StatusCreated, nil)
	var bobID int64
	for _, m := range ev.Members {
		if m.Name == "Bob" {
			bobID = m.UserID
		}
	}

	// Subscribe to the stream before acting.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/events/lbr/stream", nil)
	resp, err := http.DefaultClient.Do(req) //nolint:bodyclose // closed by the defer below
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("stream content type = %q", ct)
	}
	lines := make(chan string, 16)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()

	var v api.PlayerView
	bob.do("GET", "/api/events/lbr/players/"+itoa(bobID), nil, http.StatusOK, &v)
	if !v.CanAct || v.Turn.Current.Kind != "spin_items" {
		t.Fatalf("bob's turn = %+v", v.Turn)
	}
	anon := newClient(t, srv.URL, "")
	anon.do("POST", "/api/events/lbr/steps/"+itoa(v.Turn.Current.ID)+"/spin", nil, http.StatusUnauthorized, nil)
	judge.do("POST", "/api/events/lbr/steps/"+itoa(v.Turn.Current.ID)+"/spin", nil, http.StatusForbidden, nil)

	var res api.SpinResult
	bob.do("POST", "/api/events/lbr/steps/"+itoa(v.Turn.Current.ID)+"/spin", nil, http.StatusOK, &res)
	if res.Label == "" || res.View.Turn.Steps[0].Result != res.Label {
		t.Fatalf("spin = %+v", res)
	}
	// Spinning the same step again is a conflict.
	bob.do("POST", "/api/events/lbr/steps/"+itoa(v.Turn.Current.ID)+"/spin", nil, http.StatusConflict, nil)

	waitFor(t, lines, "event: change")

	var acts []api.ActivityEntry
	anon.do("GET", "/api/events/lbr/activity", nil, http.StatusOK, &acts)
	if len(acts) != 1 || !strings.Contains(acts[0].Message, "Bob крутит") {
		t.Fatalf("activity = %+v", acts)
	}
	var board []api.LeaderboardRow
	anon.do("GET", "/api/events/lbr/leaderboard", nil, http.StatusOK, &board)
	if len(board) != 1 || board[0].Player.Name != "Bob" {
		t.Fatalf("leaderboard = %+v", board)
	}
	bob.do("GET", "/api/events/lbr/queue", nil, http.StatusForbidden, nil)
	judge.do("GET", "/api/events/lbr/queue", nil, http.StatusOK, nil)
}

func waitFor(t *testing.T, lines <-chan string, want string) {
	t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case l, ok := <-lines:
			if !ok {
				t.Fatalf("stream closed before %q", want)
			}
			if l == want {
				return
			}
		case <-timeout:
			t.Fatalf("no %q on the stream", want)
		}
	}
}
