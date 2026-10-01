package store

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/encoding/protojson"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

type ReportEvidenceEvent struct {
	Sequence  int64
	Kind      string
	Payload   json.RawMessage
	CreatedAt time.Time
}

// SaveAnalysisEvidence records the typed computation result before it can be
// replaced by the next in-memory analysis. Analysis contains aggregate model
// output, not raw video, credentials, or transient tracking identities.
func (s *Store) SaveAnalysisEvidence(ctx context.Context, analysis *pb.Analysis) error {
	if analysis == nil || analysis.RunId == "" || (analysis.Outcome != "recommend" && analysis.Outcome != "no_action" && analysis.Outcome != "cannot_evaluate") {
		return errors.New("report analysis identity and outcome required")
	}
	payload, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(analysis)
	if err != nil {
		return err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if analysis.Recommendation != nil {
		rec := analysis.Recommendation
		if rec.Id == "" || rec.RunId != analysis.RunId {
			return errors.New("analysis recommendation identity differs")
		}
		recPayload, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(rec)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO recommendations(id,run_id,status,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", rec.Id, rec.RunId, rec.Status, recPayload); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, "INSERT INTO run_evidence_events(id,run_id,kind,payload) VALUES($1,$2,'analysis',$3)", UUID(), analysis.RunId, payload); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ListReportEvidence(ctx context.Context, runID pgtype.UUID) ([]ReportEvidenceEvent, error) {
	rows, err := s.Pool.Query(ctx, "SELECT sequence,kind,payload,created_at FROM run_evidence_events WHERE run_id=$1 ORDER BY sequence", runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []ReportEvidenceEvent{}
	for rows.Next() {
		var event ReportEvidenceEvent
		if err := rows.Scan(&event.Sequence, &event.Kind, &event.Payload, &event.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

// SaveObservationEvidence stores an aggregate finalized window once. A repeated
// identity with different content is an error, preserving source provenance.
func (s *Store) SaveObservationEvidence(ctx context.Context, runID pgtype.UUID, observation *pb.FinalizedObservation) error {
	if !runID.Valid || observation == nil || observation.ObservationId == "" || observation.CameraId == "" || observation.SourceIdentity == nil || observation.SourceIdentity.SourceSessionId == "" || observation.WindowEndS <= observation.WindowStartS || observation.AvailableAtSourceS < observation.WindowEndS || observation.ProcessedAtUtc == "" {
		return errors.New("finalized observation identity and completion required")
	}
	payload, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(observation)
	if err != nil {
		return err
	}
	tag, err := s.Pool.Exec(ctx, "INSERT INTO run_evidence_events(id,run_id,event_identity,kind,payload) VALUES($1,$2,$3,'observation',$4) ON CONFLICT DO NOTHING", UUID(), runID, observation.ObservationId, payload)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	var prior []byte
	if err = s.Pool.QueryRow(ctx, "SELECT payload FROM run_evidence_events WHERE run_id=$1 AND kind='observation' AND event_identity=$2", runID, observation.ObservationId).Scan(&prior); err != nil {
		return err
	}
	var left, right any
	if err = json.Unmarshal(prior, &left); err != nil {
		return err
	}
	if err = json.Unmarshal(payload, &right); err != nil {
		return err
	}
	if !reflect.DeepEqual(left, right) {
		return errors.New("duplicate observation identity has different content")
	}
	return nil
}

// Failure codes are public, bounded categories; private RPC error text never
// enters the export. Each call represents one observed failure episode.
func (s *Store) SaveRunFailure(ctx context.Context, runID pgtype.UUID, code string) error {
	switch code {
	case "compute_unavailable", "simulation_unavailable", "stale_analysis", "invalid_input":
	default:
		return errors.New("unsupported report failure code")
	}
	payload, err := json.Marshal(map[string]string{"code": code})
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, "INSERT INTO run_evidence_events(id,run_id,kind,payload) VALUES($1,$2,'failure',$3)", UUID(), runID, payload)
	return err
}
func (s *Store) SaveAnalysisLatency(ctx context.Context, runID pgtype.UUID, seconds float64) error {
	if !runID.Valid || seconds < 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return errors.New("finite measured analysis latency required")
	}
	payload, err := json.Marshal(map[string]float64{"analysis_wall_s": seconds})
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, "INSERT INTO run_evidence_events(id,run_id,kind,payload) VALUES($1,$2,'resource',$3)", UUID(), runID, payload)
	return err
}

func (s *Store) SaveClockAudit(ctx context.Context, runID pgtype.UUID, paused bool, status string, frames ...*pb.TrafficState) error {
	if status != "requested" && status != "confirmed" && status != "unknown" {
		return errors.New("invalid clock audit status")
	}
	var response map[string]any
	if status == "confirmed" {
		if len(frames) != 1 || frames[0] == nil || frames[0].RunId != runID.String() || frames[0].SimulationPaused != paused {
			return errors.New("confirmed clock snapshot identity required")
		}
		frame := frames[0]
		response = map[string]any{"run_id": frame.RunId, "paused": paused, "simulation_time_s": frame.SimulationTimeS, "snapshot_sequence": frame.SnapshotSequence}
	}
	payload, err := json.Marshal(map[string]any{"command_id": CommandID(ctx), "paused": paused, "status": status})
	if err != nil {
		return err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, "INSERT INTO audit_events(id,run_id,actor,event_type,before_values,after_values,reason,safety_result) VALUES($1,$2,$3,'clock.changed','{}',$4,'Explicit virtual clock review control','virtual_only')", UUID(), runID, Actor(ctx), payload)
	if err != nil {
		return err
	}
	if status == "confirmed" {
		if err = completeCommand(ctx, tx, CommandID(ctx), response); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type PerceptionResource struct {
	FreshInferenceFPS *float64 `json:"fresh_inference_fps"`
	PeakCPUPercent    float64  `json:"peak_cpu_percent"`
	PeakRAMBytes      float64  `json:"peak_ram_bytes"`
	WallS             float64  `json:"wall_s"`
}

func (s *Store) SavePerceptionResource(ctx context.Context, runID pgtype.UUID, camera, session string, resource PerceptionResource) error {
	if !runID.Valid || camera == "" || session == "" || resource.WallS <= 0 {
		return errors.New("identified measured perception resource required")
	}
	values := []float64{resource.PeakCPUPercent, resource.PeakRAMBytes, resource.WallS}
	if resource.FreshInferenceFPS != nil {
		values = append(values, *resource.FreshInferenceFPS)
	}
	for _, v := range values {
		if v < 0 || math.IsNaN(v) || math.IsInf(v, 0) {
			return errors.New("invalid perception resource")
		}
	}
	payload, err := json.Marshal(map[string]any{"camera_id": camera, "source_session_id": session, "perception": resource})
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, "INSERT INTO run_evidence_events(id,run_id,event_identity,kind,payload) VALUES($1,$2,$3,'resource',$4) ON CONFLICT DO NOTHING", UUID(), runID, "perception:"+camera+":"+session, payload)
	return err
}
