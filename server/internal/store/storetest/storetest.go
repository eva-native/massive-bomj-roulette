// Package storetest gives each test its own migrated PostgreSQL database.
//
// Set MBR_TEST_DATABASE_URL to a server where the user may create databases,
// e.g. postgres://mbr:mbr@localhost:5432/postgres?sslmode=disable.
// Without it, tests that need a database are skipped.
package storetest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/eva-native/massive-bomj-roulette/server/internal/store"
)

const envURL = "MBR_TEST_DATABASE_URL"

// New creates a fresh database, applies migrations and drops it when the test ends.
func New(t testing.TB) *store.Store {
	t.Helper()
	adminURL := os.Getenv(envURL)
	if adminURL == "" {
		t.Skipf("%s is not set; skipping database test", envURL)
	}
	ctx := context.Background()

	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatalf("storetest: connect: %v", err)
	}
	defer admin.Close(ctx)

	name := "mbr_test_" + randomSuffix(t)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		t.Fatalf("storetest: create database: %v", err)
	}

	u, err := url.Parse(adminURL)
	if err != nil {
		t.Fatalf("storetest: parse %s: %v", envURL, err)
	}
	u.Path = "/" + name

	s, err := store.Open(ctx, u.String())
	if err != nil {
		t.Fatalf("storetest: open: %v", err)
	}
	t.Cleanup(func() {
		s.Close()
		conn, err := pgx.Connect(context.Background(), adminURL)
		if err != nil {
			t.Logf("storetest: cleanup connect: %v", err)
			return
		}
		defer conn.Close(context.Background())
		if _, err := conn.Exec(context.Background(), "DROP DATABASE IF EXISTS "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)"); err != nil {
			t.Logf("storetest: drop database: %v", err)
		}
	})

	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("storetest: migrate: %v", err)
	}
	return s
}

func randomSuffix(t testing.TB) string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("storetest: random: %v", err)
	}
	return hex.EncodeToString(b)
}
