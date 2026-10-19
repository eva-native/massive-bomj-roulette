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
