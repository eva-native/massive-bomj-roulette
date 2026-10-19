// Package play runs the game of an event: it loads the engine's snapshot from
// PostgreSQL, applies an action and saves it in one transaction, writes the
// journal and notifies live subscribers.
package play

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/live"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
)

type Service struct {
	st     *store.Store
	eng    *game.Engine
	live   *live.Broker
	notify Sender
}

// Sender posts a message to an event's Discord webhook (notify.Notifier).
type Sender interface {
	Send(webhook, text string)
}

func New(st *store.Store, eng *game.Engine, broker *live.Broker) *Service {
	return &Service{st: st, eng: eng, live: broker}
}

// SetNotifier plugs in Discord notifications.
func (s *Service) SetNotifier(n Sender) { s.notify = n }

// quietKinds are journal entries not worth a Discord message.
var quietKinds = map[string]bool{"input": true}

// stateDoc is the part of game.State that is stored as a document.
type stateDoc struct {
	Turns        []*game.Turn        `json:"turns"`
	Spins        []*game.Spin        `json:"spins"`
	Items        []*game.Item        `json:"items"`
	Playthroughs []*game.Playthrough `json:"playthroughs"`
	WheelResets  []game.WheelReset   `json:"wheelResets"`
	NextID       int64               `json:"nextId"`
	NextSeq      int64               `json:"nextSeq"`
}

// activityPayload is stored with a journal entry.
type activityPayload struct {
	Spin *api.SpinInfo `json:"spin,omitempty"`
}

// session is one loaded event with the viewer.
type session struct {
	ev      db.Event
	viewer  *auth.User
	member  db.EventMember // the viewer's membership; zero if none
	st      *game.State
	names   map[game.PlayerID]api.PlayerRef
	members map[game.PlayerID]db.ListMembersRow
	webhook string
	q       *db.Queries
	acts    []activity
	dirty   bool // the snapshot changed while loading (new players got turns)
}

type activity struct {
	actor   *int64
	kind    string
	message string
	spin    *api.SpinInfo
}

func (ss *session) log(kind, format string, args ...any) {
	var actor *int64
	if ss.viewer != nil {
		id := ss.viewer.ID
		actor = &id
	}
	ss.acts = append(ss.acts, activity{actor: actor, kind: kind, message: fmt.Sprintf(format, args...)})
}

func (ss *session) name(id game.PlayerID) string { return ss.names[id].Name }

func (ss *session) viewerID() game.PlayerID {
	if ss.viewer == nil {
		return 0
	}
	return game.PlayerID(ss.viewer.ID)
}

