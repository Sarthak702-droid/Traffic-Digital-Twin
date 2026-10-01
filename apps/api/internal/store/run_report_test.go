package store

import (
	"testing"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func TestSeededReportForecastDoesNotInventSourceVideoOrigin(t *testing.T) {
	a := &pb.Analysis{InputQuality: "synthetic", Forecasts: []*pb.Forecast{{InputQuality: "synthetic", HorizonS: 30, OriginSourceS: 0}}}
	item := publicAnalysis(a)["forecasts"].([]any)[0].(map[string]any)
	if item["origin_source_s"] != nil {
		t.Fatal("seeded model forecast invented a source-video origin")
	}
}
