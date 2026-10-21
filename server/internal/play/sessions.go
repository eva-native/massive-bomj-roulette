package play

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/live"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
)

// Play sessions are the time a player spent on the game they are playing,
// saved from the timer in the browser or typed in by hand. They are only a
// hint for the hours of the game: the player types the hours in the outcome
// form and the judge confirms them.

// maxSessionMs caps one session; a longer one is surely a forgotten timer.
const maxSessionMs = 24 * 3600 * 1000

// currentGame is the playthrough the player is playing now, or nil.
func currentGame(ss *session, p game.PlayerID) *game.Playthrough {
	t := ss.st.CurrentTurn(p)
	if t == nil {
		return nil
	}
	pt := ss.st.Playthrough(t.Playthrough)
	if pt == nil || pt.Outcome != game.OutcomeNone {
		return nil
	}
	return pt
}

// canEditSessions: the player while playing, or a judge, in a running event.
func canEditSessions(ss *session, p game.PlayerID) bool {
	if ss.viewer == nil || ss.ev.Status != events.StatusActive {
		return false
	}
	return ss.member.IsJudge || ss.viewerID() == p && ss.member.IsParticipant
}

func sessionView(r db.PlaySession) api.PlaySession {
	return api.PlaySession{ID: r.ID, StartedAt: r.StartedAt.UTC().Format(time.RFC3339), DurationMs: r.DurationMs}
}

// PlaySessions lists the sessions of the game the player is playing now.
func (s *Service) PlaySessions(ctx context.Context, slug string, viewer *auth.User, playerID int64) (api.PlaySessions, error) {
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return api.PlaySessions{}, err
	}
	p := game.PlayerID(playerID)
	if ss.st.Player(p) == nil {
		return api.PlaySessions{}, events.ErrNotFound
	}
	out := api.PlaySessions{Sessions: []api.PlaySession{}}
	pt := currentGame(ss, p)
	if pt == nil || ss.frozen != nil {
		return out, nil
	}
	rows, err := s.st.ListPlaySessions(ctx, db.ListPlaySessionsParams{EventID: ss.ev.ID, PlaythroughID: pt.ID})
	if err != nil {
		return api.PlaySessions{}, err
	}
	out.Playthrough, out.CanEdit = pt.ID, canEditSessions(ss, p)
	for _, r := range rows {
		out.Sessions = append(out.Sessions, sessionView(r))
		out.TotalMs += r.DurationMs
	}
	return out, nil
}

func checkDuration(ms int64) error {
	if ms < 1000 || ms > maxSessionMs {
		return &events.InvalidError{Msg: "сессия — от 1 секунды до 24 часов"}
	}
	return nil
}

// AddPlaySession saves a session of the game the player is playing now.
func (s *Service) AddPlaySession(ctx context.Context, slug string, viewer *auth.User, playerID int64, req api.AddPlaySessionRequest) (api.PlaySession, error) {
	if err := checkDuration(req.DurationMs); err != nil {
		return api.PlaySession{}, err
	}
	now := time.Now()
	started := now.Add(-time.Duration(req.DurationMs) * time.Millisecond)
	if req.StartedAt != "" {
		t, err := time.Parse(time.RFC3339, req.StartedAt)
		if err != nil || t.After(now.Add(5*time.Minute)) {
			return api.PlaySession{}, &events.InvalidError{Msg: "неверное время начала сессии"}
		}
		started = t
	}
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return api.PlaySession{}, err
	}
	p := game.PlayerID(playerID)
	if ss.st.Player(p) == nil {
		return api.PlaySession{}, events.ErrNotFound
	}
	if err := requireMember(ss); err != nil {
		return api.PlaySession{}, err
	}
	if !canEditSessions(ss, p) {
		return api.PlaySession{}, fmt.Errorf("%w: это сессии другого участника", events.ErrForbidden)
	}
	pt := currentGame(ss, p)
	if pt == nil {
		return api.PlaySession{}, fmt.Errorf("%w: сессии сохраняются, пока идёт игра", events.ErrConflict)
	}
	row, err := s.st.AddPlaySession(ctx, db.AddPlaySessionParams{
		EventID: ss.ev.ID, UserID: playerID, PlaythroughID: pt.ID, StartedAt: started, DurationMs: req.DurationMs,
	})
	if err != nil {
		return api.PlaySession{}, err
	}
	s.live.Publish(ss.ev.ID, live.Message{Kind: "update"})
	return sessionView(row), nil
}

// editableSession loads a session the viewer may change.
func (s *Service) editableSession(ctx context.Context, slug string, viewer *auth.User, id int64) (*session, db.PlaySession, error) {
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return nil, db.PlaySession{}, err
	}
	if err := requireMember(ss); err != nil {
		return nil, db.PlaySession{}, err
	}
	row, err := s.st.GetPlaySession(ctx, db.GetPlaySessionParams{ID: id, EventID: ss.ev.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, db.PlaySession{}, events.ErrNotFound
	}
	if err != nil {
		return nil, db.PlaySession{}, err
	}
	p := game.PlayerID(row.UserID)
	if !canEditSessions(ss, p) {
		return nil, db.PlaySession{}, fmt.Errorf("%w: это сессии другого участника", events.ErrForbidden)
	}
	// The player changes sessions of the current game only; a judge any.
	if pt := currentGame(ss, p); !ss.member.IsJudge && (pt == nil || pt.ID != row.PlaythroughID) {
		return nil, db.PlaySession{}, fmt.Errorf("%w: эта игра уже отправлена судье", events.ErrConflict)
	}
	return ss, row, nil
}

func (s *Service) UpdatePlaySession(ctx context.Context, slug string, viewer *auth.User, id int64, req api.UpdatePlaySessionRequest) (api.PlaySession, error) {
	if err := checkDuration(req.DurationMs); err != nil {
		return api.PlaySession{}, err
	}
	ss, _, err := s.editableSession(ctx, slug, viewer, id)
	if err != nil {
		return api.PlaySession{}, err
	}
	row, err := s.st.UpdatePlaySession(ctx, db.UpdatePlaySessionParams{ID: id, EventID: ss.ev.ID, DurationMs: req.DurationMs})
	if err != nil {
		return api.PlaySession{}, err
	}
	s.live.Publish(ss.ev.ID, live.Message{Kind: "update"})
	return sessionView(row), nil
}

func (s *Service) DeletePlaySession(ctx context.Context, slug string, viewer *auth.User, id int64) error {
	ss, _, err := s.editableSession(ctx, slug, viewer, id)
	if err != nil {
		return err
	}
	if err := s.st.DeletePlaySession(ctx, db.DeletePlaySessionParams{ID: id, EventID: ss.ev.ID}); err != nil {
		return err
	}
	s.live.Publish(ss.ev.ID, live.Message{Kind: "update"})
	return nil
}
