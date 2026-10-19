package notify

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestAllowedWebhook(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://discord.com/api/webhooks/1/abc":        true,
		"https://discordapp.com/api/webhooks/1/abc":     true,
		"https://canary.discord.com/api/webhooks/1/abc": true,
		"http://discord.com/api/webhooks/1/abc":         false, // not https
		"https://discord.com/channels/1":                false, // not a webhook
		"https://evil.example/api/webhooks/1/abc":       false,
		"https://discord.com.evil.example/api/webhooks": false,
		"https://user@discord.com/api/webhooks/1/abc":   false,
		"not a url": false,
	} {
		if got := AllowedWebhook(raw); got != want {
			t.Errorf("AllowedWebhook(%q) = %v, want %v", raw, got, want)
		}
	}
}

// fakeDiscord answers with the queued statuses, then 204, and records bodies.
type fakeDiscord struct {
	mu       sync.Mutex
	statuses []int
	bodies   []map[string]any
}

func (f *fakeDiscord) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var body map[string]any
	b, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(b, &body)
	f.bodies = append(f.bodies, body)
	status := http.StatusNoContent
	if len(f.statuses) > 0 {
		status, f.statuses = f.statuses[0], f.statuses[1:]
	}
	if status == http.StatusTooManyRequests {
		w.Header().Set("Retry-After", "0.01")
	}
	w.WriteHeader(status)
}

func (f *fakeDiscord) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.bodies)
}

func newTestNotifier(t *testing.T) (*Notifier, *[]time.Duration) {
	n := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	var mu sync.Mutex
	slept := &[]time.Duration{}
	n.sleep = func(d time.Duration) { mu.Lock(); *slept = append(*slept, d); mu.Unlock() }
	n.allow = func(string) bool { return true }
	return n, slept
}

func TestDeliverRetriesRateLimitsAndServerErrors(t *testing.T) {
	fake := &fakeDiscord{statuses: []int{429, 502}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	n, slept := newTestNotifier(t)

	if err := n.deliver(context.Background(), message{webhook: srv.URL, text: "Алиса крутит колесо игр: GTA"}); err != nil {
		t.Fatal(err)
	}
	if fake.calls() != 3 {
		t.Fatalf("calls = %d, want 3 (429, 502, then ok)", fake.calls())
	}
	if (*slept)[0] != 10*time.Millisecond {
		t.Errorf("first wait = %v, want Retry-After 10ms", (*slept)[0])
	}
	body := fake.bodies[2]
	if body["content"] != "Алиса крутит колесо игр: GTA" || body["username"] != "MBR" {
		t.Errorf("body = %v", body)
	}
	if parse := body["allowed_mentions"].(map[string]any)["parse"].([]any); len(parse) != 0 {
		t.Errorf("mentions must be off: %v", parse)
	}
}

func TestDeliverGivesUpOnClientErrors(t *testing.T) {
	fake := &fakeDiscord{statuses: []int{404}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	n, _ := newTestNotifier(t)
	if err := n.deliver(context.Background(), message{webhook: srv.URL, text: "x"}); err == nil || fake.calls() != 1 {
		t.Fatalf("err = %v, calls = %d; want one call and an error", err, fake.calls())
	}
}

func TestRunDeliversQueuedMessages(t *testing.T) {
	fake := &fakeDiscord{}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	n, _ := newTestNotifier(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go n.Run(ctx)

	n.Send(srv.URL, "one")
	n.Send(srv.URL, "two")
	n.Send("", "ignored")
	deadline := time.Now().Add(3 * time.Second)
	for fake.calls() < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if fake.calls() != 2 {
		t.Fatalf("calls = %d, want 2", fake.calls())
	}
}

func TestSendSkipsForeignURLs(t *testing.T) {
	n := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	n.Send("https://evil.example/hook", "x")
	if len(n.queue) != 0 {
		t.Fatal("a non-Discord URL was queued")
	}
	if got := truncate("абвгд", 3); got != "аб…" {
		t.Errorf("truncate = %q", got)
	}
}
