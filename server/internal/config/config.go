// Package config reads server settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr        string        // MBR_ADDR, address to listen on
	BaseURL     string        // MBR_BASE_URL, public URL of the app, used for OAuth redirects
	DatabaseURL string        // MBR_DATABASE_URL
	SessionTTL  time.Duration // MBR_SESSION_TTL

	DiscordClientID     string // MBR_DISCORD_CLIENT_ID
	DiscordClientSecret string // MBR_DISCORD_CLIENT_SECRET

	// AdminDiscordIDs may create events. MBR_ADMIN_DISCORD_IDS, comma separated.
	AdminDiscordIDs map[string]bool

	// DevLogin enables "log in as any name" without Discord. Never enable in production.
	DevLogin bool // MBR_DEV_LOGIN
}

// DiscordEnabled reports whether Discord OAuth credentials are configured.
func (c Config) DiscordEnabled() bool {
	return c.DiscordClientID != "" && c.DiscordClientSecret != ""
}

// SecureCookies reports whether cookies must be sent over HTTPS only.
func (c Config) SecureCookies() bool {
	return strings.HasPrefix(c.BaseURL, "https://")
}

func Load() (Config, error) {
	return load(os.Getenv)
}

func load(getenv func(string) string) (Config, error) {
	get := func(key, def string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return def
	}

	c := Config{
		Addr:                get("MBR_ADDR", ":8080"),
		BaseURL:             strings.TrimRight(get("MBR_BASE_URL", "http://localhost:8080"), "/"),
		DatabaseURL:         get("MBR_DATABASE_URL", ""),
		DiscordClientID:     get("MBR_DISCORD_CLIENT_ID", ""),
		DiscordClientSecret: get("MBR_DISCORD_CLIENT_SECRET", ""),
		AdminDiscordIDs:     map[string]bool{},
	}

	var errs []error

	ttl, err := time.ParseDuration(get("MBR_SESSION_TTL", "720h"))
	if err != nil || ttl <= 0 {
		errs = append(errs, fmt.Errorf("MBR_SESSION_TTL: invalid duration %q", get("MBR_SESSION_TTL", "")))
	}
	c.SessionTTL = ttl

	if v := get("MBR_DEV_LOGIN", "false"); v != "" {
		dev, err := strconv.ParseBool(v)
		if err != nil {
			errs = append(errs, fmt.Errorf("MBR_DEV_LOGIN: invalid bool %q", v))
		}
		c.DevLogin = dev
	}

	for _, id := range strings.Split(get("MBR_ADMIN_DISCORD_IDS", ""), ",") {
		if id = strings.TrimSpace(id); id != "" {
			c.AdminDiscordIDs[id] = true
		}
	}

	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("MBR_DATABASE_URL is required"))
	}
	if !c.DiscordEnabled() && !c.DevLogin {
		errs = append(errs, errors.New("no way to log in: set MBR_DISCORD_CLIENT_ID and MBR_DISCORD_CLIENT_SECRET, or MBR_DEV_LOGIN=true"))
	}

	return c, errors.Join(errs...)
}
