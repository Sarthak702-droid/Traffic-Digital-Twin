package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/apps/api/internal/store/queries"
	"traffic.local/twin/db"
)

// N01 added boundary mappings and an explicit incident location to the v4
// network. Existing installations must retain the original immutable config
// and its runs while startup registers the revised network under a new ID.
func TestConfigUpgradePreservesPersistedV4AndRunHistory(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ctx = WithActor(ctx, "config-upgrade-test")
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("config_upgrade_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	poolConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	poolConfig.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	s := New(pool)
	network, err := config.Load("../../../../packages/scenario-config/c1-c6.json")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(network)
	if err != nil {
		t.Fatal(err)
	}
	var legacy map[string]any
	if err := json.Unmarshal(encoded, &legacy); err != nil {
		t.Fatal(err)
	}
	legacy["id"] = "c1-c6-v4"
	delete(legacy, "camera_boundary_links")
	for _, scenario := range legacy["scenarios"].([]any) {
		delete(scenario.(map[string]any), "incident_node_id")
	}
	legacyBytes, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Q.SaveConfig(ctx, queries.SaveConfigParams{ID: "c1-c6-v4", SchemaVersion: network.Version, Config: legacyBytes}); err != nil {
		t.Fatal(err)
	}
	before, err := s.Q.GetConfig(ctx, "c1-c6-v4")
	if err != nil {
		t.Fatal(err)
	}
	oldRun, err := s.CreateRun(ctx, "c1-c6-v4", "peak_surge", "observe", 1101)
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		if err := s.SaveConfig(ctx, network); err != nil {
			t.Fatalf("startup attempt %d with persisted v4: %v", attempt+1, err)
		}
	}
	newRun, err := s.CreateRun(ctx, network.ID, "incident_c3", "observe", 2202)
	if err != nil {
		t.Fatal(err)
	}
	after, err := s.Q.GetConfig(ctx, "c1-c6-v4")
	if err != nil || !bytes.Equal(before.Config, after.Config) {
		t.Fatalf("historical v4 config changed: %v", err)
	}
	savedRun, err := s.Q.GetRun(ctx, oldRun.ID)
	if err != nil || savedRun.ConfigID != "c1-c6-v4" || newRun.ConfigID == savedRun.ConfigID {
		t.Fatalf("old/new runs must retain distinct config identities: old=%s new=%s err=%v", savedRun.ConfigID, newRun.ConfigID, err)
	}
	changed := network
	changed.Name = "Changed without a new config ID"
	if err := s.SaveConfig(ctx, changed); err == nil {
		t.Fatal("same-ID config mutation was accepted")
	}
}
