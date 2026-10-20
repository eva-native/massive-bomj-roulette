package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
)

func (s *Server) routePlay(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/events/{slug}/players/{userID}", s.getPlayer)
	mux.HandleFunc("POST /api/events/{slug}/steps/{id}/spin", s.spin)
	mux.HandleFunc("POST /api/events/{slug}/steps/{id}/choose", s.choose)
	mux.HandleFunc("POST /api/events/{slug}/steps/{id}/finish", s.finish)
	mux.HandleFunc("POST /api/events/{slug}/items/{id}/use", s.useItem)
	mux.HandleFunc("POST /api/events/{slug}/items/{id}/input", s.itemInput)
	mux.HandleFunc("POST /api/events/{slug}/items/{id}/confirm", s.confirmItem)
	mux.HandleFunc("POST /api/events/{slug}/playthroughs/{id}/confirm", s.confirmGame)
	mux.HandleFunc("PATCH /api/events/{slug}/playthroughs/{id}", s.editPlaythrough)
	mux.HandleFunc("POST /api/events/{slug}/players/{userID}/undo", s.undoStep)
	mux.HandleFunc("POST /api/events/{slug}/finish", s.finishEvent)
	mux.HandleFunc("GET /api/events/{slug}/export", s.exportEvent)
	mux.HandleFunc("GET /api/events/{slug}/leaderboard", s.leaderboard)
	mux.HandleFunc("GET /api/events/{slug}/queue", s.queue)
	mux.HandleFunc("GET /api/events/{slug}/activity", s.activity)
	mux.HandleFunc("GET /api/events/{slug}/stream", s.stream)
}

func (s *Server) getPlayer(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "userID")
	if !ok {
		return
	}
	v, err := s.play.Player(r.Context(), r.PathValue("slug"), user(r), id)
	respond(s, w, http.StatusOK, v, err)
}

// requireLogin writes 401 and returns false for anonymous requests.
func requireLogin(w http.ResponseWriter, r *http.Request) bool {
	if user(r) == nil {
		writeError(w, http.StatusUnauthorized, "нужно войти")
		return false
	}
	return true
}

func (s *Server) spin(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok || !requireLogin(w, r) {
		return
	}
	res, err := s.play.Spin(r.Context(), r.PathValue("slug"), user(r), id)
	respond(s, w, http.StatusOK, res, err)
}

func (s *Server) choose(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok || !requireLogin(w, r) {
		return
	}
	var req api.ChooseRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	v, err := s.play.Choose(r.Context(), r.PathValue("slug"), user(r), id, req.Choice)
	respond(s, w, http.StatusOK, v, err)
}

func (s *Server) finish(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok || !requireLogin(w, r) {
		return
	}
	var req api.FinishRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	v, err := s.play.Finish(r.Context(), r.PathValue("slug"), user(r), id, req)
	respond(s, w, http.StatusOK, v, err)
}

func (s *Server) useItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok || !requireLogin(w, r) {
		return
	}
	v, err := s.play.Use(r.Context(), r.PathValue("slug"), user(r), id)
	respond(s, w, http.StatusOK, v, err)
}

func (s *Server) itemInput(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok || !requireLogin(w, r) {
		return
	}
	var req api.InputRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.play.Input(r.Context(), r.PathValue("slug"), user(r), id, req.Values); err != nil {
		s.serviceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) confirmItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok || !requireLogin(w, r) {
		return
	}
	var req api.ConfirmRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.play.ConfirmItem(r.Context(), r.PathValue("slug"), user(r), id, req.Accept); err != nil {
		s.serviceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) confirmGame(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok || !requireLogin(w, r) {
		return
	}
	var req api.ConfirmRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.play.ConfirmGame(r.Context(), r.PathValue("slug"), user(r), id, req.Accept); err != nil {
		s.serviceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) editPlaythrough(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok || !requireLogin(w, r) {
		return
	}
	var req api.EditPlaythroughRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.play.EditPlaythrough(r.Context(), r.PathValue("slug"), user(r), id, req); err != nil {
		s.serviceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) undoStep(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "userID")
	if !ok || !requireLogin(w, r) {
		return
	}
	if err := s.play.UndoStep(r.Context(), r.PathValue("slug"), user(r), id); err != nil {
		s.serviceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) finishEvent(w http.ResponseWriter, r *http.Request) {
	if !requireLogin(w, r) {
		return
	}
	if err := s.play.FinishEvent(r.Context(), r.PathValue("slug"), user(r)); err != nil {
		s.serviceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) exportEvent(w http.ResponseWriter, r *http.Request) {
	if !requireLogin(w, r) {
		return
	}
	slug := r.PathValue("slug")
	b, err := s.play.Export(r.Context(), slug, user(r))
	if err != nil {
		s.serviceError(w, err)
		return
	}
	name := fmt.Sprintf("mbr-%s-%s.json", slug, time.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	_, _ = w.Write(b)
}

func (s *Server) leaderboard(w http.ResponseWriter, r *http.Request) {
	rows, err := s.play.Leaderboard(r.Context(), r.PathValue("slug"), user(r))
	respond(s, w, http.StatusOK, rows, err)
}

func (s *Server) queue(w http.ResponseWriter, r *http.Request) {
	if !requireLogin(w, r) {
		return
	}
	q, err := s.play.Queue(r.Context(), r.PathValue("slug"), user(r))
	respond(s, w, http.StatusOK, q, err)
}

func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	list, err := s.play.Activity(r.Context(), r.PathValue("slug"), limit)
	respond(s, w, http.StatusOK, list, err)
}

// keepAlive is how often an idle stream sends a comment, so proxies keep it open.
const keepAlive = 25 * time.Second

// stream sends server-sent events whenever the event changes. Clients
// refetch what they show; the message is only a hint.
func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	eventID, err := s.play.EventID(r.Context(), r.PathValue("slug"))
	if err != nil {
		s.serviceError(w, err)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	// send writes a frame; an error means the client is gone.
	send := func(format string, args ...any) bool {
		if _, err := fmt.Fprintf(w, format, args...); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !send("retry: 3000\n\n") {
		return
	}

	msgs, unsubscribe := s.live.Subscribe(eventID)
	defer unsubscribe()
	tick := time.NewTicker(keepAlive)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case m, ok := <-msgs:
			if !ok {
				return
			}
			b, _ := json.Marshal(m)
			if !send("event: change\ndata: %s\n\n", b) {
				return
			}
		case <-tick.C:
			if !send(": ping\n\n") {
				return
			}
		}
	}
}
