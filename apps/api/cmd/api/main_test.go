package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"traffic.local/twin/apps/api/internal/config"
)

func TestServerUsesConfiguredProcessedObservations(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("VIDEO_PROCESSED_DIR", dir)
	app := configuredServer(config.Network{}, "http://127.0.0.1:3102", "private-compute-token")
	if app.VisionProcessedDir != dir {
		t.Fatalf("processed observations ignored: got %q, want %q", app.VisionProcessedDir, dir)
	}
}

func TestRunRequiresComputeToken(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}

	dir := wd
	var configPath string
	for {
		candidate := filepath.Join(dir, "packages", "scenario-config", "c1-c6.json")
		if _, err := os.Stat(candidate); err == nil {
			configPath = candidate
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	if configPath != "" {
		origCfg := os.Getenv("NETWORK_CONFIG")
		defer os.Setenv("NETWORK_CONFIG", origCfg)
		_ = os.Setenv("NETWORK_CONFIG", configPath)
	}

	origToken := os.Getenv("COMPUTE_TOKEN")
	defer os.Setenv("COMPUTE_TOKEN", origToken)
	_ = os.Unsetenv("COMPUTE_TOKEN")

	err = run()
	if err == nil {
		t.Fatal("expected run() to fail without COMPUTE_TOKEN, but got nil")
	}
	if !strings.Contains(err.Error(), "COMPUTE_TOKEN") {
		t.Fatalf("expected COMPUTE_TOKEN validation error, got: %v", err)
	}
}
