package httpapi

import (
	"context"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"traffic.local/twin/apps/api/internal/config"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func app(t *testing.T) *Server {
	t.Helper()
	n, e := config.Load("../../../../packages/scenario-config/c1-c6.json")
	if e != nil {
		t.Fatal(e)
	}
	return &Server{Network: n}
}
func TestReadAndUnavailable(t *testing.T) {
	h := app(t).Handler()
	for path, code := range map[string]int{"/api/v1/network": 200, "/api/v1/junctions/C1": 200, "/api/v1/junctions/unknown": 404, "/api/v1/state": 503, "/api/v1/health": 200, "/api/v1/runs": 503, "/api/v1/recommendations/active": 503} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != code {
			t.Errorf("%s: %d", path, w.Code)
		}
	}
}
func TestRejectInvalidCommands(t *testing.T) {
	h := app(t).Handler()
	for _, body := range []string{`{}`, `null`, `{"schema_version":"1.0","scenario_type":"unknown","mode":"recommend","seed":1}`, `{"schema_version":"1.0","scenario_type":"peak_surge","mode":"live","seed":1}`, `{"schema_version":"1.0","scenario_type":"peak_surge","mode":"recommend","seed":-1}`, `{"schema_version":"1.0","scenario_type":"peak_surge","mode":"recommend","seed":1,"unsafe":true}`, `{} {}`, strings.Repeat(" ", 5000) + `{}`} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/runs", strings.NewReader(body)))
		if w.Code != 400 {
			t.Errorf("invalid command got %d", w.Code)
		}
	}
}
func TestCrossOriginAndFutureActions(t *testing.T) {
	h := app(t).Handler()
	r := httptest.NewRequest("POST", "http://localhost/api/v1/runs", strings.NewReader(`{}`))
	r.Header.Set("Origin", "https://other.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/recommendations/example/approve", nil))
	if w.Code != 501 {
		t.Fatal(w.Code)
	}
}

func TestConfiguredFrontendOrigin(t *testing.T) {
	s := app(t)
	s.AllowedOrigin = "http://127.0.0.1:3100"
	r := httptest.NewRequest("POST", "http://127.0.0.1:8081/api/v1/runs", strings.NewReader(`{}`))
	r.Header.Set("Origin", s.AllowedOrigin)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatalf("configured frontend should reach JSON validation, got %d", w.Code)
	}
}

func TestStateCacheIsolation(t *testing.T) {
	s := app(t)
	state := &pb.TrafficState{SchemaVersion: "1.0", RunId: "test", Timestamp: "2026-09-16T00:00:00Z", Source: "synthetic", Movements: []*pb.MovementState{{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6", QueueVeh: 12}}}
	if e := s.SetState(state); e != nil {
		t.Fatal(e)
	}
	state.Movements[0].QueueVeh = 999
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/state", nil))
	if w.Code != 200 || strings.Contains(w.Body.String(), "999") {
		t.Fatal("state cache aliased producer payload")
	}
	state.Movements[0].OccupancyRatio = 2
	if s.SetState(state) == nil {
		t.Fatal("invalid state accepted")
	}
}

func TestWebSocketConfiguredOrigin(t *testing.T) {
	s := app(t)
	s.AllowedOrigin = "http://127.0.0.1:3100"
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, _, e := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/ws/v1/live", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{s.AllowedOrigin}}})
	if e != nil {
		t.Fatal(e)
	}
	defer c.CloseNow()
	var event struct {
		Type     string         `json:"type"`
		Sequence string         `json:"sequence"`
		Payload  pb.HealthState `json:"payload"`
	}
	if e = wsjson.Read(ctx, c, &event); e != nil {
		t.Fatal(e)
	}
	if event.Type != "health.updated" || event.Sequence != "1" || len(event.Payload.Components) == 0 {
		t.Fatal("invalid websocket event")
	}
}
