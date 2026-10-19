package play

import (
	"fmt"
	"slices"
	"sort"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
)

var wheelNames = map[game.WheelKind]string{
	game.WheelItems: "колесо эффектов и бонусов",
	game.WheelDrops: "колесо дроп-дебаффов",
	game.WheelGames: "колесо игр",
	game.WheelMovie: "киноколесо",
}

var sourceLabels = map[string]string{
	game.SourceCompletion:  "Прохождение",
	game.SourceSpeed:       "Скорость",
	game.SourceRecord:      "Рекорд",
	game.SourceDropPenalty: "Дроп",
}

var useLabels = map[game.UseMode]string{
	game.UsePlaythrough:       "Применить к игре",
	game.UseAfterSpin:         "Перекрутить",
	game.UseInsteadOfGameSpin: "Выбрать игру самому",
	game.UseOffer:             "Воспользоваться",
	game.UseAnytime:           "Использовать",
}

func (s *Service) def(id string) *game.Def { return s.eng.Catalog().Def(id) }

func (s *Service) gameTitle(ss *session, id int64) string {
	if g := ss.st.Game(id); g != nil {
		return g.Title
	}
	return "?"
}

// playerView builds everything about one player for the viewer.
func (s *Service) playerView(ss *session, p game.PlayerID) api.PlayerView {
	entries := s.eng.Score(ss.st)
	v := api.PlayerView{
		Player:  ss.names[p],
		Pocket:  []api.ItemView{},
		History: []api.PlaythroughView{},
		Entries: []api.PointEntry{},
	}
	for _, e := range entries {
		if e.Player != p {
			continue
		}
		v.Points += e.Points
		v.Entries = append(v.Entries, s.pointEntry(ss, e))
	}

	t := ss.st.CurrentTurn(p)
	if t != nil {
		tv := s.turnView(ss, t, entries)
		v.Turn = &tv
		v.CanAct = ss.viewerID() == p && ss.member.IsParticipant && ss.ev.Status == "active" && tv.Current != nil
	}
	for _, it := range ss.st.Items {
		if it.Player == p && it.Placement == game.PlacePocket {
			v.Pocket = append(v.Pocket, s.itemView(ss, it, nil))
		}
	}
	for i := len(ss.st.Playthroughs) - 1; i >= 0; i-- {
		pt := ss.st.Playthroughs[i]
		if pt.Player == p && pt.Outcome != game.OutcomeNone && (t == nil || pt.ID != t.Playthrough) {
			v.History = append(v.History, s.playthroughView(ss, pt, entries))
		}
	}
	return v
}

func (s *Service) pointEntry(ss *session, e game.Entry) api.PointEntry {
	pe := api.PointEntry{Points: e.Points, Label: sourceLabels[e.Source]}
	if pt := ss.st.Playthrough(e.Playthrough); pt != nil {
		pe.Game = s.gameTitle(ss, pt.Game)
	}
	if e.Item != 0 {
		if it := ss.st.Item(e.Item); it != nil {
			if d := s.def(it.DefID); d != nil {
				pe.Label = d.Name
			}
		}
	}
	if pe.Label == "" {
		pe.Label = e.Source
	}
	if e.From != 0 {
		pe.From = ss.name(e.From)
	}
	return pe
}

