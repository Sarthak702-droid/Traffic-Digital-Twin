package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"

	"traffic.local/twin/apps/api/internal/store"
)

func (s *Server) validOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	if origin == s.AllowedOrigin {
		return true
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return origin == scheme+"://"+r.Host
}

func (s *Server) access(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !s.validOrigin(r) {
			problem(w, http.StatusForbidden, "A matching request origin is required")
			return
		}
		if path == "/health/live" || path == "/health/ready" || path == "/api/v1/session/login" {
			next.ServeHTTP(w, r)
			return
		}
		if s.Sessions == nil || s.AccountsPath == "" {
			problem(w, http.StatusServiceUnavailable, "Authentication unavailable")
			return
		}
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil || cookie.Value == "" {
			problem(w, http.StatusUnauthorized, "Sign in required")
			return
		}
		session, err := s.Sessions.LookupSession(r.Context(), digestToken(cookie.Value))
		if err != nil && !errors.Is(err, store.ErrSessionMissing) {
			problem(w, http.StatusServiceUnavailable, "Session store unavailable")
			return
		}
		if err != nil || session.Revoked || session.Username == "" || !time.Now().Before(session.ExpiresAt) {
			problem(w, http.StatusUnauthorized, "Session expired or revoked")
			return
		}
		account, err := readAccount(s.AccountsPath, session.Username)
		if err != nil || account.Version != session.AccountVersion || !validRole(account.Role) {
			problem(w, http.StatusUnauthorized, "Account changed or unavailable")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && account.Role == "viewer" && path != "/api/v1/session/logout" {
			problem(w, http.StatusForbidden, "Viewer cannot change the digital twin")
			return
		}
		ctx := store.WithRole(store.WithCommand(store.WithActor(r.Context(), session.Username), r.Header.Get("Idempotency-Key")), account.Role)
		if path != "/ws/v1/live" {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, 8*time.Second)
			defer cancel()
		}
		// Client X-Actor and X-Role headers have no authority.
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func validRole(role string) bool {
	return role == "operator" || role == "supervisor" || role == "viewer"
}
