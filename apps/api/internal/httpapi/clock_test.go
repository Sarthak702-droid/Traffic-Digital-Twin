package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClockControlIsAuthenticatedAndUnavailableWithoutStore(t *testing.T) {
	s := app(t)
	w := httptest.NewRecorder()
	r := testRequest("POST", "/api/v1/runs/11111111-1111-4111-8111-111111111111/clock", strings.NewReader(`{"paused":true}`))
	s.Handler().ServeHTTP(w, r)
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	w = httptest.NewRecorder()
	r = testRequest("POST", "/api/v1/runs/11111111-1111-4111-8111-111111111111/clock", strings.NewReader(`{"paused":true}`))
	r.Header.Set("Cookie", sessionCookieName+"=viewer-token")
	s.Handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
}
