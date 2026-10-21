package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
)

func (s *Server) routeEvents(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/events", s.listEvents)
	mux.HandleFunc("POST /api/events", s.createEvent)
	mux.HandleFunc("GET /api/events/{slug}", s.getEvent)
	mux.HandleFunc("PATCH /api/events/{slug}", s.updateEvent)
	mux.HandleFunc("POST /api/events/{slug}/join", s.joinEvent)
	mux.HandleFunc("POST /api/events/{slug}/invite", s.newInvite)
	mux.HandleFunc("PATCH /api/events/{slug}/members/{userID}", s.updateMember)
	mux.HandleFunc("DELETE /api/events/{slug}/members/{userID}", s.removeMember)
	mux.HandleFunc("GET /api/events/{slug}/items", s.listItems)

	mux.HandleFunc("GET /api/events/{slug}/games", s.listGames)
	mux.HandleFunc("POST /api/events/{slug}/games", s.addGame)
	mux.HandleFunc("PATCH /api/events/{slug}/games/{id}", s.updateGame)
	mux.HandleFunc("DELETE /api/events/{slug}/games/{id}", s.deleteGame)

	mux.HandleFunc("GET /api/events/{slug}/movies", s.listMovies)
	mux.HandleFunc("POST /api/events/{slug}/movies", s.addMovie)
	mux.HandleFunc("PATCH /api/events/{slug}/movies/{id}", s.updateMovie)
	mux.HandleFunc("DELETE /api/events/{slug}/movies/{id}", s.deleteMovie)
}

// serviceError maps an error from the events service to an HTTP response.
func (s *Server) serviceError(w http.ResponseWriter, err error) {
	var invalid *events.InvalidError
	switch {
	case errors.As(err, &invalid):
		writeError(w, http.StatusBadRequest, invalid.Msg)
	case errors.Is(err, events.ErrNotFound):
		writeError(w, http.StatusNotFound, "не найдено")
	case errors.Is(err, events.ErrUnauthenticated):
		writeError(w, http.StatusUnauthorized, "нужно войти")
	case errors.Is(err, events.ErrForbidden):
		writeError(w, http.StatusForbidden, message(err, events.ErrForbidden, "нет прав"))
	case errors.Is(err, events.ErrConflict):
		writeError(w, http.StatusConflict, message(err, events.ErrConflict, "конфликт"))
	default:
		s.internalError(w, err)
	}
}

// message returns the user-facing part of "sentinel: message", or a fallback.
func message(err, sentinel error, fallback string) string {
	msg := err.Error()
	prefix := sentinel.Error() + ": "
	if len(msg) > len(prefix) && msg[:len(prefix)] == prefix {
		return msg[len(prefix):]
	}
	return fallback
}

// respond writes v as JSON or maps err.
func respond[T any](s *Server, w http.ResponseWriter, status int, v T, err error) {
	if err != nil {
		s.serviceError(w, err)
		return
	}
	writeJSON(w, status, v)
}

func pathID(w http.ResponseWriter, r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "не найдено")
		return 0, false
	}
	return id, true
}

func user(r *http.Request) *auth.User { return auth.UserFrom(r.Context()) }

func (s *Server) listEvents(w http.ResponseWriter, r *http.Request) {
	list, err := s.events.List(r.Context(), user(r))
	respond(s, w, http.StatusOK, list, err)
}

func (s *Server) createEvent(w http.ResponseWriter, r *http.Request) {
	var req api.CreateEventRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	d, err := s.events.Create(r.Context(), user(r), req)
	respond(s, w, http.StatusCreated, d, err)
}

func (s *Server) getEvent(w http.ResponseWriter, r *http.Request) {
	d, err := s.events.Get(r.Context(), r.PathValue("slug"), user(r))
	respond(s, w, http.StatusOK, d, err)
}

func (s *Server) updateEvent(w http.ResponseWriter, r *http.Request) {
	var req api.UpdateEventRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	d, err := s.events.Update(r.Context(), user(r), r.PathValue("slug"), req)
	respond(s, w, http.StatusOK, d, err)
}

func (s *Server) joinEvent(w http.ResponseWriter, r *http.Request) {
	d, err := s.events.Join(r.Context(), user(r), r.PathValue("slug"), r.URL.Query().Get("invite"))
	respond(s, w, http.StatusOK, d, err)
}

func (s *Server) newInvite(w http.ResponseWriter, r *http.Request) {
	d, err := s.events.NewInvite(r.Context(), user(r), r.PathValue("slug"))
	respond(s, w, http.StatusOK, d, err)
}

func (s *Server) updateMember(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "userID")
	if !ok {
		return
	}
	var req api.UpdateMemberRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	d, err := s.events.UpdateMember(r.Context(), user(r), r.PathValue("slug"), id, req)
	respond(s, w, http.StatusOK, d, err)
}

func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "userID")
	if !ok {
		return
	}
	d, err := s.events.RemoveMember(r.Context(), user(r), r.PathValue("slug"), id)
	respond(s, w, http.StatusOK, d, err)
}

func (s *Server) listItems(w http.ResponseWriter, r *http.Request) {
	list, err := s.events.Items(r.Context(), r.PathValue("slug"))
	respond(s, w, http.StatusOK, list, err)
}

func (s *Server) listGames(w http.ResponseWriter, r *http.Request) {
	list, err := s.events.Games(r.Context(), r.PathValue("slug"))
	respond(s, w, http.StatusOK, list, err)
}

func (s *Server) addGame(w http.ResponseWriter, r *http.Request) {
	var in api.GameInput
	if !decodeJSON(w, r, &in) {
		return
	}
	g, err := s.events.AddGame(r.Context(), user(r), r.PathValue("slug"), in)
	respond(s, w, http.StatusCreated, g, err)
}

func (s *Server) updateGame(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in api.GameInput
	if !decodeJSON(w, r, &in) {
		return
	}
	g, err := s.events.UpdateGame(r.Context(), user(r), r.PathValue("slug"), id, in)
	respond(s, w, http.StatusOK, g, err)
}

func (s *Server) deleteGame(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.events.DeleteGame(r.Context(), user(r), r.PathValue("slug"), id); err != nil {
		s.serviceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listMovies(w http.ResponseWriter, r *http.Request) {
	list, err := s.events.Movies(r.Context(), r.PathValue("slug"))
	respond(s, w, http.StatusOK, list, err)
}

func (s *Server) addMovie(w http.ResponseWriter, r *http.Request) {
	var in api.MovieInput
	if !decodeJSON(w, r, &in) {
		return
	}
	m, err := s.events.AddMovie(r.Context(), user(r), r.PathValue("slug"), in)
	respond(s, w, http.StatusCreated, m, err)
}

func (s *Server) updateMovie(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	var in api.MovieInput
	if !decodeJSON(w, r, &in) {
		return
	}
	m, err := s.events.UpdateMovie(r.Context(), user(r), r.PathValue("slug"), id, in)
	respond(s, w, http.StatusOK, m, err)
}

func (s *Server) deleteMovie(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := s.events.DeleteMovie(r.Context(), user(r), r.PathValue("slug"), id); err != nil {
		s.serviceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
