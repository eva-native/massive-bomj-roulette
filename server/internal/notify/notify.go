// Package notify posts event news to Discord webhooks.
//
// Sending is best effort: messages go through a queue and one worker, after
// the action is already committed. A lost notification is not critical, so
// a full queue drops messages and failures only end up in the log.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	queueSize   = 256
	maxAttempts = 4
	// Discord allows about 5 requests per 2 seconds per webhook.
	minGap = 400 * time.Millisecond
)

// AllowedWebhook reports whether a URL is a Discord webhook. Only those are
// accepted, so the server never posts to arbitrary addresses.
func AllowedWebhook(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	okHost := host == "discord.com" || host == "discordapp.com" || host == "ptb.discord.com" || host == "canary.discord.com"
	return okHost && strings.HasPrefix(u.Path, "/api/webhooks/")
}

type message struct {
	webhook string
	text    string
}

type Notifier struct {
	queue  chan message
	client *http.Client
	log    *slog.Logger
	sleep  func(time.Duration)
	// allow decides which URLs may be called; tests point it at a fake server.
	allow func(string) bool
}

func New(log *slog.Logger) *Notifier {
	return &Notifier{
		queue:  make(chan message, queueSize),
		client: &http.Client{Timeout: 10 * time.Second},
		log:    log,
		sleep:  time.Sleep,
		allow:  AllowedWebhook,
	}
}

// Send queues a message for the webhook. It never blocks.
func (n *Notifier) Send(webhook, text string) {
	if webhook == "" || text == "" || !n.allow(webhook) {
		return
	}
	select {
	case n.queue <- message{webhook: webhook, text: text}:
	default:
		n.log.Warn("notify: queue full, message dropped")
	}
}

// Run delivers queued messages until ctx is done.
func (n *Notifier) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-n.queue:
			if err := n.deliver(ctx, m); err != nil {
				n.log.Warn("notify: discord webhook", "err", err)
			}
			n.sleep(minGap)
		}
	}
}

func (n *Notifier) deliver(ctx context.Context, m message) error {
	body, _ := json.Marshal(map[string]any{
		"content":          truncate(m.text, 2000),
		"username":         "MBR",
		"allowed_mentions": map[string]any{"parse": []string{}}, // never ping anyone
	})
	var lastErr error
	for attempt := range maxAttempts {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.webhook, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := n.client.Do(req)
		if err != nil {
			lastErr = err
			n.sleep(backoff(attempt))
			continue
		}
		resp.Body.Close()
		switch {
		case resp.StatusCode < 300:
			return nil
		case resp.StatusCode == http.StatusTooManyRequests:
			lastErr = fmt.Errorf("rate limited")
			n.sleep(retryAfter(resp.Header.Get("Retry-After"), backoff(attempt)))
		case resp.StatusCode >= 500:
			lastErr = fmt.Errorf("discord: %s", resp.Status)
			n.sleep(backoff(attempt))
		default:
			// 4xx other than 429: the webhook is wrong or deleted; retrying will not help.
			return fmt.Errorf("discord: %s", resp.Status)
		}
	}
	return fmt.Errorf("gave up after %d attempts: %w", maxAttempts, lastErr)
}

func backoff(attempt int) time.Duration { return time.Duration(1<<attempt) * time.Second }

func retryAfter(header string, fallback time.Duration) time.Duration {
	if s, err := strconv.ParseFloat(header, 64); err == nil && s >= 0 && s < 60 {
		return time.Duration(s * float64(time.Second))
	}
	return fallback
}

func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}
