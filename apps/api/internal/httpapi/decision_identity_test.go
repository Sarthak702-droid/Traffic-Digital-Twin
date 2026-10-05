package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"traffic.local/twin/apps/api/internal/store"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func TestRecommendationRejectsOldSourceAndSnapshotAfterRecovery(t *testing.T) {
	state := &pb.TrafficState{SchemaVersion: "1.1", RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", MetricsVersion: "metrics-1"}
	state.LatestFinalizedWindowEndSourceS = pointer(30.0)
	rec := &pb.Recommendation{Id: "rec-1", RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", ModelVersion: "model-1", MetricsVersion: "metrics-1", ForecastOriginSourceS: 30, Status: "pending"}
	analysis := &pb.Analysis{RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", ModelVersion: "model-1", MetricsVersion: "metrics-1", ForecastOriginSourceS: 30, Outcome: "recommend", Recommendation: rec}
	if !recommendationCurrent(rec, analysis, state) {
		t.Fatal("current bound recommendation rejected")
	}
	state.InputSessionId = "epoch-2"
	if recommendationCurrent(rec, analysis, state) {
		t.Fatal("old source epoch accepted")
	}
	state.InputSessionId = "epoch-1" // recovered input cannot revive the old analysis
	state.SnapshotSequence = 10
	if recommendationCurrent(rec, analysis, state) {
		t.Fatal("old snapshot accepted after input recovery")
	}
	fresh := &pb.Recommendation{Id: "rec-2", RunId: state.RunId, InputSessionId: state.InputSessionId, SnapshotSequence: state.SnapshotSequence, ConfigHash: state.ConfigHash, ModelVersion: "model-1", MetricsVersion: state.MetricsVersion, ForecastOriginSourceS: 30, Status: "pending"}
	freshAnalysis := &pb.Analysis{RunId: state.RunId, InputSessionId: state.InputSessionId, SnapshotSequence: state.SnapshotSequence, ConfigHash: state.ConfigHash, ModelVersion: "model-1", MetricsVersion: state.MetricsVersion, ForecastOriginSourceS: 30, Outcome: "recommend", Recommendation: fresh}
	if !recommendationCurrent(fresh, freshAnalysis, state) {
		t.Fatal("fresh analysis remained blocked after input recovered")
	}
}

func TestRecommendationRejectsChangedVersionsAndNoAction(t *testing.T) {
	state := &pb.TrafficState{SchemaVersion: "1.1", RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", MetricsVersion: "metrics-1"}
	rec := &pb.Recommendation{Id: "rec-1", RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", ModelVersion: "model-1", MetricsVersion: "metrics-1", Status: "pending"}
	analysis := &pb.Analysis{RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", ModelVersion: "model-1", MetricsVersion: "metrics-1", Outcome: "recommend", Recommendation: rec}
	state.ConfigHash = "config-2"
	if recommendationCurrent(rec, analysis, state) {
		t.Fatal("changed config accepted")
	}
	state.ConfigHash = "config-1"
	state.MetricsVersion = "metrics-2"
	if recommendationCurrent(rec, analysis, state) {
		t.Fatal("changed metrics accepted")
	}
	state.MetricsVersion = "metrics-1"
	analysis.Outcome = "no_action"
	if recommendationCurrent(rec, analysis, state) {
		t.Fatal("no-action analysis retained an old recommendation")
	}
	analysis.Outcome = "recommend"
	state.DemandSource = "video_profile"
	for _, quality := range []string{"stale", "missing", "degraded", "invalid"} {
		state.InputQuality = quality
		if recommendationCurrent(rec, analysis, state) {
			t.Fatalf("action retained despite %s recorded input", quality)
		}
	}
}

func pointer(value float64) *float64 { return &value }

func TestActiveRecommendationDropsOldEpoch(t *testing.T) {
	s := app(t)
	state := &pb.TrafficState{SchemaVersion: "1.1", RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", MetricsVersion: "metrics-1", SimulationTimeS: 10}
	rec := &pb.Recommendation{Id: "rec-1", RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", ModelVersion: "model-1", MetricsVersion: "metrics-1", Status: "pending"}
	s.state = state
	s.analysis = &pb.Analysis{RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", ModelVersion: "model-1", MetricsVersion: "metrics-1", Outcome: "recommend", Recommendation: rec}
	s.sim = &simulationLink{received: time.Now(), command: &pb.RunCommand{RunId: "run-1", Mode: "recommend"}}
	s.recommendationTime = 10
	request := httptest.NewRequest(http.MethodGet, "/recommendation", nil)
	request.Header.Set("Idempotency-Key", "test-key-487b7eea-9ad9-4544-a3a8-99c1ea312eb8")
	response := httptest.NewRecorder()
	s.activeRecommendation(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("current recommendation status = %d", response.Code)
	}
	state.SnapshotSequence = 10
	response = httptest.NewRecorder()
	s.getAnalysis(response, httptest.NewRequest(http.MethodGet, "/analysis", nil))
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "rec-1") || !strings.Contains(response.Body.String(), "cannot_evaluate") {
		t.Fatalf("advanced snapshot exposed old action: status=%d body=%s", response.Code, response.Body.String())
	}
	state.SnapshotSequence = 9
	state.InputSessionId = "epoch-2"
	response = httptest.NewRecorder()
	s.activeRecommendation(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("old source recommendation status = %d", response.Code)
	}
	response = httptest.NewRecorder()
	s.getAnalysis(response, httptest.NewRequest(http.MethodGet, "/analysis", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("old source analysis status = %d", response.Code)
	}
}

func TestDecisionsRejectHeldRecommendationAfterSourceChange(t *testing.T) {
	s := app(t)
	s.Store = &store.Store{} // stale rejection must happen before any database write
	s.intelligence = pb.NewIntelligenceClient(nil)
	s.sim = &simulationLink{received: time.Now(), command: &pb.RunCommand{RunId: "run-1", Mode: "recommend"}}
	s.state = &pb.TrafficState{SchemaVersion: "1.1", RunId: "run-1", InputSessionId: "epoch-2", SnapshotSequence: 10, ConfigHash: "config-1", MetricsVersion: "metrics-1", SimulationTimeS: 10}
	rec := &pb.Recommendation{Id: "rec-1", RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", ModelVersion: "model-1", MetricsVersion: "metrics-1", Status: "pending"}
	s.analysis = &pb.Analysis{RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", ModelVersion: "model-1", MetricsVersion: "metrics-1", Outcome: "recommend", Recommendation: rec}
	s.recommendationTime = 10
	for _, action := range []string{"approve", "modify", "reject", "simulate"} {
		body := "{}"
		if action == "modify" || action == "reject" {
			body = `{"reason":"Other: Input changed"}`
		}
		route := chi.NewRouteContext()
		route.URLParams.Add("id", "rec-1")
		route.URLParams.Add("action", action)
		request := httptest.NewRequest(http.MethodPost, "/api/v1/recommendations/rec-1/"+action, strings.NewReader(body))
		request.Header.Set("Idempotency-Key", "test-key-501e3922-edfb-4be5-92b2-8f0383641131")
		request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, route))
		response := httptest.NewRecorder()
		s.decision(response, request)
		if response.Code != http.StatusConflict {
			t.Fatalf("stale %s status = %d; body = %s", action, response.Code, response.Body.String())
		}
	}
}

func TestLateAnalysisDoesNotMatchChangedRunInput(t *testing.T) {
	state := &pb.TrafficState{SchemaVersion: "1.1", RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", MetricsVersion: "metrics-1"}
	analysis := &pb.Analysis{RunId: "run-1", InputSessionId: "epoch-1", SnapshotSequence: 9, ConfigHash: "config-1", MetricsVersion: "metrics-1"}
	if !analysisMatchesState(analysis, state) {
		t.Fatal("analysis from current snapshot rejected")
	}
	state.InputSessionId = "epoch-2"
	if analysisMatchesState(analysis, state) {
		t.Fatal("late analysis from old input accepted")
	}
	state.InputSessionId = "epoch-1"
	state.SnapshotSequence = 10
	if analysisMatchesState(analysis, state) {
		t.Fatal("late analysis from old snapshot accepted")
	}
}

func TestPublishAnalysisRetainsBoundForecastsWithoutStaleActions(t *testing.T) {
	state := &pb.TrafficState{SchemaVersion: "1.1", RunId: "run", InputSessionId: "epoch", SnapshotSequence: 11, SimulationTimeS: 11, ConfigHash: "cfg", MetricsVersion: "metrics"}
	analysis := &pb.Analysis{RunId: "run", InputSessionId: "epoch", SnapshotSequence: 10, SimulationTimeS: 10, ConfigHash: "cfg", MetricsVersion: "metrics", Outcome: "recommend", Recommendation: &pb.Recommendation{Id: "old"}, Alternatives: []*pb.Recommendation{{Id: "alt"}}, Comparison: &pb.ComparisonResult{}, Forecasts: []*pb.Forecast{{HorizonS: 30}}}
	published := publishableAnalysis(analysis, state)
	if published == nil || len(published.Forecasts) != 1 || published.Recommendation != nil || published.Comparison != nil || len(published.Alternatives) != 0 || published.Outcome != "cannot_evaluate" {
		t.Fatal("bound forecasts were lost or stale actions exposed")
	}
	if analysis.Recommendation == nil {
		t.Fatal("input analysis mutated")
	}
	state.DemandSource = "video_profile"
	state.InputQuality = "stale"
	if publishableAnalysis(analysis, state) != nil {
		t.Fatal("stale input retained numeric forecasts")
	}
	state.InputQuality = "cached_valid"
	state.InputSessionId = "other"
	if publishableAnalysis(analysis, state) != nil {
		t.Fatal("old source accepted")
	}
	state.InputSessionId = "epoch"
	state.SnapshotSequence = 9
	if publishableAnalysis(analysis, state) != nil {
		t.Fatal("future snapshot accepted")
	}
	state.SnapshotSequence = 21
	state.SimulationTimeS = 21
	if publishableAnalysis(analysis, state) != nil {
		t.Fatal("expired forecast accepted")
	}
}

func TestAnalysisReadHidesForecastsImmediatelyWhenRecordedInputBecomesUnsuitable(t *testing.T) {
	for _, quality := range []string{"stale", "missing", "degraded", "invalid"} {
		t.Run(quality, func(t *testing.T) {
			s := app(t)
			s.sim = &simulationLink{received: time.Now()}
			s.state = &pb.TrafficState{SchemaVersion: "1.1", RunId: "run", InputSessionId: "epoch", SnapshotSequence: 11, SimulationTimeS: 66, ConfigHash: "cfg", MetricsVersion: "metrics", DemandSource: "video_profile", InputQuality: quality}
			s.analysis = &pb.Analysis{RunId: "run", InputSessionId: "epoch", SnapshotSequence: 10, SimulationTimeS: 65, ConfigHash: "cfg", MetricsVersion: "metrics", InputQuality: "cached_valid", Outcome: "no_action", Forecasts: []*pb.Forecast{{HorizonS: 30, QueueVeh: 4, HorizonStatus: "available"}}}
			response := httptest.NewRecorder()
			s.getAnalysis(response, httptest.NewRequest(http.MethodGet, "/analysis", nil))
			if response.Code != http.StatusServiceUnavailable {
				t.Fatalf("old numeric forecasts exposed for %s: %d %s", quality, response.Code, response.Body.String())
			}
		})
	}
}
