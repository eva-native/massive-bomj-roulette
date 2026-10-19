// Package api holds request and response types of the HTTP API.
// tygo generates web/src/api/types.gen.ts from this package.
package api

// ErrorResponse is the body of every non-2xx JSON response.
type ErrorResponse struct {
	Error string `json:"error"`
}

// AppConfig tells the frontend which login methods are available.
type AppConfig struct {
	DiscordLogin bool `json:"discordLogin"`
	DevLogin     bool `json:"devLogin"`
}

// Me is the logged-in user.
type Me struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
	IsAdmin   bool   `json:"isAdmin"`
}

type DevLoginRequest struct {
	Name string `json:"name"`
}

// --- events -------------------------------------------------------------------

// EventSummary is one row of the events list.
type EventSummary struct {
	Slug          string `json:"slug"`
	Title         string `json:"title"`
	Status        string `json:"status"` // "active" | "finished"
	Participants  int    `json:"participants"`
	IsParticipant bool   `json:"isParticipant"`
	IsJudge       bool   `json:"isJudge"`
}

type CreateEventRequest struct {
	Title string `json:"title"`
	Slug  string `json:"slug"`
}

// EventSettings are the rule parameters of an event.
type EventSettings struct {
	// Spins of the effects-and-bonuses wheel at the start of the event.
	StartSpins int `json:"startSpins"`
	// Spins after a completed game by its HLTB hours; the last row with
	// minHours <= hours wins. Empty means 1 spin.
	SpinsByHours []SpinsRow `json:"spinsByHours"`
	// Item weight overrides by item id.
	Weights map[string]int `json:"weights"`
	// Items switched off for this event.
	Disabled []string `json:"disabled"`
	// Discord webhook for notifications; visible to judges only.
	WebhookURL string `json:"webhookUrl,omitempty"`
}

type SpinsRow struct {
	MinHours int `json:"minHours"`
	Spins    int `json:"spins"`
}

type Member struct {
	UserID        int64  `json:"userId"`
	Name          string `json:"name"`
	AvatarURL     string `json:"avatarUrl"`
	IsParticipant bool   `json:"isParticipant"`
	IsJudge       bool   `json:"isJudge"`
}

// Membership is the current user's roles in an event.
type Membership struct {
	IsParticipant bool `json:"isParticipant"`
	IsJudge       bool `json:"isJudge"`
}

type EventDetail struct {
	Slug     string        `json:"slug"`
	Title    string        `json:"title"`
	Status   string        `json:"status"`
	Settings EventSettings `json:"settings"`
	Members  []Member      `json:"members"`
	// Me is null when the current user is not a member (or not logged in).
	Me *Membership `json:"me" tstype:"Membership | null,required"`
}

// UpdateEventRequest changes only the fields that are set.
type UpdateEventRequest struct {
	Title    *string        `json:"title,omitempty"`
	Settings *EventSettings `json:"settings,omitempty"`
}

// UpdateMemberRequest changes only the roles that are set. A member without
// any role is removed from the event.
type UpdateMemberRequest struct {
	IsParticipant *bool `json:"isParticipant,omitempty"`
	IsJudge       *bool `json:"isJudge,omitempty"`
}

// ItemDef is an item of the catalog with the event's settings.
type ItemDef struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	Concept       string        `json:"concept"`
	Kind          string        `json:"kind"` // "effect" | "bonus" | "drop"
	DefaultWeight int           `json:"defaultWeight"`
	Weight        int           `json:"weight"`
	Enabled       bool          `json:"enabled"`
	SpecialGames  []SpecialGame `json:"specialGames"`
}

type SpecialGame struct {
	Key   string `json:"key"`
	Title string `json:"title"`
}

// --- games and movies -----------------------------------------------------------

type GameInput struct {
	Title     string `json:"title"`
	HLTBHours int    `json:"hltbHours"`
	Rating    int    `json:"rating"`
	Year      int    `json:"year"`
	// SpecialKey marks a game provided by an item; judges only. Empty for
	// regular games.
	SpecialKey string `json:"specialKey"`
}

type Game struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	HLTBHours   int    `json:"hltbHours"`
	Rating      int    `json:"rating"`
	Year        int    `json:"year"`
	SpecialKey  string `json:"specialKey"`
	BasePoints  int    `json:"basePoints"`
	AddedBy     int64  `json:"addedBy"`
	AddedByName string `json:"addedByName"`
}

type MovieInput struct {
	Title string `json:"title"`
}

type Movie struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	AddedBy     int64  `json:"addedBy"`
	AddedByName string `json:"addedByName"`
}

// --- play ---------------------------------------------------------------------

// PlayerView is everything about one player's game in an event: the current
// turn, items, pocket, history and points. The UI draws the turn from it
// without knowing the rules.
type PlayerView struct {
	Player PlayerRef `json:"player"`
	// CanAct is true when the viewer is this player and may take the
	// current step.
	CanAct bool      `json:"canAct"`
	Turn   *TurnView `json:"turn" tstype:"TurnView | null,required"`
	// Pocket holds bonuses kept for later.
	Pocket  []ItemView        `json:"pocket"`
	History []PlaythroughView `json:"history"`
	Points  int               `json:"points"`
	Entries []PointEntry      `json:"entries"`
}

type PlayerRef struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
}

