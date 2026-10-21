package auth

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/config"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/storetest"
)

func TestDiscordUserNameAndAvatar(t *testing.T) {
	u := discordUser{ID: "42", Username: "bomj", Avatar: "abc"}
	if u.displayName() != "bomj" {
		t.Errorf("displayName = %q, want username", u.displayName())
	}
	u.GlobalName = "Бомж"
	if u.displayName() != "Бомж" {
		t.Errorf("displayName = %q, want global name", u.displayName())
	}
	if got := u.avatarURL(); got != "https://cdn.discordapp.com/avatars/42/abc.png?size=128" {
		t.Errorf("avatarURL = %q", got)
	}
	if (discordUser{ID: "42"}).avatarURL() != "" {
		t.Error("no avatar should give empty URL")
	}
}

// fakeDiscord serves the token and /users/@me endpoints.
func fakeDiscord(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil || r.Form.Get("code") != "good-code" {
			http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"access_token":"tok","token_type":"Bearer","expires_in":3600}`)
	})
	mux.HandleFunc("GET /api/users/@me", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `{"id":"1001","username":"bomj","global_name":"Главный бомж","avatar":"hash"}`)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestDiscordLoginFlow(t *testing.T) {
	st := storetest.New(t)
	discord := fakeDiscord(t)
	cfg := config.Config{
		BaseURL:             "http://mbr.test",
		SessionTTL:          time.Hour,
		DiscordClientID:     "client",
		DiscordClientSecret: "secret",
		AdminDiscordIDs:     map[string]bool{"1001": true},
	}
	s := New(st, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	s.oauth.Endpoint.TokenURL = discord.URL + "/api/oauth2/token"
	s.discordAPI = discord.URL + "/api"

	// 1. Start: redirect to Discord with a state that is also set as a cookie.
	rec := httptest.NewRecorder()
	s.StartDiscordLogin(rec, httptest.NewRequest(http.MethodGet, "/auth/discord/login?next="+url.QueryEscape("/e/lbr?invite=abc"), nil))
	if rec.Code != http.StatusFound {
		t.Fatalf("start: status %d", rec.Code)
	}
	loc, _ := url.Parse(rec.Header().Get("Location"))
	state := loc.Query().Get("state")
	if state == "" || loc.Query().Get("redirect_uri") != "http://mbr.test/auth/discord/callback" {
		t.Fatalf("start: bad redirect %s", loc)
	}
	stateCookie := findCookie(rec.Result().Cookies(), stateCookie)
	if stateCookie == nil || stateCookie.Value != state {
		t.Fatal("start: state cookie missing or different")
	}
	nextCookie := findCookie(rec.Result().Cookies(), nextCookie)
	if nextCookie == nil {
		t.Fatal("start: the page to return to is not kept")
	}
	// Another site is never a place to return to.
	rec2 := httptest.NewRecorder()
	s.StartDiscordLogin(rec2, httptest.NewRequest(http.MethodGet, "/auth/discord/login?next=//evil.example", nil))
	if c := findCookie(rec2.Result().Cookies(), "mbr_login_next"); c != nil {
		t.Fatalf("start: kept an outside next %q", c.Value)
	}

	// 2. Wrong state is rejected.
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/auth/discord/callback?code=good-code&state=other", nil)
	req.AddCookie(stateCookie)
	s.FinishDiscordLogin(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("wrong state: status %d, want 400", rec.Code)
	}

	// 3. Correct state: session cookie, back to the page the user came from, user saved.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/auth/discord/callback?code=good-code&state="+state, nil)
	req.AddCookie(stateCookie)
	req.AddCookie(nextCookie)
	s.FinishDiscordLogin(rec, req)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/e/lbr?invite=abc" {
		t.Fatalf("callback: %d → %q", rec.Code, rec.Header().Get("Location"))
	}
	session := findCookie(rec.Result().Cookies(), sessionCookie)
	if session == nil || session.Value == "" {
		t.Fatal("callback: no session cookie")
	}

	// 4. Middleware resolves the session to the Discord user.
	var got *User
	h := s.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = UserFrom(r.Context()) }))
	req = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(session)
	h.ServeHTTP(httptest.NewRecorder(), req)
	if got == nil || got.Name != "Главный бомж" || got.DiscordID != "1001" || !got.IsAdmin ||
		!strings.Contains(got.AvatarURL, "/avatars/1001/hash.png") {
		t.Fatalf("session user = %+v", got)
	}

	// 5. Bad code goes back to the login page with an error.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/auth/discord/callback?code=bad&state="+state, nil)
	req.AddCookie(stateCookie)
	s.FinishDiscordLogin(rec, req)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/login?error=discord" {
		t.Fatalf("bad code: %d → %q", rec.Code, rec.Header().Get("Location"))
	}
}

func TestExpiredSessionIsIgnored(t *testing.T) {
	st := storetest.New(t)
	cfg := config.Config{SessionTTL: time.Hour, DevLogin: true}
	s := New(st, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))

	rec := httptest.NewRecorder()
	if _, err := s.DevLogin(t.Context(), rec, "bob"); err != nil {
		t.Fatal(err)
	}
	session := findCookie(rec.Result().Cookies(), sessionCookie)

	// Push the session into the past.
	if _, err := st.Pool.Exec(t.Context(), "UPDATE sessions SET expires_at = now() - interval '1 minute'"); err != nil {
		t.Fatal(err)
	}

	var got *User
	h := s.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = UserFrom(r.Context()) }))
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(session)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got != nil {
		t.Fatalf("expired session resolved to %+v", got)
	}
	if c := findCookie(rec.Result().Cookies(), sessionCookie); c == nil || c.MaxAge >= 0 {
		t.Error("expired session cookie should be cleared")
	}

	if n, err := s.CleanupExpired(t.Context()); err != nil || n != 1 {
		t.Errorf("CleanupExpired = %d, %v; want 1", n, err)
	}
}

func findCookie(cs []*http.Cookie, name string) *http.Cookie {
	for _, c := range cs {
		if c.Name == name {
			return c
		}
	}
	return nil
}
