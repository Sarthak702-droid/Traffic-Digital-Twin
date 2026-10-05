package httpapi

import (
	"context"
	"errors"
	"github.com/coder/websocket"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
	"traffic.local/twin/apps/api/internal/store"
)

type synchronizedSessions struct {
	mu          sync.Mutex
	entry       store.AuthSession
	unavailable bool
}

func (s *synchronizedSessions) CreateSession(_ context.Context, _ string, e store.AuthSession) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entry = e
	return nil
}
func (s *synchronizedSessions) LookupSession(context.Context, string) (store.AuthSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.unavailable {
		return store.AuthSession{}, errors.New("offline")
	}
	return s.entry, nil
}
func (s *synchronizedSessions) RevokeSession(context.Context, string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entry.Revoked = true
	return nil
}
func TestAuditWebSocketClosesOnAuthorityLoss(t *testing.T) {
	for _, failure := range []string{"expiry", "revocation", "account_version", "store_unavailable", "session_identity"} {
		t.Run(failure, func(t *testing.T) {
			s := app(t)
			sessions := &synchronizedSessions{entry: store.AuthSession{Username: "alice", AccountVersion: 1, ExpiresAt: time.Now().Add(time.Hour)}}
			if failure == "expiry" {
				sessions.entry.ExpiresAt = time.Now().Add(400 * time.Millisecond)
			}
			s.Sessions = sessions
			server := httptest.NewServer(s.Handler())
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/ws/v1/live", &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": []string{sessionCookieName + "=test-token"}, "Origin": []string{"http://example.com"}}})
			if err != nil {
				t.Fatal(err)
			}
			defer conn.CloseNow()
			if _, _, err = conn.Read(ctx); err != nil {
				t.Fatal("initial authorized telemetry", err)
			}
			start := time.Now()
			sessions.mu.Lock()
			switch failure {
			case "revocation":
				sessions.entry.Revoked = true
			case "store_unavailable":
				sessions.unavailable = true
			case "session_identity":
				sessions.entry.Username = "bob"
			}
			sessions.mu.Unlock()
			if failure == "account_version" {
				if err = os.WriteFile(s.AccountsPath, []byte(strings.ReplaceAll(testAccountJSON, `"version":1`, `"version":2`)), 0600); err != nil {
					t.Fatal(err)
				}
			}
			for {
				_, _, err = conn.Read(ctx)
				if err != nil {
					break
				}
			}
			if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
				t.Fatalf("stream did not fail closed: %v", err)
			}
			if time.Since(start) > time.Second {
				t.Fatal("authority invalidation took more than one second")
			}
		})
	}
}
