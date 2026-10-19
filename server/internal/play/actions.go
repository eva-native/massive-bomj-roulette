package play

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
)

// Player returns a player's view of the event.
func (s *Service) Player(ctx context.Context, slug string, viewer *auth.User, playerID int64) (api.PlayerView, error) {
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return api.PlayerView{}, err
	}
	if ss.st.Player(game.PlayerID(playerID)) == nil {
		return api.PlayerView{}, events.ErrNotFound
	}
	return s.playerView(ss, game.PlayerID(playerID)), nil
}

// act runs an action of the viewer as a player and returns their new view.
func (s *Service) act(ctx context.Context, slug string, viewer *auth.User, fn func(ss *session, me game.PlayerID) error) (api.PlayerView, error) {
	err := s.write(ctx, slug, viewer, func(ss *session) error {
		if err := requirePlayer(ss); err != nil {
			return err
		}
		return fn(ss, ss.viewerID())
	})
	if err != nil {
		return api.PlayerView{}, err
	}
	return s.Player(ctx, slug, viewer, viewer.ID)
}

// Spin spins the wheel of the viewer's current step.
func (s *Service) Spin(ctx context.Context, slug string, viewer *auth.User, stepID int64) (api.SpinResult, error) {
	var res api.SpinResult
	view, err := s.act(ctx, slug, viewer, func(ss *session, me game.PlayerID) error {
		sp, err := s.eng.Spin(ss.st, me, stepID)
		if err != nil {
			return err
		}
		res.Wheel = api.WheelView{Kind: string(sp.Wheel), Sectors: make([]api.Sector, 0, len(sp.Sectors))}
		for _, sec := range sp.Sectors {
			out := api.Sector{Label: sec.Label, Weight: sec.Weight}
			if d := s.def(sec.DefID); d != nil {
				out.Kind = string(d.Kind)
			}
			res.Wheel.Sectors = append(res.Wheel.Sectors, out)
		}
		res.Result, res.Label = sp.Result, sp.Picked().Label
		ss.log("spin", "%s крутит %s: %s", ss.name(me), wheelNames[sp.Wheel], res.Label)
		return nil
	})
	res.View = view
	return res, err
}

// Choose completes a choice step (a participant or a game).
func (s *Service) Choose(ctx context.Context, slug string, viewer *auth.User, stepID, choice int64) (api.PlayerView, error) {
	return s.act(ctx, slug, viewer, func(ss *session, me game.PlayerID) error {
		t := ss.st.CurrentTurn(me)
		cur := t.CurrentStep()
		if err := s.eng.Choose(ss.st, me, stepID, choice); err != nil {
			return err
		}
		if cur.Kind == game.StepChoosePlayer {
			ss.log("choose", "%s выбирает участника: %s", ss.name(me), ss.name(game.PlayerID(choice)))
		} else {
			ss.log("choose", "%s выбирает игру: %s", ss.name(me), s.gameTitle(ss, choice))
		}
		return nil
	})
}

// Finish records the outcome of the viewer's current game.
func (s *Service) Finish(ctx context.Context, slug string, viewer *auth.User, stepID int64, req api.FinishRequest) (api.PlayerView, error) {
	proof := strings.TrimSpace(req.Proof)
	if proof != "" && !strings.HasPrefix(proof, "http://") && !strings.HasPrefix(proof, "https://") {
		return api.PlayerView{}, &events.InvalidError{Msg: "доказательство — ссылка (http:// или https://)"}
	}
	return s.act(ctx, slug, viewer, func(ss *session, me game.PlayerID) error {
		if err := s.eng.FinishGame(ss.st, me, stepID, game.Outcome(req.Outcome), req.Hours, proof); err != nil {
			return err
		}
		title := s.gameTitle(ss, ss.st.Playthrough(ss.st.CurrentTurn(me).Playthrough).Game)
		if req.Outcome == string(game.OutcomeCompleted) {
			ss.log("finish", "%s прошёл «%s» за %s ч", ss.name(me), title, formatHours(req.Hours))
		} else {
			ss.log("finish", "%s дропнул «%s»", ss.name(me), title)
		}
		return nil
	})
}

func formatHours(h float64) string {
	return strings.Replace(strconv.FormatFloat(h, 'f', -1, 64), ".", ",", 1)
}

// Use uses one of the viewer's items.
func (s *Service) Use(ctx context.Context, slug string, viewer *auth.User, itemID int64) (api.PlayerView, error) {
	return s.act(ctx, slug, viewer, func(ss *session, me game.PlayerID) error {
		it := ss.st.Item(itemID)
		if err := s.eng.Use(ss.st, me, itemID); err != nil {
			return err
		}
		ss.log("use", "%s применяет «%s»", ss.name(me), s.def(it.DefID).Name)
		return nil
	})
}

