package httpapi

import (
	"context"
	"crypto/subtle"
	"net/http"
	"time"
	"traffic.local/twin/apps/api/internal/store"
)

// The public gateway authenticates users. Private domain transport authenticates
// the gateway again; untrusted browser headers cannot establish a principal.
func (s *Server) access(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.ServiceToken != "" {
			if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Service-Token")), []byte(s.ServiceToken)) != 1 {
				problem(w, 401, "Private domain service")
				return
			}
			role, actor := r.Header.Get("X-Role"), r.Header.Get("X-Actor")
			if actor == "" || (role != "operator" && role != "supervisor" && role != "viewer") {
				problem(w, 401, "Authenticated principal required")
				return
			}
			if r.Method != "GET" && r.Method != "HEAD" && role == "viewer" {
				problem(w, 403, "Viewer cannot change the digital twin")
				return
			}
			r = r.WithContext(store.WithActor(r.Context(), actor))
		}
		if r.URL.Path == "/internal/ready" {
			send(w, 200, map[string]bool{"ready": s.ownerReady.Load()})
			return
		}
		if s.RequireOwner && !s.ownerReady.Load() {
			problem(w, 503, "Run owner unavailable; commands are not dispatched")
			return
		}
		if r.URL.Path != "/ws/v1/live" {
			ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
			defer cancel()
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) MaintainOwnership(ctx context.Context, owner string) {
	var epoch int64
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		var result struct {
			Owner string `json:"owner"`
			Epoch int64  `json:"epoch"`
			Valid bool   `json:"valid"`
		}
		call, cancel := context.WithTimeout(ctx, time.Second)
		e := s.Store.Write(call, "lease", store.LeaseWrite{Owner: owner, Epoch: epoch, Acquire: epoch == 0}, &result)
		cancel()
		valid := e == nil && result.Valid && result.Owner == owner
		s.ownerReady.Store(valid)
		if valid {
			epoch = result.Epoch
		} else {
			epoch = 0
		}
		select {
		case <-ctx.Done():
			s.ownerReady.Store(false)
			return
		case <-ticker.C:
		}
	}
}
