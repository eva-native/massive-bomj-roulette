package events

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
)

const (
	minYear = 1950
	maxYear = 2100
)

// poolEvent loads an active event the user may add to: participants and judges.
func (s *Service) poolEvent(ctx context.Context, slug string, u *auth.User) (db.Event, db.EventMember, error) {
	if u == nil {
		return db.Event{}, db.EventMember{}, ErrUnauthenticated
	}
	ev, m, err := s.event(ctx, slug, u)
	if err != nil {
		return db.Event{}, db.EventMember{}, err
	}
	if !m.IsParticipant && !m.IsJudge {
		return db.Event{}, db.EventMember{}, fmt.Errorf("%w: сначала присоединитесь к ивенту", ErrForbidden)
	}
	if ev.Status != StatusActive {
		return db.Event{}, db.EventMember{}, fmt.Errorf("%w: ивент завершён", ErrConflict)
	}
	return ev, m, nil
}

// canEdit: the author of a record or a judge.
func canEdit(u *auth.User, m db.EventMember, addedBy int64) error {
	if m.IsJudge || u.ID == addedBy {
		return nil
	}
	return fmt.Errorf("%w: менять запись может её автор или судья", ErrForbidden)
}

// --- games --------------------------------------------------------------------

func toGame(g db.Game, addedByName string) api.Game {
	out := api.Game{
		ID: g.ID, Title: g.Title, HLTBHours: int(g.HltbHours), Rating: int(g.Rating), Year: int(g.Year),
		AddedBy: g.AddedBy, AddedByName: addedByName,
	}
	if g.SpecialKey != nil {
		out.SpecialKey = *g.SpecialKey
	}
	out.BasePoints = game.BasePoints(game.Game{HLTB: out.HLTBHours, Rating: out.Rating, Year: out.Year})
	return out
}

func (s *Service) Games(ctx context.Context, slug string) ([]api.Game, error) {
	ev, _, err := s.event(ctx, slug, nil)
	if err != nil {
		return nil, err
	}
	rows, err := s.st.ListGames(ctx, ev.ID)
	if err != nil {
		return nil, err
	}
	out := make([]api.Game, 0, len(rows))
	for _, r := range rows {
		out = append(out, toGame(db.Game{
			ID: r.ID, EventID: r.EventID, AddedBy: r.AddedBy, Title: r.Title, HltbHours: r.HltbHours,
			Rating: r.Rating, Year: r.Year, SpecialKey: r.SpecialKey,
		}, r.AddedByName))
	}
	return out, nil
}

type cleanGame struct {
	title              string
	hltb, rating, year int32
	specialKey         *string
}

func (s *Service) cleanGame(in api.GameInput, m db.EventMember, keep *string) (cleanGame, error) {
	title, err := cleanTitle(in.Title, maxGameTitleLen)
	if err != nil {
		return cleanGame{}, err
	}
	switch {
	case in.HLTBHours < 0 || in.HLTBHours > 999:
		return cleanGame{}, invalid("часы HLTB: от 0 до 999")
	case in.Rating < 0 || in.Rating > 100:
		return cleanGame{}, invalid("рейтинг: от 0 до 100")
	case in.Year < minYear || in.Year > maxYear:
		return cleanGame{}, invalid("год: от %d до %d", minYear, maxYear)
	}
	out := cleanGame{title: title, hltb: int32(in.HLTBHours), rating: int32(in.Rating), year: int32(in.Year), specialKey: keep}

	key := strings.TrimSpace(in.SpecialKey)
	current := ""
	if keep != nil {
		current = *keep
	}
	if key != current {
		if !m.IsJudge {
			return cleanGame{}, fmt.Errorf("%w: особые игры отмечает судья", ErrForbidden)
		}
		if key != "" && !s.knownSpecialKey(key) {
			return cleanGame{}, invalid("неизвестная особая игра %q", key)
		}
		out.specialKey = nil
		if key != "" {
			out.specialKey = &key
		}
	}
	return out, nil
}

func (s *Service) knownSpecialKey(key string) bool {
	for _, d := range s.cat.All() {
		for _, sg := range d.SpecialGames {
			if sg.Key == key {
				return true
			}
		}
	}
	return false
}

func (s *Service) AddGame(ctx context.Context, u *auth.User, slug string, in api.GameInput) (api.Game, error) {
	ev, m, err := s.poolEvent(ctx, slug, u)
	if err != nil {
		return api.Game{}, err
	}
	g, err := s.cleanGame(in, m, nil)
	if err != nil {
		return api.Game{}, err
	}
	row, err := s.st.CreateGame(ctx, db.CreateGameParams{
		EventID: ev.ID, AddedBy: u.ID, Title: g.title, HltbHours: g.hltb, Rating: g.rating, Year: g.year, SpecialKey: g.specialKey,
	})
	if isUniqueViolation(err) {
		return api.Game{}, fmt.Errorf("%w: эта особая игра уже есть в пуле", ErrConflict)
	}
	if err != nil {
		return api.Game{}, err
	}
	return toGame(row, u.Name), nil
}

