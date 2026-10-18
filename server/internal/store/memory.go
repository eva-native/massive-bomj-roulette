package store

import (
	"errors"
	"sort"
	"sync"

	"github.com/eva-native/massive-bomj-roulette/server/internal/domain"
)

type Memory struct {
	mtx sync.RWMutex

	players map[int64]domain.Player
	games   map[int64]domain.Game
	effects map[int64]domain.EffectDef
	bonuses map[int64]domain.BonusDef

	playthroughs map[int64]domain.Playthrough
	pocket       map[int64]domain.PocketBonus
	entries      map[int64][]domain.PointEntry

	seq struct {
		playthrough int64
		pocket      int64
		entry       int64
	}
}

// AllPlaythrough implements [Store].
func (m *Memory) AllPlaythrough() []domain.Playthrough {
	panic("unimplemented")
}

// PlaythroughByPlayer implements [Store].
func (m *Memory) PlaythroughByPlayer(player_id int64) []domain.Playthrough {
	panic("unimplemented")
}

// SpentPocketBonus implements [Store].
func (m *Memory) SpentPocketBonus(pocket_id int64, playthrough_id int64) error {
	panic("unimplemented")
}

func NewMemory() *Memory {
	return &Memory{
		players:      map[int64]domain.Player{},
		games:        map[int64]domain.Game{},
		effects:      map[int64]domain.EffectDef{},
		bonuses:      map[int64]domain.BonusDef{},
		playthroughs: map[int64]domain.Playthrough{},
		pocket:       map[int64]domain.PocketBonus{},
		entries:      map[int64][]domain.PointEntry{},
	}
}

func (m *Memory) SeedPlayer(p domain.Player) {
	m.players[p.ID] = p
}

func (m *Memory) SeedGame(g domain.Game) {
	m.games[g.ID] = g
}

func (m *Memory) SeedEffect(e domain.EffectDef) {
	m.effects[e.ID] = e
}

func (m *Memory) SeedBonus(b domain.BonusDef) {
	m.bonuses[b.ID] = b
}