// Input fills an item's fields. The owner fills player fields; judges fill
// judge fields (and may correct the owner's).
func (s *Service) Input(ctx context.Context, slug string, viewer *auth.User, itemID int64, values map[string]any) error {
	return s.write(ctx, slug, viewer, func(ss *session) error {
		if err := requireMember(ss); err != nil {
			return err
		}
		it := ss.st.Item(itemID)
		if it == nil {
			return events.ErrNotFound
		}
		if err := s.eng.SetInput(ss.st, ss.viewerID(), itemID, values); err != nil {
			return err
		}
		if ss.viewerID() == it.Player {
			ss.log("input", "%s заполняет «%s»", ss.name(it.Player), s.def(it.DefID).Name)
		} else {
			ss.log("input", "Судья %s заполняет «%s» у %s", ss.viewer.Name, s.def(it.DefID).Name, ss.name(it.Player))
		}
		return nil
	})
}

// ConfirmGame is a judge's decision on a finished game.
func (s *Service) ConfirmGame(ctx context.Context, slug string, viewer *auth.User, playthroughID int64, accept bool) error {
	return s.write(ctx, slug, viewer, func(ss *session) error {
		if err := requireJudge(ss); err != nil {
			return err
		}
		pt := ss.st.Playthrough(playthroughID)
		if pt == nil {
			return events.ErrNotFound
		}
		player, title := ss.name(pt.Player), s.gameTitle(ss, pt.Game)
		if err := s.eng.ConfirmGame(ss.st, ss.viewerID(), playthroughID, accept); err != nil {
			return err
		}
		if accept {
			ss.log("confirm", "Судья %s подтверждает: %s — «%s»", ss.viewer.Name, player, title)
		} else {
			ss.log("reject", "Судья %s отклоняет итог: %s — «%s»", ss.viewer.Name, player, title)
		}
		return nil
	})
}

// ConfirmItem is a judge's decision on an item's result.
func (s *Service) ConfirmItem(ctx context.Context, slug string, viewer *auth.User, itemID int64, accept bool) error {
	return s.write(ctx, slug, viewer, func(ss *session) error {
		if err := requireJudge(ss); err != nil {
			return err
		}
		it := ss.st.Item(itemID)
		if it == nil {
			return events.ErrNotFound
		}
		if err := s.eng.ConfirmItem(ss.st, ss.viewerID(), itemID, accept); err != nil {
			return err
		}
		verb := "подтверждает"
		if !accept {
			verb = "отклоняет"
		}
		ss.log("confirm_item", "Судья %s %s «%s» у %s", ss.viewer.Name, verb, s.def(it.DefID).Name, ss.name(it.Player))
		return nil
	})
}

func (s *Service) Leaderboard(ctx context.Context, slug string, viewer *auth.User) ([]api.LeaderboardRow, error) {
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return nil, err
	}
	return s.leaderboard(ss), nil
}

// Queue lists what waits for a judge. Judges only.
func (s *Service) Queue(ctx context.Context, slug string, viewer *auth.User) ([]api.QueueEntry, error) {
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return nil, err
	}
	if err := requireJudge(ss); err != nil {
		return nil, err
	}
	return s.queue(ss), nil
}

func (s *Service) Activity(ctx context.Context, slug string, limit int) ([]api.ActivityEntry, error) {
	ev, err := s.st.GetEventBySlug(ctx, slug)
	if err != nil {
		return nil, notFound(err)
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.st.ListActivity(ctx, db.ListActivityParams{EventID: ev.ID, Limit: int32(limit)})
	if err != nil {
		return nil, err
	}
	out := make([]api.ActivityEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, api.ActivityEntry{
			ID: r.ID, Kind: r.Kind, Message: r.Message, ActorName: r.ActorName, CreatedAt: r.CreatedAt.Format(time.RFC3339),
		})
	}
	return out, nil
}

// EventID resolves a slug for live subscriptions.
func (s *Service) EventID(ctx context.Context, slug string) (int64, error) {
	ev, err := s.st.GetEventBySlug(ctx, slug)
	if err != nil {
		return 0, notFound(err)
	}
	return ev.ID, nil
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return events.ErrNotFound
	}
	return err
}

// gameInUse reports whether a game was spun or played, so deleting it would
// break the history.
func gameInUse(st *game.State, gameID int64) bool {
	for _, pt := range st.Playthroughs {
		if pt.Game == gameID {
			return true
		}
	}
	for _, sp := range st.Spins {
		if sp.Wheel == game.WheelGames && !sp.Voided && sp.Picked().ID == gameID {
			return true
		}
	}
	return false
}

// GameInUse lets the events service refuse deleting games that were played.
func (s *Service) GameInUse(ctx context.Context, slug string, gameID int64) (bool, error) {
	ss, err := s.load(ctx, s.st.Queries, slug, nil, false)
	if err != nil {
		return false, err
	}
	return gameInUse(ss.st, gameID), nil
}
