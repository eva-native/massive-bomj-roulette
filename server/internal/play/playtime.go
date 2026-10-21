package play

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/live"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
)

// The timer runs in the player's browser. What the player saves from it adds
// up here, one total per game, so the time survives across days and devices.
// It is only a hint for the hours: the player types them in the outcome form
// and the judge confirms them.

// maxPlayTimeMs is the same limit as the hours of a game.
const maxPlayTimeMs = int64(game.MaxHours) * 3600 * 1000

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

// canEditPlayTime: the player or a judge, while the game is being played.
func canEditPlayTime(ss *session, p game.PlayerID) bool {
	if ss.viewer == nil || ss.ev.Status != events.StatusActive || currentGame(ss, p) == nil {
		return false
	}
	return ss.member.IsJudge || ss.viewerID() == p && ss.member.IsParticipant
}

func (s *Service) playTime(ctx context.Context, ss *session, p game.PlayerID) (api.PlayTime, error) {
	pt := currentGame(ss, p)
	if pt == nil || ss.frozen != nil {
		return api.PlayTime{}, nil
	}
	total, err := s.st.GetPlayTime(ctx, db.GetPlayTimeParams{EventID: ss.ev.ID, PlaythroughID: pt.ID})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return api.PlayTime{}, err
	}
	return api.PlayTime{Playthrough: pt.ID, TotalMs: total, CanEdit: canEditPlayTime(ss, p)}, nil
}

// PlayTime is the saved time of the game the player is playing now.
func (s *Service) PlayTime(ctx context.Context, slug string, viewer *auth.User, playerID int64) (api.PlayTime, error) {
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return api.PlayTime{}, err
	}
	if ss.st.Player(game.PlayerID(playerID)) == nil {
		return api.PlayTime{}, events.ErrNotFound
	}
	return s.playTime(ctx, ss, game.PlayerID(playerID))
}

// UpdatePlayTime adds a timer session to the total or replaces the total.
func (s *Service) UpdatePlayTime(ctx context.Context, slug string, viewer *auth.User, playerID int64, req api.PlayTimeRequest) (api.PlayTime, error) {
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return api.PlayTime{}, err
	}
	p := game.PlayerID(playerID)
	if ss.st.Player(p) == nil {
		return api.PlayTime{}, events.ErrNotFound
	}
	if err := requireMember(ss); err != nil {
		return api.PlayTime{}, err
	}
	pt := currentGame(ss, p)
	if pt == nil {
		return api.PlayTime{}, fmt.Errorf("%w: время сохраняется, пока идёт игра", events.ErrConflict)
	}
	if !canEditPlayTime(ss, p) {
		return api.PlayTime{}, fmt.Errorf("%w: это время другого участника", events.ErrForbidden)
	}
	cur, err := s.playTime(ctx, ss, p)
	if err != nil {
		return api.PlayTime{}, err
	}
	key := db.SetPlayTimeParams{EventID: ss.ev.ID, PlaythroughID: pt.ID, UserID: playerID}
	tooLong := &events.InvalidError{Msg: fmt.Sprintf("время игры — не больше %d часов", game.MaxHours)}
	switch {
	case req.SetMs != nil:
		if *req.SetMs < 0 || *req.SetMs > maxPlayTimeMs {
			return api.PlayTime{}, tooLong
		}
		key.TotalMs = *req.SetMs
		cur.TotalMs, err = s.st.SetPlayTime(ctx, key)
	case req.AddMs >= 1000:
		if cur.TotalMs+req.AddMs > maxPlayTimeMs {
			return api.PlayTime{}, tooLong
		}
		key.TotalMs = req.AddMs
		cur.TotalMs, err = s.st.AddPlayTime(ctx, db.AddPlayTimeParams(key))
	default:
		return api.PlayTime{}, &events.InvalidError{Msg: "сессия — от 1 секунды"}
	}
	if err != nil {
		return api.PlayTime{}, err
	}
	s.live.Publish(ss.ev.ID, live.Message{Kind: "update"})
	return cur, nil
}
