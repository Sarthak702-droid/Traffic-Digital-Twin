package httpapi

import (
	"context"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"testing"
	"time"
	"traffic.local/twin/apps/api/internal/store"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

type delayedEmptySimulation struct {
	pb.SimulationClient
	calls int
}

func (c *delayedEmptySimulation) GetState(context.Context, *pb.RunRequest, ...grpc.CallOption) (*pb.TrafficState, error) {
	c.calls++
	if c.calls == 1 {
		return nil, status.Error(codes.Unavailable, "Starting")
	}
	return nil, status.Error(codes.FailedPrecondition, "No active simulation")
}
func TestRestartReconciliationRetriesStartupDependencyRace(t *testing.T) {
	st, cleanup := setupTestStore(t)
	if st == nil {
		return
	}
	defer cleanup()
	s := app(t)
	s.Store = st
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	ctx = store.WithActor(ctx, "recovery-test")
	run, err := st.CreateRun(ctx, s.Network.ID, "peak_surge", "recommend", 1101)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = st.Activate(ctx, run.ID, "recovery regression"); err != nil {
		t.Fatal(err)
	}
	s.sim = &simulationLink{client: &delayedEmptySimulation{}, command: &pb.RunCommand{RunId: run.ID.String()}}
	if err = s.reconcileRecoveredSimulation(ctx); err != nil {
		t.Fatal(err)
	}
	go s.reconcileUnobservedRun(ctx)
	for ctx.Err() == nil {
		saved, err := st.Q.GetRun(ctx, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if saved.Status == "ended" {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("Startup dependency race left durable run falsely running")
}
