package store

import (
	"context"
	"encoding/json"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
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