func (m *Memory) ListPlayers() []domain.Player {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	out := make([]domain.Player, 0, len(m.players))
	for _, p := range m.players {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (m *Memory) GetPlayer(id int64) (domain.Player, bool) {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	p, ok := m.players[id]
	return p, ok
}

func (m *Memory) ListGames() []domain.Game {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	out := make([]domain.Game, 0, len(m.games))
	for _, g := range m.games {
		out = append(out, g)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (m *Memory) GamesByOwner(player_id int64) []domain.Game {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	var out []domain.Game
	for _, g := range m.games {
		if g.OwnerID == player_id {
			out = append(out, g)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (m *Memory) GetGame(id int64) (domain.Game, bool) {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	g, ok := m.games[id]
	return g, ok
}

func (m *Memory) ListEffects(kind domain.EffectKind) []domain.EffectDef {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	var out []domain.EffectDef
	for _, e := range m.effects {
		if e.Kind == kind {
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (m *Memory) GetEffect(id int64) (domain.EffectDef, bool) {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	e, ok := m.effects[id]
	return e, ok
}

func (m *Memory) ListBonuses() []domain.BonusDef {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	out := make([]domain.BonusDef, 0, len(m.bonuses))
	for _, b := range m.bonuses {
		out = append(out, b)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (m *Memory) GetBonus(id int64) (domain.BonusDef, bool) {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	b, ok := m.bonuses[id]
	return b, ok
}

func (m *Memory) CreatePlaythrough(p domain.Playthrough) (domain.Playthrough, error) {
	m.mtx.Lock()
	defer m.mtx.Unlock()
	m.seq.playthrough++
	p.ID = m.seq.playthrough
	m.playthroughs[p.ID] = p
	return p, nil
}

func (m *Memory) GetPlaythrough(id int64) (domain.Playthrough, bool) {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	p, ok := m.playthroughs[id]
	return p, ok
}

func (m *Memory) UpdatePlaythrough(p domain.Playthrough) error {
	m.mtx.Lock()
	defer m.mtx.Unlock()
	if _, ok := m.playthroughs[p.ID]; !ok {
		return errors.New("playthrough not found")
	}
	m.playthroughs[p.ID] = p
	return nil
}

func (m *Memory) PlaythroughsByPlayer(player_id int64) []domain.Playthrough {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	var out []domain.Playthrough
	for _, p := range m.playthroughs {
		if p.PlayerID == player_id {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (m *Memory) AllPlaythroughs() []domain.Playthrough {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	out := make([]domain.Playthrough, 0, len(m.playthroughs))
	for _, p := range m.playthroughs {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (m *Memory) AddPocketBonus(player_id, def_id int64) (domain.PocketBonus, error) {
	m.mtx.Lock()
	defer m.mtx.Unlock()
	m.seq.pocket++
	pb := domain.PocketBonus{ID: m.seq.pocket, PlayerID: player_id, DefID: def_id}
	m.pocket[pb.ID] = pb
	return pb, nil
}

func (m *Memory) PocketByPlayer(player_id int64, only_unspent bool) []domain.PocketBonus {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	var out []domain.PocketBonus
	for _, pb := range m.pocket {
		if pb.PlayerID != player_id {
			continue
		}
		if only_unspent && pb.SpentOn != nil {
			continue
		}
		out = append(out, pb)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (m *Memory) GetPocketBonus(id int64) (domain.PocketBonus, bool) {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	pb, ok := m.pocket[id]
	return pb, ok
}

func (m *Memory) SpendPocketBonus(pocket_id, playthrough_id int64) error {
	m.mtx.Lock()
	defer m.mtx.Unlock()
	pb, ok := m.pocket[pocket_id]
	if !ok {
		return errors.New("pocket bonus not found")
	}
	if pb.SpentOn != nil {
		return errors.New("bonus already spent")
	}
	pb.SpentOn = &playthrough_id
	m.pocket[pocket_id] = pb
	return nil
}

func (m *Memory) ReplaceEntries(playthrough_id int64, entries []domain.PointEntry) error {
	m.mtx.Lock()
	defer m.mtx.Unlock()
	for i := range entries {
		m.seq.entry++
		entries[i].ID = m.seq.entry
	}
	m.entries[playthrough_id] = entries
	return nil
}

func (m *Memory) EntriesByPlayer(player_id int64) []domain.PointEntry {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	var out []domain.PointEntry
	for _, list := range m.entries {
		for _, e := range list {
			if e.PlayerID == player_id {
				out = append(out, e)
			}
		}
	}
	return out
}

func (m *Memory) Leaderboard() []LeaderRow {
	m.mtx.RLock()
	defer m.mtx.RUnlock()

	totals := map[int64]int{}
	for _, list := range m.entries {
		for _, e := range list {
			totals[e.PlayerID] += e.Points
		}
	}
	rows := make([]LeaderRow, 0, len(m.players))
	for id, p := range m.players {
		rows = append(rows, LeaderRow{PlayerID: id, Name: p.Name, Points: totals[id]})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Points != rows[j].Points {
			return rows[i].Points > rows[j].Points // больше очков — выше
		}
		return rows[i].Name < rows[j].Name
	})
	return rows
}

func (m *Memory) BestCompletion(game_id int64) (int64, bool) {
	m.mtx.RLock()
	defer m.mtx.RUnlock()
	var bestPlayer int64
	var bestTime int64 = -1
	for _, p := range m.playthroughs {
		if p.GameID != game_id || p.Status != domain.StatusCompleted {
			continue
		}
		t := int64(p.TimeSpent)
		if bestTime < 0 || t < bestTime {
			bestTime = t
			bestPlayer = p.PlayerID
		}
	}
	return bestPlayer, bestTime >= 0
}

