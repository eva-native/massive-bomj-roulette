package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/config"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/storetest"
)

func newTestServer(t *testing.T) (*httptest.Server, *http.Client) {
	t.Helper()
	st := storetest.New(t)
	cfg := config.Config{
		SessionTTL:      time.Hour,
		DevLogin:        true,
		AdminDiscordIDs: map[string]bool{"dev:alice": true},
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := httptest.NewServer(New(cfg, st, auth.New(st, cfg, log), log, fstest.MapFS{}).Handler())
	t.Cleanup(srv.Close)

	jar, _ := cookiejar.New(nil)
	return srv, &http.Client{Jar: jar}
}

func getMe(t *testing.T, c *http.Client, base string) (int, api.Me) {
	t.Helper()
	resp, err := c.Get(base + "/api/me")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var me api.Me
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
			t.Fatal(err)
		}
	}
	return resp.StatusCode, me
}

func TestDevLoginFlow(t *testing.T) {
	srv, c := newTestServer(t)

	if code, _ := getMe(t, c, srv.URL); code != http.StatusUnauthorized {
		t.Fatalf("before login: /api/me = %d, want 401", code)
	}

	resp, err := c.Post(srv.URL+"/auth/dev/login", "application/json", strings.NewReader(`{"name":"Alice"}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("dev login = %d, want 200", resp.StatusCode)
	}

	code, me := getMe(t, c, srv.URL)
	if code != http.StatusOK || me.Name != "Alice" || !me.IsAdmin {
		t.Fatalf("after login: %d %+v, want Alice (admin)", code, me)
	}

	// Same name logs in as the same user.
	resp, _ = c.Post(srv.URL+"/auth/dev/login", "application/json", strings.NewReader(`{"name":"alice"}`))
	resp.Body.Close()
	if _, again := getMe(t, c, srv.URL); again.ID != me.ID {
		t.Errorf("second login: user %d, want %d", again.ID, me.ID)
	}

	resp, err = c.Post(srv.URL+"/auth/logout", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout = %d, want 204", resp.StatusCode)
	}
	if code, _ := getMe(t, c, srv.URL); code != http.StatusUnauthorized {
		t.Fatalf("after logout: /api/me = %d, want 401", code)
	}
}

func TestDevLoginRejectsBadNames(t *testing.T) {
	srv, c := newTestServer(t)
	for _, body := range []string{`{"name":"  "}`, `{"name":"` + strings.Repeat("x", 33) + `"}`, `not json`, `{"name":"a","extra":1}`} {
		resp, err := c.Post(srv.URL+"/auth/dev/login", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("body %s: status %d, want 400", body, resp.StatusCode)
		}
	}
}

func TestUnknownAPIRouteIsJSON404(t *testing.T) {
	srv, c := newTestServer(t)
	resp, err := c.Get(srv.URL + "/api/nope")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound || !strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") {
		t.Errorf("got %d %s, want JSON 404", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
}
