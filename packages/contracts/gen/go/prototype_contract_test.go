package contractsv1

import (
	"encoding/json"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func roundTripJSON(t *testing.T, input string, message proto.Message) map[string]any {
	t.Helper()
	if err := protojson.Unmarshal([]byte(input), message); err != nil {
		t.Fatalf("new contract JSON rejected: %v", err)
	}
	wire, err := proto.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	restored := proto.Clone(message)
	proto.Reset(restored)
	if err := proto.Unmarshal(wire, restored); err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(message, restored) {
		t.Fatal("new fields changed across binary round trip")
	}
	encoded, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(restored)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestFinalizedZeroWindowPreservesSourceIdentity(t *testing.T) {
	state := &TrafficState{}
	got := roundTripJSON(t, `{"schema_version":"1.0","run_id":"run-7","input_session_id":"epoch-7","snapshot_sequence":"24","latest_finalized_window_end_source_s":15,"input_quality":"fresh","observation_history":[{"observation_id":"obs-7","camera_id":"CAM-01","boundary_link_id":"C2-C1","window_start_s":10,"window_end_s":15,"available_at_source_s":15,"processed_at_utc":"2026-09-24T05:30:02Z","crossings_veh":0,"observation_status":"valid","source_identity":{"clip_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","geometry_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","detector_version":"itd-v1.2","tracker_version":"bytetrack-v1","observation_schema_version":"camera-observation-v1","source_session_id":"cam-attempt-7","config_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","processing_mode":"online_inference"},"release_start_simulation_s":25}]}`, state)
	if got["input_session_id"] != "epoch-7" {
		t.Fatalf("source epoch lost: %v", got["input_session_id"])
	}
	if len(state.ObservationHistory) != 1 || state.ObservationHistory[0].CrossingsVeh != 0 || state.ObservationHistory[0].ObservationStatus != "valid" {
		t.Fatalf("valid zero observation lost: %+v", state.ObservationHistory)
	}
	history := got["observation_history"].([]any)
	window := history[0].(map[string]any)
	if window["crossings_veh"] != nil {
		t.Fatalf("zero protobuf scalar should be omitted, got %v", window["crossings_veh"])
	}
	if window["observation_status"] != "valid" || window["release_start_simulation_s"] != float64(25) {
		t.Fatalf("valid zero window lost its status or release clock: %v", window)
	}
}

func TestAnalysisOutcomeAndHorizonAvailabilityRoundTrip(t *testing.T) {
	got := roundTripJSON(t, `{"run_id":"run-7","input_session_id":"epoch-7","snapshot_sequence":"24","forecast_origin_source_s":15,"input_quality":"fresh","outcome":"no_action","outcome_reason":"safe_current_plan_best","horizon_availability":[{"horizon_s":30,"status":"available"},{"horizon_s":300,"status":"insufficient_history","reason":"window history too short"}]}`, &Analysis{})
	if got["outcome"] != "no_action" || got["snapshot_sequence"] != "24" {
		t.Fatalf("analysis binding or outcome lost: %v", got)
	}
	horizons := got["horizon_availability"].([]any)
	if len(horizons) != 2 || horizons[1].(map[string]any)["status"] != "insufficient_history" {
		t.Fatalf("horizon statuses lost: %v", horizons)
	}
}

func TestPlanAndComparisonContextRoundTrip(t *testing.T) {
	plan := roundTripJSON(t, `{"run_id":"run-7","command_id":"command-7","activate_not_before_simulation_s":30,"changes":[{"node_id":"C1","phase_id":"p1","green_s":25,"offset_s":0}]}`, &PlanCommand{})
	changes := plan["changes"].([]any)
	if changes[0].(map[string]any)["offset_s"] != float64(0) {
		t.Fatalf("explicit zero offset lost: %v", changes[0])
	}
	comparison := roundTripJSON(t, `{"run_id":"run-7","input_session_id":"epoch-7","snapshot_sequence":"24","baseline_queue_delay_veh_s":300,"candidate_queue_delay_veh_s":280,"baseline_boundary_wait_veh_s":90,"candidate_boundary_wait_veh_s":140,"baseline_worst_service_debt_s":50,"candidate_worst_service_debt_s":80,"demand_assumptions_hash":"same-demand","window_start_simulation_s":24,"window_end_simulation_s":144}`, &ComparisonResult{})
	if comparison["candidate_boundary_wait_veh_s"] != float64(140) || comparison["candidate_worst_service_debt_s"] != float64(80) {
		t.Fatalf("displaced congestion metrics lost: %v", comparison)
	}
}

func TestLegacyTrafficStateTagsRemainReadable(t *testing.T) {
	// Hand-encoded v1 tags: schema_version=1, run_id=2, snapshot_sequence=23.
	wire := []byte{0x0a, 0x03, '1', '.', '0', 0x12, 0x05, 'r', 'u', 'n', '-', '7', 0xb8, 0x01, 0x18}
	var state TrafficState
	if err := proto.Unmarshal(wire, &state); err != nil {
		t.Fatal(err)
	}
	if state.SchemaVersion != "1.0" || state.RunId != "run-7" || state.SnapshotSequence != 24 {
		t.Fatalf("legacy tags changed: %+v", state)
	}
}
