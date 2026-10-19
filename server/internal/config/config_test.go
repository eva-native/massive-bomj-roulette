package config

import (
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoadDefaults(t *testing.T) {
	c, err := load(env(map[string]string{
		"MBR_DATABASE_URL": "postgres://localhost/mbr",
		"MBR_DEV_LOGIN":    "true",
	}))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if c.Addr != ":8080" || c.BaseURL != "http://localhost:8080" || c.SessionTTL != 720*time.Hour {
		t.Errorf("unexpected defaults: %+v", c)
	}
	if c.DiscordEnabled() || !c.DevLogin || c.SecureCookies() {
		t.Errorf("unexpected flags: %+v", c)
	}
}

func TestLoadAdminsAndHTTPS(t *testing.T) {
	c, err := load(env(map[string]string{
		"MBR_DATABASE_URL":          "postgres://localhost/mbr",
		"MBR_BASE_URL":              "https://mbr.example.com/",
		"MBR_DISCORD_CLIENT_ID":     "id",
		"MBR_DISCORD_CLIENT_SECRET": "secret",
		"MBR_ADMIN_DISCORD_IDS":     " 111, 222 ,,",
	}))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if c.BaseURL != "https://mbr.example.com" || !c.SecureCookies() || !c.DiscordEnabled() {
		t.Errorf("unexpected config: %+v", c)
	}
	if len(c.AdminDiscordIDs) != 2 || !c.AdminDiscordIDs["111"] || !c.AdminDiscordIDs["222"] {
		t.Errorf("admins = %v, want 111 and 222", c.AdminDiscordIDs)
	}
}

func TestLoadErrors(t *testing.T) {
	_, err := load(env(map[string]string{"MBR_SESSION_TTL": "forever"}))
	if err == nil {
		t.Fatal("expected error")
	}
	for _, want := range []string{"MBR_DATABASE_URL", "MBR_SESSION_TTL", "no way to log in"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not mention %q", err, want)
		}
	}
}