func (s *Service) UpdateGame(ctx context.Context, u *auth.User, slug string, id int64, in api.GameInput) (api.Game, error) {
	ev, m, err := s.poolEvent(ctx, slug, u)
	if err != nil {
		return api.Game{}, err
	}
	cur, err := s.st.GetGame(ctx, db.GetGameParams{ID: id, EventID: ev.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return api.Game{}, ErrNotFound
	}
	if err != nil {
		return api.Game{}, err
	}
	if err := canEdit(u, m, cur.AddedBy); err != nil {
		return api.Game{}, err
	}
	g, err := s.cleanGame(in, m, cur.SpecialKey)
	if err != nil {
		return api.Game{}, err
	}
	row, err := s.st.UpdateGame(ctx, db.UpdateGameParams{
		ID: id, EventID: ev.ID, Title: g.title, HltbHours: g.hltb, Rating: g.rating, Year: g.year, SpecialKey: g.specialKey,
	})
	if isUniqueViolation(err) {
		return api.Game{}, fmt.Errorf("%w: эта особая игра уже есть в пуле", ErrConflict)
	}
	if err != nil {
		return api.Game{}, err
	}
	return toGame(row, s.userName(ctx, row.AddedBy)), nil
}

func (s *Service) DeleteGame(ctx context.Context, u *auth.User, slug string, id int64) error {
	ev, m, err := s.poolEvent(ctx, slug, u)
	if err != nil {
		return err
	}
	cur, err := s.st.GetGame(ctx, db.GetGameParams{ID: id, EventID: ev.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := canEdit(u, m, cur.AddedBy); err != nil {
		return err
	}
	_, err = s.st.DeleteGame(ctx, db.DeleteGameParams{ID: id, EventID: ev.ID})
	return err
}

func (s *Service) userName(ctx context.Context, id int64) string {
	u, err := s.st.GetUser(ctx, id)
	if err != nil {
		return ""
	}
	return u.Name
}

// --- movies -------------------------------------------------------------------

func (s *Service) Movies(ctx context.Context, slug string) ([]api.Movie, error) {
	ev, _, err := s.event(ctx, slug, nil)
	if err != nil {
		return nil, err
	}
	rows, err := s.st.ListMovies(ctx, ev.ID)
	if err != nil {
		return nil, err
	}
	out := make([]api.Movie, 0, len(rows))
	for _, r := range rows {
		out = append(out, api.Movie{ID: r.ID, Title: r.Title, AddedBy: r.AddedBy, AddedByName: r.AddedByName})
	}
	return out, nil
}

func (s *Service) AddMovie(ctx context.Context, u *auth.User, slug string, in api.MovieInput) (api.Movie, error) {
	ev, _, err := s.poolEvent(ctx, slug, u)
	if err != nil {
		return api.Movie{}, err
	}
	title, err := cleanTitle(in.Title, maxGameTitleLen)
	if err != nil {
		return api.Movie{}, err
	}
	row, err := s.st.CreateMovie(ctx, db.CreateMovieParams{EventID: ev.ID, AddedBy: u.ID, Title: title})
	if err != nil {
		return api.Movie{}, err
	}
	return api.Movie{ID: row.ID, Title: row.Title, AddedBy: row.AddedBy, AddedByName: u.Name}, nil
}

func (s *Service) UpdateMovie(ctx context.Context, u *auth.User, slug string, id int64, in api.MovieInput) (api.Movie, error) {
	ev, m, err := s.poolEvent(ctx, slug, u)
	if err != nil {
		return api.Movie{}, err
	}
	cur, err := s.st.GetMovie(ctx, db.GetMovieParams{ID: id, EventID: ev.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return api.Movie{}, ErrNotFound
	}
	if err != nil {
		return api.Movie{}, err
	}
	if err := canEdit(u, m, cur.AddedBy); err != nil {
		return api.Movie{}, err
	}
	title, err := cleanTitle(in.Title, maxGameTitleLen)
	if err != nil {
		return api.Movie{}, err
	}
	row, err := s.st.UpdateMovie(ctx, db.UpdateMovieParams{ID: id, EventID: ev.ID, Title: title})
	if err != nil {
		return api.Movie{}, err
	}
	return api.Movie{ID: row.ID, Title: row.Title, AddedBy: row.AddedBy, AddedByName: s.userName(ctx, row.AddedBy)}, nil
}

func (s *Service) DeleteMovie(ctx context.Context, u *auth.User, slug string, id int64) error {
	ev, m, err := s.poolEvent(ctx, slug, u)
	if err != nil {
		return err
	}
	cur, err := s.st.GetMovie(ctx, db.GetMovieParams{ID: id, EventID: ev.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := canEdit(u, m, cur.AddedBy); err != nil {
		return err
	}
	_, err = s.st.DeleteMovie(ctx, db.DeleteMovieParams{ID: id, EventID: ev.ID})
	return err
}
