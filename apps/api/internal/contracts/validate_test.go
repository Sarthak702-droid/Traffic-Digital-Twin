package contracts

import (
	"context"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"
	"math"
	"os"
	"testing"
	"time"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func ValidState() *pb.TrafficState {
	return &pb.TrafficState{SchemaVersion: "1.0", RunId: "run-test", Timestamp: "2026-09-16T00:00:00Z", Source: "synthetic", SimulationTimeS: 0, Movements: []*pb.MovementState{{MovementId: "C6-C3-C1", QueueVeh: 12, ArrivalRateVpm: 20, DepartureRateVpm: 10, AvgSpeedKph: 30, OccupancyRatio: .2, DownstreamCapacityVeh: 80, CurrentPhaseId: "C3-FROM-C6", WaitingAgeS: 10}}}
}
func TestStateValidation(t *testing.T) {
	s := ValidState()
	if e := ValidateState(s); e != nil {
		t.Fatal(e)
	}
	cases := map[string]func(*pb.TrafficState){"version": func(s *pb.TrafficState) { s.SchemaVersion = "2" }, "live": func(s *pb.TrafficState) { s.Source = "live" }, "time": func(s *pb.TrafficState) { s.Timestamp = "bad" }, "occupancy": func(s *pb.TrafficState) { s.Movements[0].OccupancyRatio = 1.1 }, "nan": func(s *pb.TrafficState) { s.Movements[0].QueueVeh = math.NaN() }, "negative": func(s *pb.TrafficState) { s.Movements[0].WaitingAgeS = -1 }, "empty": func(s *pb.TrafficState) { s.Movements = nil }}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			s := ValidState()
			change(s)
			if ValidateState(s) == nil {
				t.Fatal("invalid payload accepted")
			}
		})
	}
}
func TestPythonRoundTrip(t *testing.T) {
	address := os.Getenv("SIMULATION_GRPC_ADDR")
	if address == "" {
		t.Skip("set SIMULATION_GRPC_ADDR for Go/Python integration")
	}
	conn, e := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if e != nil {
		t.Fatal(e)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client := pb.NewSimulationClient(conn)
	good := ValidState()
	result, e := client.ValidateState(ctx, good)
	if e != nil || !result.Valid {
		t.Fatalf("roundtrip: %v %v", result, e)
	}
	bad := proto.Clone(good).(*pb.TrafficState)
	bad.Movements[0].OccupancyRatio = 1.1
	result, e = client.ValidateState(ctx, bad)
	if e != nil || result.Valid || len(result.Errors) == 0 {
		t.Fatalf("invalid state accepted: %v %v", result, e)
	}
}
