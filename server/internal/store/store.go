package store

import "github.com/eva-native/massive-bomj-roulette/server/internal/domain"

type LeaderRow struct {
	PlayerID int64  `json:"player_id"`
	Name     string `json:"name"`
	Points   int    `json:"points"`
}

type Store interface {
	ListPlayers() []domain.Player
	GetPlayer(id int64) (domain.Player, bool)
	ListGames() []domain.Game
	GamesByOwner(id int64) []domain.Game
	GetGame(id int64) (domain.Game, bool)
	ListEffects(kind domain.EffectKind) []domain.EffectDef
	GetEffect(id int64) (domain.EffectDef, bool)
	ListBonuses() []domain.BonusDef
	GetBonus(id int64) (domain.BonusDef, bool)

	CreatePlaythrough(p domain.Playthrough) (domain.Playthrough, error)
	GetPlaythrough(id int64) (domain.Playthrough, bool)
	UpdatePlaythrough(p domain.Playthrough) error
	PlaythroughByPlayer(player_id int64) []domain.Playthrough
	AllPlaythrough() []domain.Playthrough

	AddPocketBonus(player_id int64, def_id int64) (domain.PocketBonus, error)
	PocketByPlayer(player_id int64, only_unspent bool) []domain.PocketBonus
	GetPocketBonus(id int64) (domain.PocketBonus, bool)
	SpentPocketBonus(pocket_id int64, playthrough_id int64) error

	ReplaceEntries(playthrough_id int64, entries []domain.PointEntry) error
	EntriesByPlayer(player_id int64) []domain.PointEntry
	Leaderboard() []LeaderRow

	BestCompletion(gameID int64) (playerID int64, ok bool)
}