// load reads the event, its members, pool, settings and snapshot.
func (s *Service) load(ctx context.Context, q *db.Queries, slug string, viewer *auth.User, lock bool) (*session, error) {
	ev, err := q.GetEventBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, events.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if lock {
		if err := q.LockEvent(ctx, ev.ID); err != nil {
			return nil, err
		}
	}

	var settings api.EventSettings
	if len(ev.Settings) > 0 {
		if err := json.Unmarshal(ev.Settings, &settings); err != nil {
			return nil, fmt.Errorf("play: settings: %w", err)
		}
	}
	st := &game.State{Settings: toGameSettings(settings)}
	ss := &session{ev: ev, viewer: viewer, st: st, q: q, webhook: settings.WebhookURL,
		names: map[game.PlayerID]api.PlayerRef{}, members: map[game.PlayerID]db.ListMembersRow{}}

	members, err := q.ListMembers(ctx, ev.ID)
	if err != nil {
		return nil, err
	}
	for _, m := range members {
		id := game.PlayerID(m.UserID)
		ss.members[id] = m
		ss.names[id] = api.PlayerRef{ID: m.UserID, Name: m.Name, AvatarURL: m.AvatarURL}
		if viewer != nil && m.UserID == viewer.ID {
			ss.member = db.EventMember{EventID: ev.ID, UserID: m.UserID, IsParticipant: m.IsParticipant, IsJudge: m.IsJudge}
		}
		if m.IsParticipant {
			st.Players = append(st.Players, &game.Player{ID: id, Name: m.Name, Judge: m.IsJudge})
		} else if m.IsJudge {
			st.Judges = append(st.Judges, id)
		}
	}

	games, err := q.ListGames(ctx, ev.ID)
	if err != nil {
		return nil, err
	}
	for _, g := range games {
		key := ""
		if g.SpecialKey != nil {
			key = *g.SpecialKey
		}
		st.Games = append(st.Games, &game.Game{ID: g.ID, Title: g.Title, AddedBy: game.PlayerID(g.AddedBy),
			HLTB: int(g.HltbHours), Rating: int(g.Rating), Year: int(g.Year), SpecialKey: key})
	}
	movies, err := q.ListMovies(ctx, ev.ID)
	if err != nil {
		return nil, err
	}
	for _, m := range movies {
		st.Movies = append(st.Movies, &game.Movie{ID: m.ID, Title: m.Title, AddedBy: game.PlayerID(m.AddedBy)})
	}

	row, err := q.GetEventState(ctx, ev.ID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return nil, err
	default:
		var doc stateDoc
		if err := json.Unmarshal(row.State, &doc); err != nil {
			return nil, fmt.Errorf("play: state: %w", err)
		}
		st.Turns, st.Spins, st.Items, st.Playthroughs = doc.Turns, doc.Spins, doc.Items, doc.Playthroughs
		st.WheelResets, st.NextID, st.NextSeq = doc.WheelResets, doc.NextID, doc.NextSeq
	}

	if err := s.addFormerPlayers(ctx, ss); err != nil {
		return nil, err
	}

	// Participants without a turn get their first one. Only a running event
	// starts new turns.
	if ev.Status == events.StatusActive {
		for _, p := range st.Players {
			if ss.members[p.ID].IsParticipant {
				created, err := s.eng.Start(st, p.ID)
				if err != nil {
					return nil, err
				}
				ss.dirty = ss.dirty || created
			}
		}
	}
	return ss, nil
}

// addFormerPlayers keeps players who left the event but have played, so
// their games still count.
func (s *Service) addFormerPlayers(ctx context.Context, ss *session) error {
	var missing []int64
	seen := map[game.PlayerID]bool{}
	for _, t := range ss.st.Turns {
		if ss.st.Player(t.Player) == nil && !seen[t.Player] {
			seen[t.Player] = true
			missing = append(missing, int64(t.Player))
		}
	}
	if len(missing) == 0 {
		return nil
	}
	users, err := ss.q.GetUsers(ctx, missing)
	if err != nil {
		return err
	}
	for _, u := range users {
		id := game.PlayerID(u.ID)
		ss.st.Players = append(ss.st.Players, &game.Player{ID: id, Name: u.Name, Judge: ss.members[id].IsJudge})
		ss.names[id] = api.PlayerRef{ID: u.ID, Name: u.Name, AvatarURL: u.AvatarURL}
	}
	return nil
}

func toGameSettings(in api.EventSettings) game.Settings {
	out := game.Settings{StartSpins: in.StartSpins, Weights: in.Weights, Disabled: map[string]bool{}}
	for _, r := range in.SpinsByHours {
		out.SpinsByHours = append(out.SpinsByHours, game.SpinsRow{MinHours: r.MinHours, Spins: r.Spins})
	}
	for _, id := range in.Disabled {
		out.Disabled[id] = true
	}
	return out
}

// read loads the event for viewing. If loading started turns for new
// players, they are saved first so step ids stay stable.
func (s *Service) read(ctx context.Context, slug string, viewer *auth.User) (*session, error) {
	ss, err := s.load(ctx, s.st.Queries, slug, viewer, false)
	if err != nil || !ss.dirty {
		return ss, err
	}
	if err := s.write(ctx, slug, viewer, func(*session) error { return nil }); err != nil {
		return nil, err
	}
	return s.load(ctx, s.st.Queries, slug, viewer, false)
}

