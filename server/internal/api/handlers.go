package api

import "net/http"

func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.store.Leaderboard())
}

