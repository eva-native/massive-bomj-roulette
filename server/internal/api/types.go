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
