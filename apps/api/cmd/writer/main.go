package main

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"os"
	"time"
	"traffic.local/twin/apps/api/internal/store"
	"traffic.local/twin/db"
)

func main() {
	token := os.Getenv("WRITER_TOKEN")
	dsn := os.Getenv("WRITE_DATABASE_URL")
	if len(token) < 32 || dsn == "" {
		slog.Error("WRITER_TOKEN (32+ characters) and WRITE_DATABASE_URL required")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, e := pgxpool.New(ctx, dsn)
	if e != nil {
		panic(e)
	}
	defer pool.Close()
	if e = pool.Ping(ctx); e != nil {
		panic(e)
	}
	if e = db.Migrate(ctx, pool); e != nil {
		panic(e)
	}
	addr := os.Getenv("WRITER_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8083"
	}
	server := http.Server{Addr: addr, Handler: store.New(pool).WriterHandler(token), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 6 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16384}
	slog.Info("Private Go writer ready", "address", addr)
	if e = server.ListenAndServe(); e != nil {
		panic(e)
	}
}
