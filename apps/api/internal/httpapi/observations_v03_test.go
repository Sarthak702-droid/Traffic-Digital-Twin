package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	pb "traffic.local/twin/packages/contracts/gen/go"
)

func writeProcessedFixture(t *testing.T, root, camera, session string, rows []string) {
	t.Helper()
	dir := filepath.Join(root, camera, "cache-key")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	data := []byte(strings.Join(rows, "\n") + "\n")
	if err := os.WriteFile(filepath.Join(dir, "observations.jsonl"), data, 0600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	manifest := map[string]any{
		"coverage": map[string]any{"status": "complete", "requested_frames": 60, "decoded_frames": 60, "source_fps": 1, "decoded_until_source_s": 60},
		"status":   "complete", "camera_id": camera, "source_session_id": session,
		"clip_sha256": strings.Repeat("a", 64), "geometry_sha256": strings.Repeat("b", 64),
		"model_sha256": strings.Repeat("d", 64), "config_hash": strings.Repeat("c", 64),
		"detector_version": "itd-v1.2-yolo", "tracker_version": "bytetrack-ultralytics-8.4.129",
		"observation_schema_version": "camera-observation-v1", "window_count": len(rows),
		"observations_sha256": hex.EncodeToString(digest[:]),
	}
	b, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), b, 0600); err != nil {
		t.Fatal(err)
	}
}

func observationFixture(session string, start, end, available float64, crossings int) string {
	row := map[string]any{
		"schema_version": "camera-observation-v1", "camera_id": "CAM-01", "observation_id": fmt.Sprintf("%s:%g", session, start),
		"window_start_s": start, "window_end_s": end, "available_at_source_s": available,
		"processed_at_utc": "2026-09-25T10:00:00Z", "crossings_veh": crossings,
		"direction_id": "approaching", "counts_by_class": map[string]int{"car": crossings}, "flow_vpm": float64(crossings) * 12,
		"queue_status": "unavailable", "speed_status": "uncalibrated",
		"observation_status": "valid", "validation_level": "provisional_unreviewed",
		"media_source": "recorded_video", "processing_mode": "online_inference", "boundary_link_id": "C2-C1",
		"source_identity": map[string]any{
			"clip_sha256": strings.Repeat("a", 64), "geometry_sha256": strings.Repeat("b", 64),
			"config_hash": strings.Repeat("c", 64), "detector_version": "itd-v1.2-yolo",
			"tracker_version": "bytetrack-ultralytics-8.4.129", "observation_schema_version": "camera-observation-v1",
			"source_session_id": session, "processing_mode": "online_inference",
		},
	}
	b, _ := json.Marshal(row)
	return string(b)
}

