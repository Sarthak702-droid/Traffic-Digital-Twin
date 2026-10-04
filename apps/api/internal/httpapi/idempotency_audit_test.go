package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuditIdempotencyNeverBypassesReservation(t *testing.T) {
	for _, key := range []string{"", "short", "abcdefgh", "bad key with spaces"} {
		t.Run(key, func(t *testing.T) {
			s := &Server{}
			called := false
			h := s.idempotency(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
			req := httptest.NewRequest("POST", "/api/v1/mode/manual", nil)
			req.Header.Set("Idempotency-Key", key)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if called {
				t.Fatal("mutation dispatched without durable reservation")
			}
			want := 400
			if key == "abcdefgh" {
				want = 503
			}
			if w.Code != want {
				t.Fatalf("status %d, want %d", w.Code, want)
			}
		})
	}
}

func TestAuditCommandEnvelopeBindsOperation(t *testing.T) {
	hash := func(method, path, body string) string {
		r := httptest.NewRequest(method, path, nil)
		h, e := commandEnvelopeHash(r, []byte(body))
		if e != nil {
			t.Fatal(e)
		}
		return h
	}
	original := hash("POST", "/api/v1/mode/manual", `{"a":1,"b":2}`)
	if original != hash("POST", "/api/v1/mode/manual", `{ "b":2, "a":1 }`) {
		t.Fatal("JSON key order changed identity")
	}
	for _, other := range []string{hash("DELETE", "/api/v1/mode/manual", `{"a":1,"b":2}`), hash("POST", "/api/v1/mode/recommend", `{"a":1,"b":2}`), hash("POST", "/api/v1/mode/manual", `{"a":2,"b":2}`)} {
		if original == other {
			t.Fatal("cross-operation identity collision")
		}
	}
}
