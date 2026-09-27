package store

import (
	"context"
	"encoding/json"
	"errors"
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
