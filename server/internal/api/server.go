package api

import (
	"encoding/json"
	"net/http"

	"github.com/eva-native/massive-bomj-roulette/server/internal/domain"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store"
)

type Server struct {
	store store.Store
	cfg domain.ScoringConfig
}

type OptFunc func(*Server)

func NewServer(opts ...OptFunc) *Server {
	srv := &Server{}
	for _, opt := range opts {
		opt(srv)
	}
	return srv
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /leaderboard", s.handleLeaderboard)

	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
