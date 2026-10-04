package httpapi

import (
	"strings"
	"testing"

	"traffic.local/twin/apps/api/internal/store"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func TestAppliedReceiptProducesDurableTerminalDecision(t *testing.T) {
	rec := &pb.Recommendation{Id: "rec-1", Status: "approved", SafetyStatus: "accepted_pending_safe_boundary"}
	write := &store.DecisionWrite{Result: "validated_pending_application"}
	tick := 42.0
	outcome := &pb.PlanOutcome{Status: "applied", AppliedAtSimulationS: &tick, InputSessionId: "epoch-1", SnapshotSequence: 19}
	if !terminalReceipt(rec, write, outcome) {
		t.Fatal("applied receipt did not become terminal")
	}
	if rec.Status != "approved" || rec.SafetyStatus != "virtual_plan_applied" || write.Result != "virtual_plan_applied" {
		t.Fatalf("incorrect applied decision: rec=%v write=%v", rec, write)
	}
	if !strings.Contains(string(write.PlanOutcome), `"applied_at_simulation_s":42`) {
		t.Fatalf("applied tick omitted from audit payload: %s", write.PlanOutcome)
	}
}

func TestAcceptedReceiptRemainsPendingAndRejectedReceiptIsTerminal(t *testing.T) {
	rec := &pb.Recommendation{Id: "rec-1", Status: "approved"}
	write := &store.DecisionWrite{}
	if terminalReceipt(rec, write, &pb.PlanOutcome{Status: "accepted"}) {
		t.Fatal("scheduling acceptance was treated as applied")
	}
	if !terminalReceipt(rec, write, &pb.PlanOutcome{Status: "rejected", Message: "downstream storage"}) {
		t.Fatal("terminal simulator rejection was ignored")
	}
	if rec.Status != "failed" || rec.SafetyStatus != "virtual_plan_rejected" || write.Result != "virtual_plan_rejected" {
		t.Fatalf("rejection not recorded: rec=%v write=%v", rec, write)
	}
}

func TestUnprovenReceiptsCannotSettleDecision(t *testing.T) {
	for _, status := range []string{"unknown", "not_found", "accepted", "interrupted", "conflict"} {
		rec := &pb.Recommendation{Status: "approved"}
		write := &store.DecisionWrite{}
		if terminalReceipt(rec, write, &pb.PlanOutcome{Status: status}) {
			t.Fatalf("unproven %s settled", status)
		}
	}
}
