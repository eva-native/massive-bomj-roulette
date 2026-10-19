// Command mbr runs the MBR web server.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/eva-native/massive-bomj-roulette/server/internal/auth"
	"github.com/eva-native/massive-bomj-roulette/server/internal/config"
	"github.com/eva-native/massive-bomj-roulette/server/internal/events"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game/items"
	"github.com/eva-native/massive-bomj-roulette/server/internal/httpapi"
	"github.com/eva-native/massive-bomj-roulette/server/internal/live"
	"github.com/eva-native/massive-bomj-roulette/server/internal/play"
	"github.com/eva-native/massive-bomj-roulette/server/internal/store"
	"github.com/eva-native/massive-bomj-roulette/server/internal/webui"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(log); err != nil {
		log.Error("mbr: fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	if cfg.DevLogin {
		log.Warn("MBR_DEV_LOGIN is on: anyone can log in as any name. Never use this in production.")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		return err
	}

	catalog, err := items.NewCatalog()
	if err != nil {
		return err
	}
	authSvc := auth.New(st, cfg, log)
	go cleanupSessions(ctx, authSvc, log)

	broker := live.NewBroker()
	playSvc := play.New(st, game.NewEngine(catalog, nil), broker)
	eventsSvc := events.New(st, catalog)
	eventsSvc.SetGameUsage(playSvc)

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: httpapi.New(httpapi.Deps{
			Config: cfg, Store: st, Auth: authSvc, Events: eventsSvc, Play: playSvc, Live: broker, Log: log, Web: webui.FS(),
		}).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("mbr: listening", "addr", cfg.Addr, "url", cfg.BaseURL)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Info("mbr: shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
	}
	return nil
}

func cleanupSessions(ctx context.Context, a *auth.Service, log *slog.Logger) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if n, err := a.CleanupExpired(ctx); err != nil {
				log.Warn("mbr: cleanup sessions", "err", err)
			} else if n > 0 {
				log.Info("mbr: removed expired sessions", "count", n)
			}
		}
	}
}
