package httpapi

import (
	"context"
	"net/http"
	"time"
	"traffic.local/twin/apps/api/internal/store"
)

// This local demonstration uses an explicit demo role header. Production auth
// remains a replaceable Go boundary; browser traffic never passes through a
// Python gateway.
func (s *Server) access(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role, actor := r.Header.Get("X-Role"), r.Header.Get("X-Actor")
		if actor == "" {
			actor = "demo-operator"
		}
		if role == "" {
			role = "operator"
		}
		if role != "operator" && role != "supervisor" && role != "viewer" && role != "observer" {
			problem(w, 401, "A valid demonstration role is required")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && (role == "viewer" || role == "observer") {
			problem(w, 403, "Viewer cannot change the digital twin")
			return
		}
		r = r.WithContext(store.WithRole(store.WithCommand(store.WithActor(r.Context(), actor), r.Header.Get("Idempotency-Key")), role))
		if r.URL.Path != "/ws/v1/live" {
			ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
			defer cancel()
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}
