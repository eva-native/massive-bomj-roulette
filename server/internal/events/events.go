// Package events manages events, their members and the pools of games and
// movies. It owns who may do what; HTTP handlers stay thin.
package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/eva-native/massive-bomj-roulette/server/internal/api"
	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/notify"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store/db"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrUnauthenticated = errors.New("not logged in")
	ErrForbidden       = errors.New("forbidden")
	ErrConflict        = errors.New("conflict")
)

// InvalidError is a validation error with a message for the user.
type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string { return e.Msg }

func invalid(format string, args ...any) error {
	return &InvalidError{Msg: fmt.Sprintf(format, args...)}
}

const (
	StatusActive   = "active"
	StatusFinished = "finished"

	defaultStartSpins = 3
	maxTitleLen       = 100
	maxGameTitleLen   = 200
)

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`)

type Service struct {
	st    *store.Store
	cat   *game.Catalog
	usage GameUsage
}

// GameUsage tells whether a game was already spun or played; such games
// cannot be deleted without breaking the history.
type GameUsage interface {
	GameInUse(ctx context.Context, slug string, gameID int64) (bool, error)
}

func New(st *store.Store, cat *game.Catalog) *Service {
	return &Service{st: st, cat: cat}
}

// SetGameUsage plugs in the check used before deleting games.
func (s *Service) SetGameUsage(u GameUsage) { s.usage = u }

// event loads an event with the user's membership (zero value if none).
func (s *Service) event(ctx context.Context, slug string, u *auth.User) (db.Event, db.EventMember, error) {
	ev, err := s.st.GetEventBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Event{}, db.EventMember{}, ErrNotFound
	}
	if err != nil {
		return db.Event{}, db.EventMember{}, err
	}
	var m db.EventMember
	if u != nil {
		m, err = s.st.GetMember(ctx, db.GetMemberParams{EventID: ev.ID, UserID: u.ID})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return db.Event{}, db.EventMember{}, err
		}
	}
	return ev, m, nil
}

// judgeEvent loads an event the user judges.
func (s *Service) judgeEvent(ctx context.Context, slug string, u *auth.User) (db.Event, error) {
	if u == nil {
		return db.Event{}, ErrUnauthenticated
	}
	ev, m, err := s.event(ctx, slug, u)
	if err != nil {
		return db.Event{}, err
	}
	if !m.IsJudge {
		return db.Event{}, ErrForbidden
	}
	return ev, nil
}

// --- events -------------------------------------------------------------------

func (s *Service) List(ctx context.Context, u *auth.User) ([]api.EventSummary, error) {
	var uid int64
	if u != nil {
		uid = u.ID
	}
	rows, err := s.st.ListEvents(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]api.EventSummary, 0, len(rows))
	for _, r := range rows {
		out = append(out, api.EventSummary{
			Slug: r.Slug, Title: r.Title, Status: r.Status, Participants: int(r.Participants),
			IsParticipant: r.IsParticipant, IsJudge: r.IsJudge,
		})
	}
	return out, nil
}

// Create makes a new event; the creator becomes its judge. Admins only.
func (s *Service) Create(ctx context.Context, u *auth.User, req api.CreateEventRequest) (api.EventDetail, error) {
	if u == nil {
		return api.EventDetail{}, ErrUnauthenticated
	}
	if !u.IsAdmin {
		return api.EventDetail{}, ErrForbidden
	}
	title, err := cleanTitle(req.Title, maxTitleLen)
	if err != nil {
		return api.EventDetail{}, err
	}
	slug := strings.ToLower(strings.TrimSpace(req.Slug))
	if !slugRe.MatchString(slug) {
		return api.EventDetail{}, invalid("адрес: 3–40 символов, латиница, цифры и дефис, без дефиса по краям")
	}
	settings, _ := json.Marshal(api.EventSettings{StartSpins: defaultStartSpins})

	err = s.inTx(ctx, func(q *db.Queries) error {
		ev, err := q.CreateEvent(ctx, db.CreateEventParams{
			Slug: slug, Title: title, Settings: settings, CreatedBy: u.ID, RulesVersion: s.cat.Fingerprint(),
		})
		if isUniqueViolation(err) {
			return fmt.Errorf("%w: адрес «%s» уже занят", ErrConflict, slug)
		}
		if err != nil {
			return err
		}
		if _, err := q.UpsertMember(ctx, db.UpsertMemberParams{EventID: ev.ID, UserID: u.ID, IsJudge: true}); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return api.EventDetail{}, err
	}
	return s.Get(ctx, slug, u)
}

func (s *Service) Get(ctx context.Context, slug string, u *auth.User) (api.EventDetail, error) {
	ev, m, err := s.event(ctx, slug, u)
	if err != nil {
		return api.EventDetail{}, err
	}
	settings, err := decodeSettings(ev.Settings)
	if err != nil {
		return api.EventDetail{}, err
	}
	if !m.IsJudge {
		settings.WebhookURL = ""
	}
	rows, err := s.st.ListMembers(ctx, ev.ID)
	if err != nil {
		return api.EventDetail{}, err
	}
	d := api.EventDetail{Slug: ev.Slug, Title: ev.Title, Status: ev.Status, Settings: settings, Members: []api.Member{}}
	for _, r := range rows {
		d.Members = append(d.Members, api.Member{
			UserID: r.UserID, Name: r.Name, AvatarURL: r.AvatarURL, IsParticipant: r.IsParticipant, IsJudge: r.IsJudge,
		})
	}
	if m.EventID != 0 {
		d.Me = &api.Membership{IsParticipant: m.IsParticipant, IsJudge: m.IsJudge}
	}
	return d, nil
}

// Update changes the title and/or settings. Judges only.
func (s *Service) Update(ctx context.Context, u *auth.User, slug string, req api.UpdateEventRequest) (api.EventDetail, error) {
	ev, err := s.judgeEvent(ctx, slug, u)
	if err != nil {
		return api.EventDetail{}, err
	}
	title := ev.Title
	if req.Title != nil {
		if title, err = cleanTitle(*req.Title, maxTitleLen); err != nil {
			return api.EventDetail{}, err
		}
	}
	settings := ev.Settings
	if req.Settings != nil {
		clean, err := s.cleanSettings(*req.Settings)
		if err != nil {
			return api.EventDetail{}, err
		}
		if settings, err = json.Marshal(clean); err != nil {
			return api.EventDetail{}, err
		}
	}
	if _, err := s.st.UpdateEvent(ctx, db.UpdateEventParams{ID: ev.ID, Title: title, Settings: settings}); err != nil {
		return api.EventDetail{}, err
	}
	return s.Get(ctx, slug, u)
}

// Join makes the user a participant of an active event.
func (s *Service) Join(ctx context.Context, u *auth.User, slug string) (api.EventDetail, error) {
	if u == nil {
		return api.EventDetail{}, ErrUnauthenticated
	}
	ev, _, err := s.event(ctx, slug, u)
	if err != nil {
		return api.EventDetail{}, err
	}
	if ev.Status != StatusActive {
		return api.EventDetail{}, fmt.Errorf("%w: ивент завершён", ErrConflict)
	}
	if _, err := s.st.UpsertMember(ctx, db.UpsertMemberParams{EventID: ev.ID, UserID: u.ID, IsParticipant: true}); err != nil {
		return api.EventDetail{}, err
	}
	return s.Get(ctx, slug, u)
}

// UpdateMember changes a member's roles. A member left without roles is
// removed. The last judge cannot lose the role. Judges only.
func (s *Service) UpdateMember(ctx context.Context, u *auth.User, slug string, userID int64, req api.UpdateMemberRequest) (api.EventDetail, error) {
	ev, err := s.judgeEvent(ctx, slug, u)
	if err != nil {
		return api.EventDetail{}, err
	}
	err = s.inTx(ctx, func(q *db.Queries) error {
		m, err := q.GetMember(ctx, db.GetMemberParams{EventID: ev.ID, UserID: userID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		participant, judge := m.IsParticipant, m.IsJudge
		if req.IsParticipant != nil {
			participant = *req.IsParticipant
		}
		if req.IsJudge != nil {
			judge = *req.IsJudge
		}
		if m.IsJudge && !judge {
			if err := lastJudgeCheck(ctx, q, ev.ID); err != nil {
				return err
			}
		}
		if !participant && !judge {
			_, err = q.DeleteMember(ctx, db.DeleteMemberParams{EventID: ev.ID, UserID: userID})
			return err
		}
		_, err = q.SetMemberRoles(ctx, db.SetMemberRolesParams{EventID: ev.ID, UserID: userID, IsParticipant: participant, IsJudge: judge})
		return err
	})
	if err != nil {
		return api.EventDetail{}, err
	}
	return s.Get(ctx, slug, u)
}

// RemoveMember removes a member from the event. Judges only.
func (s *Service) RemoveMember(ctx context.Context, u *auth.User, slug string, userID int64) (api.EventDetail, error) {
	f := false
	return s.UpdateMember(ctx, u, slug, userID, api.UpdateMemberRequest{IsParticipant: &f, IsJudge: &f})
}

func lastJudgeCheck(ctx context.Context, q *db.Queries, eventID int64) error {
	n, err := q.CountJudges(ctx, eventID)
	if err != nil {
		return err
	}
	if n <= 1 {
		return fmt.Errorf("%w: в ивенте должен остаться хотя бы один судья", ErrConflict)
	}
	return nil
}

// Items lists the catalog with the event's weights and switches.
func (s *Service) Items(ctx context.Context, slug string) ([]api.ItemDef, error) {
	ev, _, err := s.event(ctx, slug, nil)
	if err != nil {
		return nil, err
	}
	settings, err := decodeSettings(ev.Settings)
	if err != nil {
		return nil, err
	}
	out := []api.ItemDef{}
	for _, d := range s.cat.All() {
		w := d.Weight
		if v, ok := settings.Weights[d.ID]; ok {
			w = v
		}
		item := api.ItemDef{
			ID: d.ID, Name: d.Name, Concept: d.Concept, Kind: string(d.Kind),
			DefaultWeight: d.Weight, Weight: w, Enabled: !slices.Contains(settings.Disabled, d.ID),
			SpecialGames: []api.SpecialGame{},
		}
		for _, sg := range d.SpecialGames {
			item.SpecialGames = append(item.SpecialGames, api.SpecialGame{Key: sg.Key, Title: sg.Title})
		}
		item.Params = []api.ItemParam{}
		for _, p := range d.Params {
			v := p.Default
			if o, ok := settings.Params[d.ID][p.Name]; ok {
				v = o
			}
			item.Params = append(item.Params, api.ItemParam{Name: p.Name, Label: p.Label, Default: p.Default, Min: p.Min, Max: p.Max, Value: v})
		}
		out = append(out, item)
	}
	return out, nil
}

// --- settings -----------------------------------------------------------------

func decodeSettings(raw []byte) (api.EventSettings, error) {
	var st api.EventSettings
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &st); err != nil {
			return st, fmt.Errorf("events: bad settings: %w", err)
		}
	}
	if st.SpinsByHours == nil {
		st.SpinsByHours = []api.SpinsRow{}
	}
	if st.Weights == nil {
		st.Weights = map[string]int{}
	}
	if st.Disabled == nil {
		st.Disabled = []string{}
	}
	if st.Params == nil {
		st.Params = map[string]map[string]int{}
	}
	return st, nil
}

func (s *Service) cleanSettings(in api.EventSettings) (api.EventSettings, error) {
	out := api.EventSettings{
		StartSpins:   in.StartSpins,
		SpinsByHours: []api.SpinsRow{},
		Weights:      map[string]int{},
		Disabled:     []string{},
		Params:       map[string]map[string]int{},
		WebhookURL:   strings.TrimSpace(in.WebhookURL),
	}
	if out.StartSpins < 1 || out.StartSpins > 20 {
		return out, invalid("стартовых круток должно быть от 1 до 20")
	}
	if len(in.SpinsByHours) > 20 {
		return out, invalid("в таблице круток не больше 20 строк")
	}
	for i, r := range in.SpinsByHours {
		if r.MinHours < 0 || r.Spins < 0 || r.Spins > 20 {
			return out, invalid("таблица круток, строка %d: часы от 0, крутки от 0 до 20", i+1)
		}
		if i > 0 && r.MinHours <= in.SpinsByHours[i-1].MinHours {
			return out, invalid("таблица круток: часы должны возрастать")
		}
		out.SpinsByHours = append(out.SpinsByHours, r)
	}
	for id, w := range in.Weights {
		d := s.cat.Def(id)
		if d == nil {
			return out, invalid("неизвестный предмет %q", id)
		}
		if w < 0 || w > 1000 {
			return out, invalid("вес «%s»: от 0 до 1000", d.Name)
		}
		if w != d.Weight {
			out.Weights[id] = w // store only real overrides
		}
	}
	for _, id := range in.Disabled {
		if s.cat.Def(id) == nil {
			return out, invalid("неизвестный предмет %q", id)
		}
		if !slices.Contains(out.Disabled, id) {
			out.Disabled = append(out.Disabled, id)
		}
	}
	slices.Sort(out.Disabled)
	for id, params := range in.Params {
		d := s.cat.Def(id)
		if d == nil {
			return out, invalid("неизвестный предмет %q", id)
		}
		for name, v := range params {
			p := findParam(d, name)
			if p == nil {
				return out, invalid("у «%s» нет параметра %q", d.Name, name)
			}
			if v < p.Min || v > p.Max {
				return out, invalid("«%s», %s: от %d до %d", d.Name, p.Label, p.Min, p.Max)
			}
			if v != p.Default { // store only real overrides
				if out.Params[id] == nil {
					out.Params[id] = map[string]int{}
				}
				out.Params[id][name] = v
			}
		}
	}
	if out.WebhookURL != "" && !notify.AllowedWebhook(out.WebhookURL) {
		return out, invalid("вебхук должен быть адресом вебхука Discord: https://discord.com/api/webhooks/…")
	}
	return out, nil
}

func findParam(d *game.Def, name string) *game.Param {
	for i := range d.Params {
		if d.Params[i].Name == name {
			return &d.Params[i]
		}
	}
	return nil
}

// --- helpers ------------------------------------------------------------------

func cleanTitle(s string, max int) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" || utf8.RuneCountInString(s) > max {
		return "", invalid("название: от 1 до %d символов", max)
	}
	return s, nil
}

func (s *Service) inTx(ctx context.Context, fn func(q *db.Queries) error) error {
	tx, err := s.st.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit
	if err := fn(s.st.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
