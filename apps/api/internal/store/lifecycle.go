package store

import (
	"context"
	"encoding/json"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"time"
	"traffic.local/twin/apps/api/internal/contracts"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

// Persist lifecycle transitions, never high-frequency traffic frames.
func (s *Store) SaveLifecycle(ctx context.Context, data []byte) error {
	frame := new(pb.TrafficState)
	if e := protojson.Unmarshal(data, frame); e != nil {
		return e
	}
	if e := contracts.ValidateState(frame); e != nil {
		return e
	}
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if frame.SchemaVersion == "1.1" {
		_, e = tx.Exec(ctx, "UPDATE scenario_runs SET engine_kind=$1,model_version=$2,metrics_version=$3,config_hash=$4 WHERE id=$5", frame.EngineKind, frame.ModelVersion, frame.MetricsVersion, frame.ConfigHash, frame.RunId)
		if e != nil {
			return e
		}
		// Persist public aggregate summaries at a bounded one-minute cadence;
		// never persist individual cells or every 1 Hz state frame.
		if int(frame.SimulationTimeS) > 0 && int(frame.SimulationTimeS)%60 == 0 {
			windowStart := time.Unix(int64(frame.SimulationTimeS/60)*60, 0).UTC()
			_, e = tx.Exec(ctx, "INSERT INTO traffic_state_snapshots(id,run_id,window_start,window_s,aggregate) VALUES($1,$2,$3,60,$4) ON CONFLICT(run_id,window_start,window_s) DO UPDATE SET aggregate=EXCLUDED.aggregate", UUID(), frame.RunId, windowStart, marshalProto(frame))
			if e != nil {
				return e
			}
		}
	}
	type transition struct {
		kind, status string
		payload      []byte
	}
	var events []transition
	if frame.Incident != nil && frame.Incident.Id != "" {
		events = append(events, transition{"incident", frame.Incident.Status, marshalProto(frame.Incident)})
	}
	if frame.Emergency != nil && frame.Emergency.Id != "" {
		events = append(events, transition{"emergency", frame.Emergency.Status, marshalProto(frame.Emergency)})
	}
	for _, event := range events {
		var exists bool
		e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM audit_events WHERE run_id=$1 AND event_type=$2)", frame.RunId, event.kind+"."+event.status).Scan(&exists)
		if e != nil {
			return e
		}
		if exists {
			continue
		}
		if event.kind == "incident" {
			_, e = tx.Exec(ctx, "INSERT INTO incidents(id,run_id,node_id,capacity_ratio,status,payload) VALUES($1,$2,$3,$4,$5,$6)", UUID(), frame.RunId, frame.Incident.NodeId, frame.Incident.CapacityRatio, event.status, event.payload)
		} else {
			_, e = tx.Exec(ctx, "INSERT INTO emergencies(id,run_id,status,payload) VALUES($1,$2,$3,$4)", UUID(), frame.RunId, event.status, event.payload)
		}
		if e != nil {
			return e
		}
		reason, _ := json.Marshal(map[string]string{"status": event.status})
		_, e = tx.Exec(ctx, "INSERT INTO audit_events(id,run_id,actor,event_type,before_values,after_values,reason,safety_result) VALUES($1,$2,'simulation',$3,'{}',$4,$5,'virtual_scenario')", UUID(), frame.RunId, event.kind+"."+event.status, event.payload, string(reason))
		if e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}

func marshalProto(v proto.Message) []byte {
	b, _ := (protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true}).Marshal(v)
	return b
}
