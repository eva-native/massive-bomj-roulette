package auth

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/oauth2"

	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
)

const stateMaxAge = 10 * 60 // seconds

// StartDiscordLogin redirects to Discord with a fresh anti-CSRF state.
func (s *Service) StartDiscordLogin(w http.ResponseWriter, r *http.Request) {
	state, err := newToken()
	if err != nil {
		s.log.Error("auth: state", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	s.setCookie(w, stateCookie, state, "/auth", stateMaxAge)
	if next := r.URL.Query().Get("next"); safeNext(next) {
		s.setCookie(w, nextCookie, url.QueryEscape(next), "/auth", stateMaxAge)
	}
	http.Redirect(w, r, s.oauth.AuthCodeURL(state), http.StatusFound)
}

// safeNext accepts only paths of this site, never a full URL.
func safeNext(p string) bool {
	return len(p) <= 500 && strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "//") && !strings.HasPrefix(p, "/\\")
}

// loginNext is the page to return to after the login, from the cookie.
func loginNext(r *http.Request) string {
	if c, err := r.Cookie(nextCookie); err == nil {
		if next, err := url.QueryUnescape(c.Value); err == nil && safeNext(next) {
			return next
		}
	}
	return "/"
}

// FinishDiscordLogin handles Discord's redirect back: checks state, exchanges
// the code, loads the Discord profile, upserts the user and starts a session.
func (s *Service) FinishDiscordLogin(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(stateCookie)
	s.setCookie(w, stateCookie, "", "/auth", -1)
	got := r.URL.Query().Get("state")
	if err != nil || got == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(got)) != 1 {
		http.Error(w, "login expired, please try again", http.StatusBadRequest)
		return
	}
	if e := r.URL.Query().Get("error"); e != "" {
		http.Redirect(w, r, "/login?error=discord", http.StatusFound)
		return
	}

	ctx := context.WithValue(r.Context(), oauth2.HTTPClient, s.client)
	tok, err := s.oauth.Exchange(ctx, r.URL.Query().Get("code"))
	if err != nil {
		s.log.Warn("auth: discord exchange", "err", err)
		http.Redirect(w, r, "/login?error=discord", http.StatusFound)
		return
	}

	profile, err := s.fetchDiscordUser(ctx, tok)
	if err != nil {
		s.log.Error("auth: discord profile", "err", err)
		http.Redirect(w, r, "/login?error=discord", http.StatusFound)
		return
	}

	u, err := s.store.UpsertUserByDiscordID(r.Context(), db.UpsertUserByDiscordIDParams{
		DiscordID: profile.ID,
		Name:      profile.displayName(),
		AvatarURL: profile.avatarURL(),
	})
	if err == nil {
		err = s.startSession(r.Context(), w, u.ID)
	}
	if err != nil {
		s.log.Error("auth: discord login", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	s.setCookie(w, nextCookie, "", "/auth", -1)
	http.Redirect(w, r, loginNext(r), http.StatusFound)
}

type discordUser struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	GlobalName string `json:"global_name"`
	Avatar     string `json:"avatar"`
}

func (d discordUser) displayName() string {
	if d.GlobalName != "" {
		return d.GlobalName
	}
	return d.Username
}

func (d discordUser) avatarURL() string {
	if d.Avatar == "" {
		return ""
	}
	return fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.png?size=128", d.ID, d.Avatar)
}

func (s *Service) fetchDiscordUser(ctx context.Context, tok *oauth2.Token) (discordUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.discordAPI+"/users/@me", nil)
	if err != nil {
		return discordUser{}, err
	}
	tok.SetAuthHeader(req)
	resp, err := s.client.Do(req)
	if err != nil {
		return discordUser{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return discordUser{}, fmt.Errorf("discord /users/@me: %s", resp.Status)
	}
	var u discordUser
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return discordUser{}, fmt.Errorf("discord /users/@me: %w", err)
	}
	if u.ID == "" {
		return discordUser{}, fmt.Errorf("discord /users/@me: empty id")
	}
	return u, nil
}
