// Package auth handles Discord OAuth login, dev login and cookie sessions.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"

	"github.com/eva-native/massive-bomj-roulette/server/internal/config"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
)

const (
	sessionCookie = "mbr_session"
	stateCookie   = "mbr_oauth_state"
	devIDPrefix   = "dev:"
	maxNameLen    = 32
)

// ErrInvalidName is returned by DevLogin for an empty or too long name.
var ErrInvalidName = fmt.Errorf("name must be 1–%d characters", maxNameLen)

// User is the logged-in user attached to a request.
type User struct {
	ID        int64
	DiscordID string
	Name      string
	AvatarURL string
	IsAdmin   bool
}

type Service struct {
	store  *store.Store
	cfg    config.Config
	oauth  *oauth2.Config
	log    *slog.Logger
	now    func() time.Time
	client *http.Client

	// discordAPI is the Discord REST base URL; tests point it at a fake server.
	discordAPI string
}

func New(st *store.Store, cfg config.Config, log *slog.Logger) *Service {
	return &Service{
		store: st,
		cfg:   cfg,
		log:   log,
		now:   time.Now,
		oauth: &oauth2.Config{
			ClientID:     cfg.DiscordClientID,
			ClientSecret: cfg.DiscordClientSecret,
			RedirectURL:  cfg.BaseURL + "/auth/discord/callback",
			Scopes:       []string{"identify"},
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://discord.com/oauth2/authorize",
				TokenURL: "https://discord.com/api/oauth2/token",
			},
		},
		client:     &http.Client{Timeout: 10 * time.Second},
		discordAPI: "https://discord.com/api",
	}
}

// --- sessions -------------------------------------------------------------

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

func (s *Service) startSession(ctx context.Context, w http.ResponseWriter, userID int64) error {
	token, err := newToken()
	if err != nil {
		return err
	}
	expires := s.now().Add(s.cfg.SessionTTL)
	if err := s.store.CreateSession(ctx, db.CreateSessionParams{
		TokenHash: hashToken(token),
		UserID:    userID,
		ExpiresAt: expires,
	}); err != nil {
		return fmt.Errorf("auth: create session: %w", err)
	}
	s.setCookie(w, sessionCookie, token, "/", int(s.cfg.SessionTTL.Seconds()))
	return nil
}

func (s *Service) setCookie(w http.ResponseWriter, name, value, path string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   s.cfg.SecureCookies(),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Service) toUser(u db.User) *User {
	return &User{
		ID:        u.ID,
		DiscordID: u.DiscordID,
		Name:      u.Name,
		AvatarURL: u.AvatarURL,
		IsAdmin:   s.cfg.AdminDiscordIDs[u.DiscordID],
	}
}

type ctxKey struct{}

// Middleware attaches the session user, if any, to the request context.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil || c.Value == "" {
			next.ServeHTTP(w, r)
			return
		}
		u, err := s.store.GetSessionUser(r.Context(), hashToken(c.Value))
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			s.setCookie(w, sessionCookie, "", "/", -1) // expired or unknown: drop the cookie
			next.ServeHTTP(w, r)
		case err != nil:
			s.log.Error("auth: load session", "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
		default:
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, s.toUser(u))))
		}
	})
}

// UserFrom returns the logged-in user, or nil.
func UserFrom(ctx context.Context) *User {
	u, _ := ctx.Value(ctxKey{}).(*User)
	return u
}

// Logout deletes the current session and clears the cookie.
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) error {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		if err := s.store.DeleteSession(r.Context(), hashToken(c.Value)); err != nil {
			return fmt.Errorf("auth: delete session: %w", err)
		}
	}
	s.setCookie(w, sessionCookie, "", "/", -1)
	return nil
}

// CleanupExpired removes expired sessions.
func (s *Service) CleanupExpired(ctx context.Context) (int64, error) {
	return s.store.DeleteExpiredSessions(ctx)
}

// --- dev login --------------------------------------------------------------

// DevLogin logs in as a local user with the given name. Only for MBR_DEV_LOGIN.
func (s *Service) DevLogin(ctx context.Context, w http.ResponseWriter, name string) (*User, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > maxNameLen {
		return nil, ErrInvalidName
	}
	u, err := s.store.UpsertUserByDiscordID(ctx, db.UpsertUserByDiscordIDParams{
		DiscordID: devIDPrefix + strings.ToLower(name),
		Name:      name,
	})
	if err != nil {
		return nil, fmt.Errorf("auth: dev user: %w", err)
	}
	if err := s.startSession(ctx, w, u.ID); err != nil {
		return nil, err
	}
	return s.toUser(u), nil
}