func TestProcessedObservationRejectsMissingRequiredMeasurementStatus(t *testing.T) {
	s := app(t)
	s.VisionProcessedDir = t.TempDir()
	var row map[string]any
	if err := json.Unmarshal([]byte(observationFixture("session-1", 0, 5, 5, 1)), &row); err != nil {
		t.Fatal(err)
	}
	delete(row, "direction_id")
	encoded, err := json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	writeProcessedFixture(t, s.VisionProcessedDir, "CAM-01", "session-1", []string{string(encoded)})
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, testRequest("GET", "/api/v1/observations?camera_id=CAM-01", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"degraded"`) || !strings.Contains(w.Body.String(), `"observations":[]`) {
		t.Fatalf("incomplete measurement served as valid: %d %s", w.Code, w.Body.String())
	}
}

func TestProcessedObservationRejectsOutOfOrderAndDuplicateWindows(t *testing.T) {
	for _, tc := range []struct {
		name string
		rows []string
		want string
	}{
		{"out of order", []string{observationFixture("session-1", 5, 10, 10, 1), observationFixture("session-1", 0, 5, 5, 1)}, "out_of_order"},
		{"duplicate", []string{observationFixture("session-1", 0, 5, 5, 1), observationFixture("session-1", 0, 5, 5, 1)}, "duplicate"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := app(t)
			s.VisionProcessedDir = t.TempDir()
			writeProcessedFixture(t, s.VisionProcessedDir, "CAM-01", "session-1", tc.rows)
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, testRequest("GET", "/api/v1/observations?camera_id=CAM-01", nil))
			if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"`+tc.want+`"`) || !strings.Contains(w.Body.String(), `"observations":[]`) {
				t.Fatalf("bad source sequence accepted: %d %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestProcessedObservationHonorsAvailabilityAndStaleness(t *testing.T) {
	s := app(t)
	s.VisionProcessedDir = t.TempDir()
	writeProcessedFixture(t, s.VisionProcessedDir, "CAM-01", "session-1", []string{observationFixture("session-1", 0, 5, 7, 0)})
	for _, tc := range []struct {
		asOf   string
		status string
		count  string
	}{
		{"6", "missing", `"count":0`},
		{"7", "cached_valid", `"count":1`},
		{"30", "stale", `"count":1`},
	} {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, testRequest("GET", "/api/v1/observations?camera_id=CAM-01&as_of_source_s="+tc.asOf, nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"`+tc.status+`"`) || !strings.Contains(w.Body.String(), tc.count) {
			t.Fatalf("as_of=%s: %d %s", tc.asOf, w.Code, w.Body.String())
		}
	}
}

func TestProcessedClipCatalogExposesSafeStatusAndRequiresSessionSelection(t *testing.T) {
	s := app(t)
	s.VisionProcessedDir = t.TempDir()
	writeProcessedFixture(t, s.VisionProcessedDir, "CAM-01", "session-1", []string{observationFixture("session-1", 0, 5, 5, 1)})
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, testRequest("GET", "/api/v1/vision/clips", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"source_session_id":"session-1"`) || !strings.Contains(w.Body.String(), `"latest_completed_window_end_source_s":5`) || strings.Contains(w.Body.String(), `clip_path`) {
		t.Fatalf("clip status/provenance unavailable or leaked private path: %d %s", w.Code, w.Body.String())
	}
	second := filepath.Join(s.VisionProcessedDir, "CAM-01", "other-cache")
	if err := os.MkdirAll(second, 0700); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(s.VisionProcessedDir, "CAM-01", "cache-key")
	for _, name := range []string{"manifest.json", "observations.jsonl"} {
		data, err := os.ReadFile(filepath.Join(original, name))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(second, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, testRequest("GET", "/api/v1/observations?camera_id=CAM-01", nil))
	if w.Code != 409 {
		t.Fatalf("ambiguous source selection accepted: %d %s", w.Code, w.Body.String())
	}
	s.Network.CameraBoundaryLinks = map[string]string{"CAM-01": "C2-C1"}
	if !s.videoProfileReady() {
		t.Fatal("retained cache entries falsely mark valid selectable recorded input unavailable")
	}
}

func TestVideoRunBindingRequiresExactValidBoundarySources(t *testing.T) {
	s := app(t)
	s.VisionProcessedDir = t.TempDir()
	s.Network.CameraBoundaryLinks = map[string]string{"CAM-01": "C2-C1"}
	writeProcessedFixture(t, s.VisionProcessedDir, "CAM-01", "session-1", []string{observationFixture("session-1", 0, 5, 5, 0)})
	for _, selected := range []map[string]string{{}, {"CAM-01": "wrong"}, {"CAM-01": "session-1", "CAM-02": "invented"}} {
		if _, err := s.resolveInputBinding(selected); err == nil {
			t.Fatalf("unbound source accepted: %+v", selected)
		}
	}
	bound, err := s.resolveInputBinding(map[string]string{"CAM-01": "session-1"})
	if err != nil || bound.InputSessionID == "" || bound.SourceSessions["CAM-01"] != "session-1" || bound.ConfigHash != strings.Repeat("c", 64) {
		t.Fatalf("valid source was not bound: %+v %v", bound, err)
	}
}

func TestBoundInputEpochReachesLiveSubscribers(t *testing.T) {
	s := app(t)
	s.activeInputSessionID = "epoch-1"
	stream := make(chan *pb.TrafficState, 1)
	s.sim = &simulationLink{command: &pb.RunCommand{RunId: "run-1"}, subscribers: map[chan *pb.TrafficState]struct{}{stream: {}}}
	frame := &pb.TrafficState{SchemaVersion: "1.0", RunId: "run-1", Timestamp: "2026-09-25T10:00:00Z", Source: "synthetic", Movements: []*pb.MovementState{{MovementId: "C6-C3-C1", CurrentPhaseId: "C3-FROM-C6"}}}
	if err := s.acceptFrame(frame); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-stream:
		if got.InputSessionId != "epoch-1" {
			t.Fatalf("subscriber lost source epoch: %+v", got)
		}
	default:
		t.Fatal("subscriber did not receive state")
	}
}

func TestProcessedObservationPreservesZeroAndSourceSession(t *testing.T) {
	s := app(t)
	s.VisionProcessedDir = t.TempDir()
	writeProcessedFixture(t, s.VisionProcessedDir, "CAM-01", "session-1", []string{observationFixture("session-1", 0, 5, 5, 0)})
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, testRequest("GET", "/api/v1/observations?camera_id=CAM-01&source_session_id=session-1", nil))
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		Status          string `json:"status"`
		SourceSessionID string `json:"source_session_id"`
		Observations    []struct {
			Crossings int     `json:"crossings_veh"`
			Available float64 `json:"available_at_source_s"`
		} `json:"observations"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != "cached_valid" || got.SourceSessionID != "session-1" || len(got.Observations) != 1 || got.Observations[0].Crossings != 0 || got.Observations[0].Available != 5 {
		t.Fatalf("valid zero or source timing lost: %+v", got)
	}
}

func TestProcessedObservationReportsMissingAndCorruptInput(t *testing.T) {
	s := app(t)
	s.VisionProcessedDir = t.TempDir()
	h := s.Handler()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, testRequest("GET", "/api/v1/observations?camera_id=CAM-01", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"missing"`) || strings.Contains(w.Body.String(), `"crossings_veh":0`) {
		t.Fatalf("missing input became zero or error: %d %s", w.Code, w.Body.String())
	}
	writeProcessedFixture(t, s.VisionProcessedDir, "CAM-01", "session-1", []string{observationFixture("session-1", 0, 5, 5, 1)})
	path := filepath.Join(s.VisionProcessedDir, "CAM-01", "cache-key", "observations.jsonl")
	if err := os.WriteFile(path, []byte("{}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, testRequest("GET", "/api/v1/observations?camera_id=CAM-01", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"degraded"`) || !strings.Contains(w.Body.String(), `"observations":[]`) {
		t.Fatalf("corrupt processed input was served: %d %s", w.Code, w.Body.String())
	}
}

func TestFailedProcessingManifestIsVisibleWithoutPrivateError(t *testing.T) {
	s := app(t)
	s.VisionProcessedDir = t.TempDir()
	dir := filepath.Join(s.VisionProcessedDir, "CAM-01", "failed-attempt")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"status":"failed","error":"private /home/user/video.mp4 path"}`), 0600); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, testRequest("GET", "/api/v1/vision/clips", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"degraded"`) || !strings.Contains(w.Body.String(), `"camera_id":"CAM-01"`) || strings.Contains(w.Body.String(), "/home/user") {
		t.Fatalf("failed job status hidden or private path leaked: %d %s", w.Code, w.Body.String())
	}
}

