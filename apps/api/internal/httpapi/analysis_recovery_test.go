package httpapi

import (
	"testing"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func TestFreshDecisionIdentityCannotReviveApprovalAfterRecovery(t *testing.T) {
	a := &pb.Analysis{RunId: "same-run", Recommendation: &pb.Recommendation{Id: "deterministic-old"}, Comparison: &pb.ComparisonResult{RecommendationId: "deterministic-old"}, Alternatives: []*pb.Recommendation{{Id: "old-alternative"}}}
	freshDecisionIdentities(a)
	first := a.Recommendation.Id
	if first == "deterministic-old" || a.Comparison.RecommendationId != first {
		t.Fatal("old decision identity revived")
	}
	freshDecisionIdentities(a)
	if a.Recommendation.Id == first || a.Alternatives[0].Id == "old-alternative" {
		t.Fatal("fresh analysis must have distinct decision identity")
	}
}
