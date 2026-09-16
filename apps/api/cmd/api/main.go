package main

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/apps/api/internal/httpapi"
	"traffic.local/twin/apps/api/internal/store"
	"traffic.local/twin/db"
)

func main() {
	if e := run(); e != nil {
		slog.Error("API stopped", "error", e)
		os.Exit(1)
	}
}
func run() error {
	path := os.Getenv("NETWORK_CONFIG")
	if path == "" {
		path = "packages/scenario-config/c1-c6.json"
	}
	network, e := config.Load(path)
	if e != nil {
		return e
	}
	origin := os.Getenv("UI_ORIGIN")
	if origin == "" {
		origin = "http://127.0.0.1:3100"
	}
	app := &httpapi.Server{Network: network, AllowedOrigin: origin}
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		pool, e := pgxpool.New(ctx, dsn)
		if e != nil {
			return e
		}
		defer pool.Close()
		if e = pool.Ping(ctx); e != nil {
			return e
		}
		if e = db.Migrate(ctx, pool); e != nil {
			return e
		}
		app.Store = store.New(pool)
		if e = app.Store.SaveConfig(ctx, network); e != nil {
			return e
		}
	}
	addr := os.Getenv("API_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8081"
	}
	server := &http.Server{Addr: addr, Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() {
		slog.Info("Go API ready", "address", addr, "config", network.ID)
		done <- server.ListenAndServe()
	}()
	select {
	case e := <-done:
		if errors.Is(e, http.ErrServerClosed) {
			return nil
		}
		return e
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