func TestAuditUnprovenCoverageAndPrivateRowsNeverAdmitCache(t *testing.T) {
	for _, failure := range []string{"missing_coverage", "outside_decoded_coverage", "private_details"} {
		t.Run(failure, func(t *testing.T) {
			root := t.TempDir()
			row := observationFixture("audit-source", 0, 5, 5, 0)
			if failure == "private_details" {
				var data map[string]any
				json.Unmarshal([]byte(row), &data)
				data["tracking"] = map[string]any{"trackId": 7}
				b, _ := json.Marshal(data)
				row = string(b)
			}
			writeProcessedFixture(t, root, "CAM-01", "audit-source", []string{row})
			path := filepath.Join(root, "CAM-01", "cache-key", "manifest.json")
			b, _ := os.ReadFile(path)
			var manifest map[string]any
			json.Unmarshal(b, &manifest)
			if failure == "missing_coverage" {
				delete(manifest, "coverage")
			}
			if failure == "outside_decoded_coverage" {
				manifest["coverage"] = map[string]any{"status": "complete", "requested_frames": 3, "decoded_frames": 3, "source_fps": 1, "decoded_until_source_s": 3}
			}
			b, _ = json.Marshal(manifest)
			os.WriteFile(path, b, 0600)
			entry := readProcessedEntry(path)
			if entry.Status == "cached_valid" || len(entry.Rows) > 0 {
				t.Fatalf("unsafe %s admitted: %+v", failure, entry)
			}
		})
	}
}