func (s *Service) turnView(ss *session, t *game.Turn, entries []game.Entry) api.TurnView {
	tv := api.TurnView{ID: t.ID, Reason: string(t.Reason), Steps: []api.StepView{}, Items: []api.ItemView{}}
	for _, other := range ss.st.Turns {
		if other.Player == t.Player {
			tv.Number++
		}
		if other == t {
			break
		}
	}
	cur := t.CurrentStep()
	for _, st := range t.Steps {
		sv := s.stepView(ss, t, st)
		tv.Steps = append(tv.Steps, sv)
		if st == cur {
			c := sv
			tv.Current = &c
		}
	}

	if pt := ss.st.Playthrough(t.Playthrough); pt != nil {
		pv := s.playthroughView(ss, pt, entries)
		tv.Playthrough = &pv
		if pt.Outcome != game.OutcomeNone && !pt.Confirmed {
			tv.Waiting = "Итог ждёт подтверждения судьи"
		}
	}

	if cur != nil && isSpin(cur.Kind) {
		kind, sectors, err := s.eng.Wheel(ss.st, t.Player, cur.ID)
		if err != nil {
			tv.Waiting = emptyWheelHint(kind, cur.Kind)
		} else {
			wv := api.WheelView{Kind: string(kind), Sectors: make([]api.Sector, 0, len(sectors))}
			for _, sec := range sectors {
				out := api.Sector{Label: sec.Label, Weight: sec.Weight}
				if d := s.def(sec.DefID); d != nil {
					out.Kind = string(d.Kind)
				}
				wv.Sectors = append(wv.Sectors, out)
			}
			tv.Wheel = &wv
		}
	}

	for _, it := range ss.st.Items {
		if it.Player != t.Player || it.Placement == game.PlaceVoided || it.Placement == game.PlacePocket {
			continue
		}
		onGame := t.Playthrough != 0 && slices.Contains(it.Chain, t.Playthrough)
		inTurn := it.TurnID == t.ID && (it.Placement == game.PlacePending || it.Placement == game.PlaceUsed)
		if onGame || inTurn {
			tv.Items = append(tv.Items, s.itemView(ss, it, t))
		}
	}
	return tv
}

func isSpin(k game.StepKind) bool {
	return k == game.StepSpinItems || k == game.StepSpinDrop || k == game.StepSpinGame || k == game.StepSpinMovie
}

func emptyWheelHint(_ game.WheelKind, step game.StepKind) string {
	switch step {
	case game.StepSpinGame:
		return "Колесо игр пустое: добавьте игры в пул"
	case game.StepSpinMovie:
		return "Киноколесо пустое: добавьте фильмы"
	default:
		return "Колесо пустое: судья выключил все предметы"
	}
}

func (s *Service) stepView(ss *session, t *game.Turn, st *game.Step) api.StepView {
	sv := api.StepView{ID: st.ID, Kind: string(st.Kind), Done: st.Done, Options: []api.Option{}}
	if st.CreatedBy != 0 {
		if it := ss.st.Item(st.CreatedBy); it != nil {
			if d := s.def(it.DefID); d != nil {
				sv.AddedBy = d.Name
			}
		}
	}
	if st.Done {
		switch st.Kind {
		case game.StepSpinItems, game.StepSpinDrop:
			if it := ss.st.Item(st.Result); it != nil {
				if d := s.def(it.DefID); d != nil {
					sv.Result = d.Name
				}
			}
		case game.StepSpinGame, game.StepChooseGame:
			sv.Result = s.gameTitle(ss, st.Result)
		case game.StepSpinMovie:
			if m := ss.st.Movie(st.Result); m != nil {
				sv.Result = m.Title
			}
		case game.StepChoosePlayer:
			sv.Result = ss.name(game.PlayerID(st.Result))
		}
	}
	switch st.Kind {
	case game.StepChooseGame:
		for _, id := range st.Options {
			sv.Options = append(sv.Options, api.Option{ID: id, Label: s.gameTitle(ss, id)})
		}
	case game.StepChoosePlayer:
		for _, p := range ss.st.Players {
			if p.ID != t.Player && ss.members[p.ID].IsParticipant {
				sv.Options = append(sv.Options, api.Option{ID: int64(p.ID), Label: p.Name})
			}
		}
	}
	return sv
}

func (s *Service) playthroughView(ss *session, pt *game.Playthrough, entries []game.Entry) api.PlaythroughView {
	v := api.PlaythroughView{
		ID: pt.ID, GameID: pt.Game, Game: s.gameTitle(ss, pt.Game),
		Outcome: string(pt.Outcome), Hours: pt.Hours, Proof: pt.Proof, Confirmed: pt.Confirmed,
	}
	if g := ss.st.Game(pt.Game); g != nil {
		v.HLTBHours = g.HLTB
		v.BasePoints = game.BasePoints(*g)
	}
	for _, e := range entries {
		if e.Playthrough == pt.ID && e.Player == pt.Player {
			v.Points += e.Points
		}
	}
	return v
}

