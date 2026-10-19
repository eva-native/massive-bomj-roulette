// Package httpapi wires HTTP routes, middleware and JSON handlers.
package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/config"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store"
)

type Server struct {
	cfg    config.Config
	store  *store.Store
	auth   *auth.Service
	events *events.Service
	log    *slog.Logger
	web    fs.FS
}

func New(cfg config.Config, st *store.Store, a *auth.Service, ev *events.Service, log *slog.Logger, web fs.FS) *Server {
	return &Server{cfg: cfg, store: st, auth: a, events: ev, log: log, web: web}
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("GET /api/health", s.health)
	api.HandleFunc("GET /api/config", s.appConfig)
	api.HandleFunc("GET /api/me", s.me)
	s.routeEvents(api)
	api.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})

	if s.cfg.DiscordEnabled() {
		api.HandleFunc("GET /auth/discord/login", s.auth.StartDiscordLogin)
		api.HandleFunc("GET /auth/discord/callback", s.auth.FinishDiscordLogin)
	}
	if s.cfg.DevLogin {
		api.HandleFunc("POST /auth/dev/login", s.devLogin)
	}
	api.HandleFunc("POST /auth/logout", s.logout)

	root := http.NewServeMux()
	withSession := s.auth.Middleware(api)
	root.Handle("/api/", withSession)
	root.Handle("/auth/", withSession)
	root.Handle("/", spaHandler(s.web))

	return s.recoverer(s.logRequests(root))
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Pool.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) appConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, api.AppConfig{
		DiscordLogin: s.cfg.DiscordEnabled(),
		DevLogin:     s.cfg.DevLogin,
	})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not logged in")
		return
	}
	writeJSON(w, http.StatusOK, toMe(u))
}

func (s *Server) devLogin(w http.ResponseWriter, r *http.Request) {
	var req api.DevLoginRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	u, err := s.auth.DevLogin(r.Context(), w, req.Name)
	switch {
	case errors.Is(err, auth.ErrInvalidName):
		writeError(w, http.StatusBadRequest, err.Error())
	case err != nil:
		s.internalError(w, err)
	default:
		writeJSON(w, http.StatusOK, toMe(u))
	}
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if err := s.auth.Logout(w, r); err != nil {
		s.internalError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func toMe(u *auth.User) api.Me {
	return api.Me{ID: u.ID, Name: u.Name, AvatarURL: u.AvatarURL, IsAdmin: u.IsAdmin}
}

// --- JSON helpers -------------------------------------------------------------

const maxBodyBytes = 1 << 20

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, api.ErrorResponse{Error: msg})
}

func (s *Server) internalError(w http.ResponseWriter, err error) {
	s.log.Error("internal error", "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

// decodeJSON reads a JSON body into v; on failure it writes a 400 and returns false.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

// --- middleware ---------------------------------------------------------------

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Flush keeps streaming responses (SSE) working through the recorder.
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		s.log.Info("http", "method", r.Method, "path", r.URL.Path, "status", rec.status, "dur", time.Since(start).Round(time.Millisecond))
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if err, ok := v.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(v)
				}
				s.log.Error("panic", "value", v, "path", r.URL.Path)
				writeError(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
