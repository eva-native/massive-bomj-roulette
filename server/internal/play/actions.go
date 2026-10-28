package play

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/live"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
)

// Player returns a player's view of the event.
func (s *Service) Player(ctx context.Context, slug string, viewer *auth.User, playerID int64) (api.PlayerView, error) {
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return api.PlayerView{}, err
	}
	if ss.frozen != nil {
		v, ok := ss.frozen.Players[playerID]
		if !ok {
			return api.PlayerView{}, events.ErrNotFound
		}
		return v, nil
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
		var pos []int
		res.Wheel, pos = s.wheelView(sp.Wheel, sp.Sectors, stepID)
		res.Result, res.Label = pos[sp.Result], sp.Picked().Label
		ss.log("spin", "%s крутит %s: %s", ss.name(me), wheelNames[sp.Wheel], res.Label)
		ss.acts[len(ss.acts)-1].spin = &api.SpinInfo{Player: ss.name(me), Wheel: res.Wheel, Result: res.Result, Label: res.Label}
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
	review, err := cleanReview(req.Review)
	if err != nil {
		return api.PlayerView{}, err
	}
	if review == "" && game.Outcome(req.Outcome) != game.OutcomeTech {
		return api.PlayerView{}, &events.InvalidError{Msg: "напишите обзор игры"}
	}
	return s.act(ctx, slug, viewer, func(ss *session, me game.PlayerID) error {
		if err := s.eng.FinishGame(ss.st, me, stepID, game.Outcome(req.Outcome), req.Hours, proof); err != nil {
			return err
		}
		pt := ss.st.Playthrough(ss.st.CurrentTurn(me).Playthrough)
		pt.Review = review
		title := s.gameTitle(ss, pt.Game)
		switch game.Outcome(req.Outcome) {
		case game.OutcomeCompleted:
			ss.log("finish", "%s прошёл «%s» за %s", ss.name(me), title, formatHours(req.Hours))
		case game.OutcomeTech:
			ss.log("finish", "%s просит тех. дроп «%s»", ss.name(me), title)
		default:
			ss.log("finish", "%s дропнул «%s»", ss.name(me), title)
		}
		return nil
	})
}

// formatHours writes hours as «25 ч 30 мин 12 с», leaving out zero parts.
func formatHours(h float64) string {
	total := int64(math.Round(h * 3600))
	hh, mm, ss := total/3600, total/60%60, total%60
	var parts []string
	if hh > 0 {
		parts = append(parts, fmt.Sprintf("%d ч", hh))
	}
	if mm > 0 {
		parts = append(parts, fmt.Sprintf("%d мин", mm))
	}
	if ss > 0 || len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("%d с", ss))
	}
	return strings.Join(parts, " ")
}

// maxReview caps the length of a game review, in characters.
const maxReview = 2000

func cleanReview(s string) (string, error) {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > maxReview {
		return "", &events.InvalidError{Msg: fmt.Sprintf("обзор не длиннее %d символов", maxReview)}
	}
	return s, nil
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
		if err := requireJudgeAction(ss); err != nil {
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
		switch {
		case accept && pt.Outcome == game.OutcomeTech:
			ss.log("confirm", "Судья %s подтверждает тех. дроп: %s — «%s»", ss.viewer.Name, player, title)
		case accept:
			ss.log("confirm", "Судья %s подтверждает: %s — «%s»", ss.viewer.Name, player, title)
		default:
			ss.log("reject", "Судья %s отклоняет итог: %s — «%s»", ss.viewer.Name, player, title)
		}
		return nil
	})
}