type TurnView struct {
	ID     int64      `json:"id"`
	Number int        `json:"number"`
	Reason string     `json:"reason"` // "start" | "completed" | "dropped"
	Steps  []StepView `json:"steps"`
	// Current is the step to take now; null while waiting for the judge.
	Current *StepView `json:"current" tstype:"StepView | null,required"`
	// Wheel is set when the current step is a spin.
	Wheel       *WheelView       `json:"wheel" tstype:"WheelView | null,required"`
	Playthrough *PlaythroughView `json:"playthrough" tstype:"PlaythroughView | null,required"`
	// Items work on this turn's game: rolled effects, the drop debuff,
	// bonuses used on it and multi-game items still running.
	Items []ItemView `json:"items"`
	// Waiting explains why nothing can be done right now, if so.
	Waiting string `json:"waiting"`
}

type StepView struct {
	ID   int64  `json:"id"`
	Kind string `json:"kind"` // spin_items | spin_drop | choose_player | spin_game | choose_game | spin_movie | play
	Done bool   `json:"done"`
	// Result is a short label of what happened ("ОПАААА", a game title…).
	Result string `json:"result"`
	// AddedBy names the item that added the step, if any.
	AddedBy string `json:"addedBy"`
	// Options for choose_game and choose_player.
	Options []Option `json:"options"`
}

type Option struct {
	ID    int64  `json:"id"`
	Label string `json:"label"`
}

type WheelView struct {
	Kind    string   `json:"kind"` // items | drops | games | movies
	Sectors []Sector `json:"sectors"`
}

type Sector struct {
	Label  string `json:"label"`
	Weight int    `json:"weight"`
	// Kind of the item for item wheels ("effect" | "bonus" | "drop"), empty otherwise.
	Kind string `json:"kind"`
}

type PlaythroughView struct {
	ID         int64   `json:"id"`
	GameID     int64   `json:"gameId"`
	Game       string  `json:"game"`
	HLTBHours  int     `json:"hltbHours"`
	BasePoints int     `json:"basePoints"`
	Outcome    string  `json:"outcome"` // "" | "completed" | "dropped"
	Hours      float64 `json:"hours"`
	Proof      string  `json:"proof"`
	Confirmed  bool    `json:"confirmed"`
	Points     int     `json:"points"`
}

type ItemView struct {
	ID        int64  `json:"id"`
	DefID     string `json:"defId"`
	Name      string `json:"name"`
	Concept   string `json:"concept"`
	Kind      string `json:"kind"`
	Placement string `json:"placement"` // pending | pocket | attached | used
	Blocked   bool   `json:"blocked"`
	// Status describes multi-game items: "2 из 3".
	Status string `json:"status"`
	// Note is the item's own remark: "Часть 2", the rolled movie, the chosen friend.
	Note         string      `json:"note"`
	Fields       []FieldView `json:"fields"`
	NeedsConfirm bool        `json:"needsConfirm"`
	Confirmed    bool        `json:"confirmed"`
	Rejected     bool        `json:"rejected"`
	// UseLabel is set for items that can be used by hand; CanUse says
	// whether it is possible right now, UseHint why not.
	UseLabel string `json:"useLabel"`
	CanUse   bool   `json:"canUse"`
	UseHint  string `json:"useHint"`
}

type FieldView struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Type     string `json:"type"` // bool | int | text | url | player | players
	By       string `json:"by"`   // player | judge
	Optional bool   `json:"optional"`
	Value    any    `json:"value"`
}

type PointEntry struct {
	Game   string `json:"game"`
	Label  string `json:"label"`
	Points int    `json:"points"`
	// From names the player whose game gave these points, if not one's own.
	From string `json:"from"`
}

// SpinResult tells the UI where the wheel stops.
type SpinResult struct {
	Wheel  WheelView  `json:"wheel"`
	Result int        `json:"result"` // index into wheel.sectors
	Label  string     `json:"label"`
	View   PlayerView `json:"view"`
}

type ChooseRequest struct {
	Choice int64 `json:"choice"`
}

type FinishRequest struct {
	Outcome string  `json:"outcome"` // "completed" | "dropped"
	Hours   float64 `json:"hours"`
	Proof   string  `json:"proof"`
}

type InputRequest struct {
	Values map[string]any `json:"values"`
}

type ConfirmRequest struct {
	Accept bool `json:"accept"`
}

// LeaderboardRow is one player's standing.
type LeaderboardRow struct {
	Player    PlayerRef `json:"player"`
	Points    int       `json:"points"`
	Completed int       `json:"completed"`
	Dropped   int       `json:"dropped"`
	// Playing is the title of the current game, if any.
	Playing string `json:"playing"`
}

// QueueEntry is something waiting for a judge.
type QueueEntry struct {
	Kind   string    `json:"kind"` // "playthrough" | "item"
	ID     int64     `json:"id"`
	Player PlayerRef `json:"player"`
	Title  string    `json:"title"`
	// For playthroughs.
	Playthrough *PlaythroughView `json:"playthrough" tstype:"PlaythroughView | null,required"`
	// For items.
	Item *ItemView `json:"item" tstype:"ItemView | null,required"`
	Game string    `json:"game"`
}

type ActivityEntry struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	Message   string `json:"message"`
	ActorName string `json:"actorName"`
	CreatedAt string `json:"createdAt"`
}
