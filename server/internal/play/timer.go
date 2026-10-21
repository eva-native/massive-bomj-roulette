package play

import (
	"context"
	"fmt"
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

// playTimer is a player's stopwatch for the game they are playing. It lives
// in the event snapshot, so a pause survives reloads. A new game starts it
// from zero.
type playTimer struct {
	Playthrough int64      `json:"playthrough"`
	ElapsedMs   int64      `json:"elapsedMs"` // time counted before StartedAt
	StartedAt   *time.Time `json:"startedAt,omitempty"`
}

// maxTimerMs caps the stopwatch at the same limit as the hours of a game.
const maxTimerMs = int64(game.MaxHours) * 3600 * 1000

func (t *playTimer) elapsed(now time.Time) int64 {
	ms := t.ElapsedMs
	if t.StartedAt != nil {
		ms += now.Sub(*t.StartedAt).Milliseconds()
	}
	return min(ms, maxTimerMs)
}

// playing returns the playthrough the player is playing now, or nil.
func playing(ss *session, p game.PlayerID) *game.Playthrough {
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

// timerOf returns the player's timer for the current game, creating a fresh
// one when the game changed.
func timerOf(ss *session, p game.PlayerID, pt *game.Playthrough) *playTimer {
	t := ss.timers[int64(p)]
	if t == nil || t.Playthrough != pt.ID {
		t = &playTimer{Playthrough: pt.ID}
		ss.timers[int64(p)] = t
	}
	return t
}

func (s *Service) timerView(ss *session, turn *game.Turn) *api.TimerView {
	pt := playing(ss, turn.Player)
	if pt == nil {
		return nil
	}
	v := &api.TimerView{}
	if t := ss.timers[int64(turn.Player)]; t != nil && t.Playthrough == pt.ID {
		v.ElapsedMs, v.Running = t.elapsed(s.now()), t.StartedAt != nil
	}
	return v
}

// pauseTimer stops the player's stopwatch, keeping the time counted so far.
func (s *Service) pauseTimer(ss *session, p int64) {
	if t := ss.timers[p]; t != nil && t.StartedAt != nil {
		t.ElapsedMs, t.StartedAt = t.elapsed(s.now()), nil
	}
}

// Timer starts or pauses the player's own stopwatch, or lets a judge set
// anyone's. It returns the player's new view.
func (s *Service) Timer(ctx context.Context, slug string, viewer *auth.User, playerID int64, req api.TimerRequest) (api.PlayerView, error) {
	var view api.PlayerView
	err := s.write(ctx, slug, viewer, func(ss *session) error {
		p := game.PlayerID(playerID)
		if ss.st.Player(p) == nil {
			return events.ErrNotFound
		}
		switch req.Action {
		case "start", "pause":
			if err := requirePlayer(ss); err != nil {
				return err
			}
			if ss.viewerID() != p {
				return fmt.Errorf("%w: это таймер другого участника", events.ErrForbidden)
			}
		case "set":
			if err := requireJudgeAction(ss); err != nil {
				return err
			}
			if req.Ms < 0 || req.Ms > maxTimerMs {
				return &events.InvalidError{Msg: fmt.Sprintf("время таймера — от 0 до %d часов", game.MaxHours)}
			}
		default:
			return &events.InvalidError{Msg: "неизвестное действие таймера"}
		}
		pt := playing(ss, p)
		if pt == nil {
			return fmt.Errorf("%w: таймер идёт только во время игры", events.ErrConflict)
		}
		t, now := timerOf(ss, p, pt), s.now()
		switch req.Action {
		case "start":
			if t.StartedAt == nil {
				t.StartedAt = &now
			}
		case "pause":
			s.pauseTimer(ss, playerID)
		case "set":
			t.ElapsedMs = req.Ms
			if t.StartedAt != nil {
				t.StartedAt = &now
			}
			ss.log("timer", "Судья %s ставит таймер %s: %s", ss.viewer.Name, ss.name(p), formatHours(float64(req.Ms)/3600000))
		}
		ss.dirty = true // let other viewers refresh
		view = s.playerView(ss, p)
		return nil
	})
	return view, err
}
