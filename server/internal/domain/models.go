package domain

import "time"

type Status string

const (
	StatusInProgress Status = "in_progress"
	StatusCompleted  Status = "completed"
	StatusDropped    Status = "dropped"
)

type EffectKind string

const (
	KindEffect EffectKind = "effect"
	KindDrop   EffectKind = "drop"
)

type PointSource string

const (
	SourceCompletion PointSource = "completion"  // стандартные очки игры (часы+рейтинг+год)
	SourceSpeed      PointSource = "speed"       // (HLTB-часы − время игрока)
	SourceEffect     PointSource = "effect"      // итог эффекта/мини-игры
	SourceBonus      PointSource = "bonus"       // итог бонуса
	SourceRecord     PointSource = "record"      // +1 за быстрейшее прохождение
	SourceDrop       PointSource = "drop"        // штраф за дроп (−50%)
	SourceDropDebuff PointSource = "drop_debuff" // итог дроп-дебаффа
	SourceAssist     PointSource = "assist"      // доля очков напарнику (на будущее)
)

type Player struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type Game struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	OwnerID   int64  `json:"owner_id"`
	HLTBHours int    `json:"hltb_hours"`
	Rating    int    `json:"rating"`
	Year      int    `json:"year"`
}

type EffectDef struct {
	ID      int64      `json:"id"`
	Name    string     `json:"name"`
	Concept string     `json:"string"`
	Kind    EffectKind `json:"kind"`
	Points  int        `json:"points"`
	IsRange bool       `json:"is_range"`
	Weight  int        `json:"weight"`
}

type BonusDef struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Concept string `json:"string"`
	Points  int    `json:"points"`
	Weight  int    `json:"weight"`
}

type AppliedEffect struct {
	DefID    int64 `json:"def_id"`
	Resolved int   `json:"resolved"`
}

type AppliedBonus struct {
	DefID           int64   `json:"def_id"`
	Resolved        int     `json:"resolved"`
	AffectsPlayerID *int64  `json:"affects_player_id,omitempty"`
	AffectShare     float64 `json:"affects_share,omitempty"`
}

type Playthrough struct {
	ID         int64          `json:"id"`
	PlayerID   int64          `json:"player_id"`
	GameID     int64          `json:"game_id"`
	Status     Status         `json:"status"`
	TimeSpent  time.Duration  `json:"-"`
	TimeSpentS string         `json:"time_spent"`
	Effect     *AppliedEffect `json:"effect,omitempty"`
	Bonus      *AppliedBonus  `json:"bonus,omitempty"`
	DropDebuff *AppliedEffect `json:"drop_debuff,omitempty"`
	IsRecord   bool           `json:"is_record"`
	CreatedAt  time.Time      `json:"created_at"`
}

type PocketBonus struct {
	ID       int64  `json:"id"`
	PlayerID int64  `json:"player_id"`
	DefID    int64  `json:"def_id"`
	SpentOn  *int64 `json:"spent_on,omitempty"`
}

type PointEntry struct {
	ID             int64       `json:"id"`
	PlayerID       int64       `json:"player_id"`
	PlaythroughID  int64       `json:"playthrough_id"`
	Source         PointSource `json:"source"`
	Points         int         `json:"points"`
	SourcePlayerId *int64      `json:"source_player_id,omitempty"`
}
