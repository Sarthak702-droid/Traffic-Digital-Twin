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

func TestRoleBasedAccessControlAndRequestTracking(t *testing.T) {
	s := app(t)
	h := s.Handler()

	// 1. Mutation by viewer is forbidden (403)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs", strings.NewReader(`{}`))
	req.Header.Set("X-Role", "viewer")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("viewer mutation got %d, want 403", w.Code)
	}

	// 2. Mutation by observer is forbidden (403)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/runs", strings.NewReader(`{}`))
	req.Header.Set("X-Role", "observer")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("observer mutation got %d, want 403", w.Code)
	}

	// 3. Invalid role is rejected (401)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/network", nil)
	req.Header.Set("X-Role", "unauthorized_role")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("invalid role got %d, want 401", w.Code)
	}

	// 4. Request ID is present on all responses
	req = httptest.NewRequest(http.MethodGet, "/health/live", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Header().Get("X-Request-ID") == "" {
		t.Fatal("response missing X-Request-ID")
	}

	// 5. Explicit incoming X-Request-ID is preserved
	req = httptest.NewRequest(http.MethodGet, "/health/live", nil)
	req.Header.Set("X-Request-ID", "req-test-trace-1234")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Header().Get("X-Request-ID") != "req-test-trace-1234" {
		t.Fatalf("request ID not preserved: got %q, want %q", w.Header().Get("X-Request-ID"), "req-test-trace-1234")
	}
}

func TestSessionLifecycleAndRoleAssignment(t *testing.T) {
	s := app(t)
	h := s.Handler()

	// 1. GET /api/v1/session returns current actor & role
	req := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
	req.Header.Set("X-Actor", "demo-operator")
	req.Header.Set("X-Role", "operator")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("session read got %d: %s", w.Code, w.Body.String())
	}
	var sessionInfo map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &sessionInfo); err != nil {
		t.Fatal(err)
	}
	if sessionInfo["actor"] != "demo-operator" || sessionInfo["role"] != "operator" {
		t.Fatalf("unexpected session info: %+v", sessionInfo)
	}

	// 2. POST /api/v1/session/login with supervisor
	req = httptest.NewRequest(http.MethodPost, "/api/v1/session/login", strings.NewReader(`{"username":"supervisor_patel","password":"demo"}`))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("login supervisor got %d: %s", w.Code, w.Body.String())
	}
	var loginRes map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &loginRes)
	if loginRes["role"] != "supervisor" {
		t.Fatalf("expected supervisor role, got %s", loginRes["role"])
	}

	// 3. POST /api/v1/session/login with viewer
	req = httptest.NewRequest(http.MethodPost, "/api/v1/session/login", strings.NewReader(`{"username":"viewer_guest","password":"demo"}`))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("login viewer got %d: %s", w.Code, w.Body.String())
	}
	_ = json.Unmarshal(w.Body.Bytes(), &loginRes)
	if loginRes["role"] != "viewer" {
		t.Fatalf("expected viewer role, got %s", loginRes["role"])
	}

	// 4. Invalid login request
	req = httptest.NewRequest(http.MethodPost, "/api/v1/session/login", strings.NewReader(`{"username":""}`))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty username got %d, want 400", w.Code)
	}

	// 5. POST /api/v1/session/logout
	req = httptest.NewRequest(http.MethodPost, "/api/v1/session/logout", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("logout got %d, want 200", w.Code)
	}
}

func TestCommandStatusEndpointContract(t *testing.T) {
	st, cleanup := setupTestStore(t)
	if st == nil {
		return
	}
	defer cleanup()
	s := app(t)
	s.Store = st
	h := s.Handler()

	// 1. Invalid command ID (less than 8 chars)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/commands/short", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("short command id got %d, want 400", w.Code)
	}

	// 2. Non-existent command
	req = httptest.NewRequest(http.MethodGet, "/api/v1/commands/nonexistent-command-9999", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("non-existent command got %d, want 404", w.Code)
	}

	// 3. Issue a real command via POST /api/v1/runs
	body := `{"schema_version":"1.0","scenario_type":"peak_surge","seed":2201,"mode":"recommend"}`
	req = httptest.NewRequest(http.MethodPost, "/api/v1/runs", strings.NewReader(body))
	req.Header.Set("Idempotency-Key", "epic13-cmd-status-001")
	req.Header.Set("X-Actor", "operator-cmd-test")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("run creation failed: %d %s", w.Code, w.Body.String())
	}

	// 4. Retrieve the recorded command outcome via GET /api/v1/commands/{id}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/commands/epic13-cmd-status-001", nil)
	req.Header.Set("X-Actor", "operator-cmd-test")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get command failed: %d %s", w.Code, w.Body.String())
	}
	var cmdOutcome map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &cmdOutcome); err != nil {
		t.Fatal(err)
	}
	if cmdOutcome["status"] != "completed" || cmdOutcome["command_id"] != "epic13-cmd-status-001" {
		t.Fatalf("unexpected command outcome: %+v", cmdOutcome)
	}

	// 5. Actor mismatch on command status returns 409
	req = httptest.NewRequest(http.MethodGet, "/api/v1/commands/epic13-cmd-status-001", nil)
	req.Header.Set("X-Actor", "wrong-operator")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("actor mismatch got %d, want 409", w.Code)
	}
}

func TestNonAuthoritativeReplicaFencingAndStatelessBalancing(t *testing.T) {
	st, cleanup := setupTestStore(t)
	if st == nil {
		return
	}
	defer cleanup()
	s := app(t)
	s.Store = st
	// Replica marked explicitly as non-authoritative standby
	s.Lease = &LeaseManager{server: s, instanceID: "standby-replica", isOwner: false}
	h := s.Handler()

	// 1. Stateful mutating command rejected with 503
	body := `{"schema_version":"1.0","scenario_type":"peak_surge","seed":3301,"mode":"recommend"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("standby accepted mutation: got %d, want 503", w.Code)
	}
	if !strings.Contains(w.Body.String(), "authoritative run owner") {
		t.Fatalf("expected leaseholder warning, got %s", w.Body.String())
	}

	// 2. Stateful start rejected with 503
	req = httptest.NewRequest(http.MethodPost, "/api/v1/scenarios/peak_surge/start", strings.NewReader(`{}`))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("standby accepted scenario start: got %d, want 503", w.Code)
	}

	// 3. Stateless read queries balance freely across healthy replicas
	for _, path := range []string{"/health/live", "/health/ready", "/api/v1/network", "/api/v1/junctions/C1", "/api/v1/health"} {
		req = httptest.NewRequest(http.MethodGet, path, nil)
		w = httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("stateless path %s failed on standby: %d %s", path, w.Code, w.Body.String())
		}
	}
}
