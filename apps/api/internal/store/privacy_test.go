package store

import "testing"

func TestAuditAggregateExportRejectsNestedPrivateFields(t *testing.T) {
	for _, key := range []string{"track_id", "trail", "bbox_history", "raw_frame", "credentials", "trackId", "tracking-ID", "accessToken", "compute_token"} {
		if RejectPrivateFields(map[string]any{"events": []any{map[string]any{key: "private"}}}) == nil {
			t.Fatalf("export accepted %s", key)
		}
	}
	if err := RejectPrivateFields(map[string]any{"crossings_veh": 0, "queue_visible_veh_estimate": nil}); err != nil {
		t.Fatal(err)
	}
}
