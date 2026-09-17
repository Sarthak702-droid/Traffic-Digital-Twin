package main

import (
	"context"
	"errors"
	"fmt"
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
	token := os.Getenv("DOMAIN_TOKEN")
	gateway := os.Getenv("GATEWAY_INTERNAL_ORIGIN")
	writerToken := os.Getenv("DOMAIN_WRITE_TOKEN")
	if len(token) < 32 || len(writerToken) < 32 || gateway == "" {
		return fmt.Errorf("DOMAIN_TOKEN, DOMAIN_WRITE_TOKEN (32+ characters), GATEWAY_INTERNAL_ORIGIN required")
	}
	app := &httpapi.Server{Network: network, AllowedOrigin: origin, ServiceToken: token, RequireOwner: true}
	if dsn := os.Getenv("READ_DATABASE_URL"); dsn != "" {
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
		var readonly bool
		if e = pool.QueryRow(ctx, "SELECT NOT has_table_privilege(current_user,'scenario_runs','INSERT,UPDATE,DELETE')").Scan(&readonly); e != nil {
			return e
		}
		if !readonly {
			return fmt.Errorf("domain database role must be read-only")
		}
		app.Store = store.New(pool)
		app.Store.Gateway = gateway
		app.Store.Token = writerToken
		if e = app.Store.SaveConfig(ctx, network); e != nil {
			return e
		}
	}
	if app.Store == nil {
		return fmt.Errorf("READ_DATABASE_URL required; all persistence uses the Go writer")
	}
	addr := os.Getenv("API_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8081"
	}
	simCtx, stopSimulation := context.WithCancel(context.Background())
	defer stopSimulation()
	go app.MaintainOwnership(simCtx, "http://"+addr)
	simAddress := os.Getenv("SIMULATION_ADDR")
	if simAddress == "" {
		simAddress = "127.0.0.1:50051"
	}
	if e = app.ConnectSimulation(simCtx, simAddress); e != nil {
		return e
	}
	intAddress := os.Getenv("INTELLIGENCE_ADDR")
	if intAddress == "" {
		intAddress = "127.0.0.1:50052"
	}
	if e = app.ConnectIntelligence(simCtx, intAddress); e != nil {
		return e
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