// itemView describes an item; t is the turn it is shown in (nil for the pocket).
func (s *Service) itemView(ss *session, it *game.Item, t *game.Turn) api.ItemView {
	d := s.def(it.DefID)
	v := api.ItemView{
		ID: it.ID, DefID: it.DefID, Placement: string(it.Placement), Fields: []api.FieldView{},
		Confirmed: it.Confirmed, Rejected: it.Rejected, Blocked: s.eng.Blocked(ss.st, it.ID),
	}
	if d == nil {
		v.Name = it.DefID
		return v
	}
	v.Name, v.Concept, v.Kind, v.NeedsConfirm = d.Name, d.Concept, string(d.Kind), d.NeedsConfirm
	v.Note = s.eng.Note(ss.st, it.ID)
	for _, f := range d.Input {
		v.Fields = append(v.Fields, api.FieldView{
			Name: f.Name, Label: f.Label, Type: string(f.Type), By: string(f.By), Optional: f.Optional, Value: it.Input[f.Name],
		})
	}
	if d.Lifetime > 1 && t != nil && t.Playthrough != 0 {
		if i := slices.Index(it.Chain, t.Playthrough); i >= 0 {
			v.Status = fmt.Sprintf("%d из %d", i+1, d.Lifetime)
		}
	}
	if d.Use != game.UseNone && it.Placement != game.PlaceUsed {
		v.UseLabel = useLabels[d.Use]
		if err := s.eng.CanUse(ss.st, it.Player, it.ID); err != nil {
			v.UseHint = err.Error()
		} else {
			v.CanUse = true
		}
	}
	return v
}

func (s *Service) leaderboard(ss *session) []api.LeaderboardRow {
	entries := s.eng.Score(ss.st)
	totals := game.Totals(entries)
	rows := make([]api.LeaderboardRow, 0, len(ss.st.Players))
	for _, p := range ss.st.Players {
		row := api.LeaderboardRow{Player: ss.names[p.ID], Points: totals[p.ID]}
		for _, pt := range ss.st.Playthroughs {
			if pt.Player != p.ID {
				continue
			}
			switch {
			case pt.Confirmed && pt.Outcome == game.OutcomeCompleted:
				row.Completed++
			case pt.Confirmed && pt.Outcome == game.OutcomeDropped:
				row.Dropped++
			case pt.Outcome == game.OutcomeNone:
				row.Playing = s.gameTitle(ss, pt.Game)
			}
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Points != rows[j].Points {
			return rows[i].Points > rows[j].Points
		}
		return rows[i].Player.Name < rows[j].Player.Name
	})
	return rows
}

// queue lists what waits for a judge: finished games and items to confirm
// or to fill in.
func (s *Service) queue(ss *session) []api.QueueEntry {
	entries := s.eng.Score(ss.st)
	out := []api.QueueEntry{}
	for _, pt := range ss.st.Playthroughs {
		if pt.Outcome == game.OutcomeNone || pt.Confirmed {
			continue
		}
		pv := s.playthroughView(ss, pt, entries)
		out = append(out, api.QueueEntry{
			Kind: "playthrough", ID: pt.ID, Player: ss.names[pt.Player], Title: pv.Game, Playthrough: &pv, Game: pv.Game,
		})
	}
	for _, it := range ss.st.Items {
		d := s.def(it.DefID)
		if d == nil || it.Placement == game.PlaceVoided || it.Placement == game.PlacePocket || it.Confirmed || it.Rejected {
			continue
		}
		judgeField := slices.ContainsFunc(d.Input, func(f game.Field) bool { return f.By == game.RoleJudge })
		if !d.NeedsConfirm && !judgeField {
			continue
		}
		iv := s.itemView(ss, it, ss.st.Turn(it.TurnID))
		e := api.QueueEntry{Kind: "item", ID: it.ID, Player: ss.names[it.Player], Title: d.Name, Item: &iv}
		if len(it.Chain) > 0 {
			if pt := ss.st.Playthrough(it.Chain[len(it.Chain)-1]); pt != nil {
				e.Game = s.gameTitle(ss, pt.Game)
			}
		}
		out = append(out, e)
	}
	return out
}
