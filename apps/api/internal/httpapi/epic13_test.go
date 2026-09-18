package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

type endpointInventory struct {
	Endpoints []struct {
		Method               string `json:"method"`
		Path                 string `json:"path"`
		GoOwner              string `json:"go_owner"`
		RPCDependency        string `json:"rpc_dependency"`
		PersistenceClass     string `json:"persistence_class"`
		IsMutating           bool   `json:"is_mutating"`
		IdempotencySupported bool   `json:"idempotency_supported"`
	} `json:"endpoints"`
}

func TestEndpointOwnershipInventoryIsExhaustiveAndConsistent(t *testing.T) {
	b, err := os.ReadFile("../../../../packages/contracts/endpoint-ownership.json")
	if err != nil {
		t.Fatal(err)
	}
	var inventory endpointInventory
	if err := json.Unmarshal(b, &inventory); err != nil {
		t.Fatal(err)
	}
	expected := map[string]bool{
		"GET /health/live": true, "GET /health/ready": true, "GET /api/v1/network": true,
		"GET /api/v1/state": true, "GET /api/v1/junctions/{id}": true, "GET /api/v1/health": true,
		"GET /api/v1/runs": true, "POST /api/v1/runs": true, "GET /api/v1/audit": true,
		"GET /api/v1/recommendations/active": true, "GET /api/v1/analysis": true,
		"POST /api/v1/recommendations/{id}/simulate": true, "POST /api/v1/recommendations/{id}/approve": true,
		"POST /api/v1/recommendations/{id}/modify": true, "POST /api/v1/recommendations/{id}/reject": true,
		"POST /api/v1/scenarios/{type}/start": true, "POST /api/v1/scenarios/reset": true,
		"GET /api/v1/decisions/unresolved": true, "POST /api/v1/decisions/resolve": true,
		"GET /api/v1/mode": true, "POST /api/v1/mode/{mode}": true, "GET /api/v1/locks": true,
		"POST /api/v1/locks/{id}": true, "DELETE /api/v1/locks/{id}": true,
		"POST /api/v1/replay/{scenario}": true, "GET /api/v1/vision/{id}": true,
		"GET /api/v1/commands/{id}": true, "GET /api/v1/session": true,
		"POST /api/v1/session/login": true, "POST /api/v1/session/logout": true, "GET /ws/v1/live": true,
	}
	seen := map[string]bool{}
	for _, endpoint := range inventory.Endpoints {
		key := endpoint.Method + " " + endpoint.Path
		if !expected[key] || seen[key] {
			t.Fatalf("unexpected or duplicate endpoint inventory row: %s", key)
		}
		seen[key] = true
		if endpoint.GoOwner == "" || endpoint.RPCDependency == "" || endpoint.PersistenceClass == "" {
			t.Fatalf("incomplete ownership record for %s", key)
		}
		if endpoint.IsMutating && endpoint.PersistenceClass == "none" && endpoint.Path != "/api/v1/session/login" && endpoint.Path != "/api/v1/session/logout" {
			t.Fatalf("durable mutation cannot have no persistence class: %s", key)
		}
		if endpoint.IsMutating && endpoint.Path != "/api/v1/session/login" && endpoint.Path != "/api/v1/session/logout" && !endpoint.IdempotencySupported {
			t.Fatalf("durable mutation must declare idempotency support: %s", key)
		}
	}
	if len(seen) != len(expected) {
		t.Fatalf("inventory coverage %d, expected %d", len(seen), len(expected))
	}
}

func TestRouteFailureAndReadContractsDoNotCreateRuns(t *testing.T) {
	s := app(t)
	for _, test := range []struct {
		method, path string
		want         int
	}{
		{http.MethodPost, "/api/v1/network", http.StatusMethodNotAllowed},
		{http.MethodGet, "/api/v1/does-not-exist", http.StatusNotFound},
		{http.MethodGet, "/api/v1/network", http.StatusOK},
		{http.MethodGet, "/health/live", http.StatusOK},
	} {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest(test.method, test.path, nil))
		if w.Code != test.want {
			t.Fatalf("%s %s: got %d, want %d", test.method, test.path, w.Code, test.want)
		}
	}
}

func TestIdempotentRunPreparationReplaysAndRejectsConflicts(t *testing.T) {
	st, cleanup := setupTestStore(t)
	if st == nil {
		return
	}
	defer cleanup()
	s := app(t)
	s.Store = st
	h := s.Handler()
	body := `{"schema_version":"1.0","scenario_type":"peak_surge","seed":1101,"mode":"recommend"}`
	request := func(body, actor string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/runs", strings.NewReader(body))
		r.Header.Set("Idempotency-Key", "epic13-run-0001")
		if actor != "" {
			r.Header.Set("X-Actor", actor)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	first := request(body, "operator-a")
	if first.Code != http.StatusCreated {
		t.Fatalf("first request failed: %d %s", first.Code, first.Body.String())
	}
	replay := request(body, "operator-a")
	var firstResult, replayResult map[string]any
	_ = json.Unmarshal(first.Body.Bytes(), &firstResult)
	_ = json.Unmarshal(replay.Body.Bytes(), &replayResult)
	if replay.Code != http.StatusCreated || replay.Header().Get("Idempotency-Replayed") != "true" || firstResult["id"] != replayResult["id"] {
		t.Fatalf("identical retry was not replayed: code=%d header=%q body=%q", replay.Code, replay.Header().Get("Idempotency-Replayed"), replay.Body.String())
	}
	if got := request(strings.Replace(body, "1101", "1102", 1), "operator-a"); got.Code != http.StatusConflict {
		t.Fatalf("changed payload accepted: %d %s", got.Code, got.Body.String())
	}
	if got := request(body, "operator-b"); got.Code != http.StatusConflict {
		t.Fatalf("changed actor accepted: %d %s", got.Code, got.Body.String())
	}
	var count int
	if err := st.Pool.QueryRow(context.Background(), "SELECT count(*) FROM scenario_runs").Scan(&count); err != nil || count != 1 {
		t.Fatalf("idempotency created duplicate runs: %d %v", count, err)
	}
}

func TestLeaseFencesFormerOwner(t *testing.T) {
	st, cleanup := setupTestStore(t)
	if st == nil {
		return
	}
	defer cleanup()
	ctx := context.Background()
	first := app(t)
	first.Store = st
	second := app(t)
	second.Store = st
	one := NewLeaseManager(first)
	two := NewLeaseManager(second)
	one.instanceID, two.instanceID = "epic13-owner-a", "epic13-owner-b"
	one.tick(ctx)
	if !one.IsAuthoritative() || one.Epoch() == 0 {
		t.Fatal("first leaseholder did not acquire authority")
	}
	if _, err := st.Pool.Exec(ctx, "UPDATE owner_lease SET expires_at=now()-interval '1 second' WHERE singleton"); err != nil {
		t.Fatal(err)
	}
	two.tick(ctx)
	one.tick(ctx)
	if !two.IsAuthoritative() || two.Epoch() <= one.Epoch() || one.IsAuthoritative() {
		t.Fatalf("lease fencing failed: first=%t/%d second=%t/%d", one.IsAuthoritative(), one.Epoch(), two.IsAuthoritative(), two.Epoch())
	}
}
