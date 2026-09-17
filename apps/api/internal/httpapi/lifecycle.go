package httpapi

import (
	"context"
	"encoding/json"
	"time"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func (s *Server) persistLifecycle(frame *pb.TrafficState) error {
	if s.Store == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	return s.Store.Write(ctx, "lifecycle", json.RawMessage(jsonProto(frame)), nil)
}