// write runs fn on the locked event and saves the snapshot and journal.
func (s *Service) write(ctx context.Context, slug string, viewer *auth.User, fn func(ss *session) error) error {
	tx, err := s.st.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit
	q := s.st.WithTx(tx)

	ss, err := s.load(ctx, q, slug, viewer, true)
	if err != nil {
		return err
	}
	if err := fn(ss); err != nil {
		return engineError(err)
	}
	doc, err := json.Marshal(stateDoc{
		Turns: ss.st.Turns, Spins: ss.st.Spins, Items: ss.st.Items, Playthroughs: ss.st.Playthroughs,
		WheelResets: ss.st.WheelResets, NextID: ss.st.NextID, NextSeq: ss.st.NextSeq,
	})
	if err != nil {
		return err
	}
	if err := q.SaveEventState(ctx, db.SaveEventStateParams{EventID: ss.ev.ID, State: doc}); err != nil {
		return err
	}
	for _, a := range ss.acts {
		payload := []byte("{}")
		if a.spin != nil {
			if payload, err = json.Marshal(activityPayload{Spin: a.spin}); err != nil {
				return err
			}
		}
		if _, err := q.AddActivity(ctx, db.AddActivityParams{
			EventID: ss.ev.ID, ActorID: a.actor, Kind: a.kind, Message: a.message, Payload: payload,
		}); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	for _, a := range ss.acts {
		s.live.Publish(ss.ev.ID, live.Message{Kind: a.kind, Message: a.message})
		if s.notify != nil && ss.webhook != "" && !quietKinds[a.kind] {
			s.notify.Send(ss.webhook, a.message)
		}
	}
	if len(ss.acts) == 0 && ss.dirty {
		s.live.Publish(ss.ev.ID, live.Message{Kind: "update"})
	}
	return nil
}

// engineError turns errors of an action into the service errors HTTP maps.
// Actions only call the rules engine and the permission checks below, so
// every error here is about the request, never about the database.
func engineError(err error) error {
	var ie *events.InvalidError
	switch {
	case errors.Is(err, game.ErrBadInput):
		return &events.InvalidError{Msg: err.Error()}
	case errors.Is(err, game.ErrNotJudge):
		return fmt.Errorf("%w: %s", events.ErrForbidden, err.Error())
	case errors.As(err, &ie), errors.Is(err, events.ErrNotFound), errors.Is(err, events.ErrForbidden),
		errors.Is(err, events.ErrConflict), errors.Is(err, events.ErrUnauthenticated):
		return err
	}
	// Engine sentinels and plain errors of item hooks («уже использовано»).
	return fmt.Errorf("%w: %s", events.ErrConflict, err.Error())
}

// requirePlayer checks that the viewer plays in the running event.
func requirePlayer(ss *session) error {
	if ss.viewer == nil {
		return events.ErrUnauthenticated
	}
	if !ss.member.IsParticipant {
		return fmt.Errorf("%w: сначала присоединитесь к ивенту", events.ErrForbidden)
	}
	if ss.ev.Status != events.StatusActive {
		return fmt.Errorf("%w: ивент завершён", events.ErrConflict)
	}
	return nil
}

// requireMember checks that the viewer is a participant or a judge of the running event.
func requireMember(ss *session) error {
	if ss.viewer == nil {
		return events.ErrUnauthenticated
	}
	if !ss.member.IsParticipant && !ss.member.IsJudge {
		return fmt.Errorf("%w: вы не участвуете в ивенте", events.ErrForbidden)
	}
	if ss.ev.Status != events.StatusActive {
		return fmt.Errorf("%w: ивент завершён", events.ErrConflict)
	}
	return nil
}

func requireJudge(ss *session) error {
	if ss.viewer == nil {
		return events.ErrUnauthenticated
	}
	if !ss.member.IsJudge {
		return fmt.Errorf("%w: это может только судья", events.ErrForbidden)
	}
	return nil
}