// ConfirmItem is a judge's decision on an item's result.
func (s *Service) ConfirmItem(ctx context.Context, slug string, viewer *auth.User, itemID int64, accept bool) error {
	return s.write(ctx, slug, viewer, func(ss *session) error {
		if err := requireJudgeAction(ss); err != nil {
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

// FinishEvent ends the event and freezes its standings: from now on every view
// comes from the frozen copy, so later rule or code changes never touch it.
// Judges only.
func (s *Service) FinishEvent(ctx context.Context, slug string, viewer *auth.User) error {
	return s.write(ctx, slug, viewer, func(ss *session) error {
		if err := requireJudgeAction(ss); err != nil {
			return err
		}
		fz := &frozenDoc{Leaderboard: s.leaderboard(ss), Players: map[int64]api.PlayerView{}}
		for _, p := range ss.st.Players {
			v := s.playerView(ss, p.ID)
			v.CanAct = false
			if v.Turn != nil {
				v.Turn.Waiting = "Ивент завершён"
				v.Turn.Wheel = nil
				for i := range v.Turn.Items {
					v.Turn.Items[i].CanUse, v.Turn.Items[i].UseHint = false, ""
				}
			}
			for i := range v.Pocket {
				v.Pocket[i].CanUse, v.Pocket[i].UseHint = false, ""
			}
			fz.Players[int64(p.ID)] = v
		}
		ss.freeze = fz
		if err := ss.q.SetEventStatus(ctx, db.SetEventStatusParams{ID: ss.ev.ID, Status: events.StatusFinished}); err != nil {
			return err
		}
		winner := "никто не набрал очков"
		if len(fz.Leaderboard) > 0 {
			winner = fmt.Sprintf("победитель — %s (%d)", fz.Leaderboard[0].Player.Name, fz.Leaderboard[0].Points)
		}
		ss.log("finish_event", "Судья %s завершает ивент: %s", ss.viewer.Name, winner)
		return nil
	})
}

// MarkRulesVersion records the catalog version in every running event and
// notes in their journal when the rules changed since the last start.
// Points are always computed with the current rules anyway.
func (s *Service) MarkRulesVersion(ctx context.Context, version string) error {
	rows, err := s.st.ListActiveEvents(ctx)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if r.RulesVersion == version {
			continue
		}
		if r.RulesVersion != "" {
			const msg = "Правила обновлены: очки пересчитаны по новой версии"
			if _, err := s.st.AddActivity(ctx, db.AddActivityParams{EventID: r.ID, Kind: "rules", Message: msg, Payload: []byte("{}")}); err != nil {
				return err
			}
			s.live.Publish(r.ID, live.Message{Kind: "rules", Message: msg})
		}
		if err := s.st.SetRulesVersion(ctx, db.SetRulesVersionParams{ID: r.ID, RulesVersion: version}); err != nil {
			return err
		}
	}
	return nil
}

// exportDoc is everything about an event, for archives and backups of a
// single event. The webhook secret is left out.
type exportDoc struct {
	ExportedAt  time.Time            `json:"exportedAt"`
	Event       exportEvent          `json:"event"`
	Members     []db.ListMembersRow  `json:"members"`
	Games       []*game.Game         `json:"games"`
	Movies      []*game.Movie        `json:"movies"`
	State       stateDoc             `json:"state"`
	Leaderboard []api.LeaderboardRow `json:"leaderboard"`
	Activity    []api.ActivityEntry  `json:"activity"`
}

type exportEvent struct {
	Slug         string            `json:"slug"`
	Title        string            `json:"title"`
	Status       string            `json:"status"`
	RulesVersion string            `json:"rulesVersion"`
	Settings     api.EventSettings `json:"settings"`
}

// Export returns the whole event as JSON. Judges only.
func (s *Service) Export(ctx context.Context, slug string, viewer *auth.User) ([]byte, error) {
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return nil, err
	}
	if err := requireJudge(ss); err != nil {
		return nil, err
	}
	var settings api.EventSettings
	_ = json.Unmarshal(ss.ev.Settings, &settings)
	settings.WebhookURL = ""
	acts, err := s.Activity(ctx, slug, maxExportActivity)
	if err != nil {
		return nil, err
	}
	doc := exportDoc{
		ExportedAt: time.Now().UTC(),
		Event:      exportEvent{Slug: ss.ev.Slug, Title: ss.ev.Title, Status: ss.ev.Status, RulesVersion: ss.ev.RulesVersion, Settings: settings},
		Games:      ss.st.Games,
		Movies:     ss.st.Movies,
		State: stateDoc{Turns: ss.st.Turns, Spins: ss.st.Spins, Items: ss.st.Items, Playthroughs: ss.st.Playthroughs,
			WheelResets: ss.st.WheelResets, NextID: ss.st.NextID, NextSeq: ss.st.NextSeq},
		Activity: acts,
	}
	for _, m := range ss.members {
		doc.Members = append(doc.Members, m)
	}
	if ss.frozen != nil {
		doc.Leaderboard = ss.frozen.Leaderboard
	} else {
		doc.Leaderboard = s.leaderboard(ss)
	}
	return json.MarshalIndent(doc, "", "  ")
}

const maxExportActivity = 1_000_000

var stepNames = map[game.StepKind]string{
	game.StepSpinItems:    "колесо эффектов и бонусов",
	game.StepSpinDrop:     "колесо дроп-дебаффов",
	game.StepChoosePlayer: "выбор участника",
	game.StepSpinGame:     "колесо игр",
	game.StepChooseGame:   "выбор игры",
	game.StepSpinMovie:    "киноколесо",
	game.StepPlay:         "итог игры",
}

// UndoStep lets a judge take back a player's last step in the current turn.
func (s *Service) UndoStep(ctx context.Context, slug string, viewer *auth.User, playerID int64) error {
	return s.write(ctx, slug, viewer, func(ss *session) error {
		if err := requireJudgeAction(ss); err != nil {
			return err
		}
		p := game.PlayerID(playerID)
		if ss.st.Player(p) == nil {
			return events.ErrNotFound
		}
		st, err := s.eng.UndoLastStep(ss.st, ss.viewerID(), p)
		if err != nil {
			return err
		}
		ss.log("undo", "Судья %s отменяет последний шаг у %s: %s", ss.viewer.Name, ss.name(p), stepNames[st.Kind])
		return nil
	})
}

// EditPlaythrough lets a judge correct the hours, proof and review of a finished game.
// The review may be left empty here: games finished before reviews were required have none.
func (s *Service) EditPlaythrough(ctx context.Context, slug string, viewer *auth.User, playthroughID int64, req api.EditPlaythroughRequest) error {
	proof := strings.TrimSpace(req.Proof)
	if proof != "" && !strings.HasPrefix(proof, "http://") && !strings.HasPrefix(proof, "https://") {
		return &events.InvalidError{Msg: "доказательство — ссылка (http:// или https://)"}
	}
	review, err := cleanReview(req.Review)
	if err != nil {
		return err
	}
	return s.write(ctx, slug, viewer, func(ss *session) error {
		if err := requireJudgeAction(ss); err != nil {
			return err
		}
		pt := ss.st.Playthrough(playthroughID)
		if pt == nil {
			return events.ErrNotFound
		}
		if err := s.eng.EditPlaythrough(ss.st, ss.viewerID(), playthroughID, req.Hours, proof); err != nil {
			return err
		}
		pt.Review = review
		ss.log("edit", "Судья %s исправляет «%s» у %s: %s", ss.viewer.Name, s.gameTitle(ss, pt.Game), ss.name(pt.Player), formatHours(req.Hours))
		return nil
	})
}

func (s *Service) Leaderboard(ctx context.Context, slug string, viewer *auth.User) ([]api.LeaderboardRow, error) {
	ss, err := s.read(ctx, slug, viewer)
	if err != nil {
		return nil, err
	}
	if ss.frozen != nil {
		return ss.frozen.Leaderboard, nil
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
	if ss.frozen != nil {
		return []api.QueueEntry{}, nil
	}
	out := s.queue(ss)
	totals, err := s.st.PlayTimeTotals(ctx, ss.ev.ID)
	if err != nil {
		return nil, err
	}
	byPt := map[int64]int64{}
	for _, t := range totals {
		byPt[t.PlaythroughID] = t.TotalMs
	}
	for _, e := range out {
		if e.Playthrough != nil {
			e.Playthrough.TimerMs = byPt[e.Playthrough.ID]
		}
	}
	return out, nil
}

func (s *Service) Activity(ctx context.Context, slug string, limit int) ([]api.ActivityEntry, error) {
	ev, err := s.st.GetEventBySlug(ctx, slug)
	if err != nil {
		return nil, notFound(err)
	}
	if limit <= 0 || limit > 200 && limit != maxExportActivity {
		limit = 50
	}
	rows, err := s.st.ListActivity(ctx, db.ListActivityParams{EventID: ev.ID, Limit: int32(limit)})
	if err != nil {
		return nil, err
	}
	out := make([]api.ActivityEntry, 0, len(rows))
	for _, r := range rows {
		e := api.ActivityEntry{
			ID: r.ID, Kind: r.Kind, Message: r.Message, ActorName: r.ActorName, CreatedAt: r.CreatedAt.Format(time.RFC3339),
		}
		var p activityPayload
		if json.Unmarshal(r.Payload, &p) == nil {
			e.Spin = p.Spin
		}
		out = append(out, e)
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
