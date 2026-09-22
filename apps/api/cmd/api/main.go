package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/apps/api/internal/httpapi"
	"traffic.local/twin/apps/api/internal/store"
	"traffic.local/twin/db"
)

func loadEnvFallback() {
	dir, err := os.Getwd()
	if err != nil {
		return
	}
	var envPath string
	var scenarioPath string
	for {
		candidate := filepath.Join(dir, ".runtime", "local-env.json")
		if _, err := os.Stat(candidate); err == nil && envPath == "" {
			envPath = candidate
		}
		scCandidate := filepath.Join(dir, "packages", "scenario-config", "c1-c6.json")
		if _, err := os.Stat(scCandidate); err == nil && scenarioPath == "" {
			scenarioPath = scCandidate
		}
		if envPath != "" && scenarioPath != "" {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	if scenarioPath != "" && os.Getenv("NETWORK_CONFIG") == "" {
		_ = os.Setenv("NETWORK_CONFIG", scenarioPath)
	}

	if envPath != "" {
		data, err := os.ReadFile(envPath)
		if err == nil {
			var envMap map[string]string
			if err := json.Unmarshal(data, &envMap); err == nil {
				for k, v := range envMap {
					if os.Getenv(k) == "" {
						_ = os.Setenv(k, v)
					}
				}
			}
		}
	}
}

func main() {
	loadEnvFallback()
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
	computeToken := os.Getenv("COMPUTE_TOKEN")
	if len(computeToken) < 32 {
		return fmt.Errorf("COMPUTE_TOKEN (32+ characters) required")
	}
	app := &httpapi.Server{ComputeToken: computeToken, Network: network, AllowedOrigin: origin}
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
	if app.Store == nil {
		return fmt.Errorf("DATABASE_URL required; Go owns durable persistence")
	}
	// PostgreSQL is the durable authority for the single active-run lease. Start
	// it before subscribing to private compute so a standby gateway never owns
	// a stream or stateful command by accident.
	app.Lease = httpapi.NewLeaseManager(app)
	addr := os.Getenv("API_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8081"
	}
	simCtx, stopSimulation := context.WithCancel(context.Background())
	defer stopSimulation()
	app.Lease.Start(simCtx)
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
	var listener net.Listener
	for attempt := 0; attempt < 15; attempt++ {
		listener, e = net.Listen("tcp", addr)
		if e == nil {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if e != nil {
		return e
	}
	defer listener.Close()

	server := &http.Server{Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() {
		slog.Info("Go API ready", "address", addr, "config", network.ID)
		done <- server.Serve(listener)
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
