package httpapi

import (
	"net/http/httptest"
	"testing"
)

func TestRunReportRequiresDatabaseAndValidRunID(t *testing.T) {
	s := app(t)
	s.Store = nil
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, testRequest("GET", "/api/v1/runs/not-a-uuid/report", nil))
	if w.Code != 400 {
		t.Fatalf("invalid report identity: %d", w.Code)
	}
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, testRequest("GET", "/api/v1/runs/11111111-1111-4111-8111-111111111111/report", nil))
	if w.Code != 503 {
		t.Fatalf("unavailable storage: %d", w.Code)
	}
}
