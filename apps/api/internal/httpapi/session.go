package httpapi

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"traffic.local/twin/apps/api/internal/store"
)

const sessionCookieName = "twin_session"
const sessionLifetime = 8 * time.Hour

type sessionRepository interface {
	CreateSession(context.Context, string, store.AuthSession) error
	LookupSession(context.Context, string) (store.AuthSession, error)
	RevokeSession(context.Context, string) error
}

type accountRecord struct {
	Role    string `json:"role"`
	Salt    string `json:"salt"`
	Hash    string `json:"hash"`
	Version int    `json:"version"`
}

func readAccount(path, username string) (accountRecord, error) {
	var empty accountRecord
	f, err := os.Open(path)
	if err != nil {
		return empty, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return empty, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return empty, os.ErrPermission
	}
	var accounts map[string]accountRecord
	d := json.NewDecoder(io.LimitReader(f, 1<<20))
	if err := d.Decode(&accounts); err != nil {
		return empty, err
	}
	account, ok := accounts[username]
	if !ok || !validRole(account.Role) || account.Version < 1 {
		return empty, os.ErrNotExist
	}
	return account, nil
}

func verifyPassword(password string, account accountRecord) bool {
	if password == "" || len(password) > 1024 || len(account.Salt) != 48 || len(account.Hash) != 64 {
		return false
	}
	want, err := hex.DecodeString(account.Hash)
	if err != nil {
		return false
	}
	derived, err := pbkdf2.Key(sha256.New, password, []byte(account.Salt), 600000, 32)
	return err == nil && subtle.ConstantTimeCompare(derived, want) == 1
}

func digestToken(token string) string {
	d := sha256.Sum256([]byte(token))
	return hex.EncodeToString(d[:])
}

func (s *Server) sessionCookie(r *http.Request, token string, maxAge int) *http.Cookie {
	return &http.Cookie{Name: sessionCookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil || strings.HasPrefix(s.AllowedOrigin, "https://"), MaxAge: maxAge}
}

func (s *Server) getSession(w http.ResponseWriter, r *http.Request) {
	send(w, 200, map[string]string{"actor": store.Actor(r.Context()), "role": store.Role(r.Context())})
}

func (s *Server) loginSession(w http.ResponseWriter, r *http.Request) {
	if s.Sessions == nil || s.AccountsPath == "" {
		problem(w, 503, "Authentication unavailable")
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if d.Decode(&req) != nil || d.Decode(new(any)) != io.EOF || req.Username == "" || req.Password == "" {
		problem(w, 400, "Valid username and password required")
		return
	}
	account, err := readAccount(s.AccountsPath, req.Username)
	if err != nil || !verifyPassword(req.Password, account) {
		problem(w, 401, "Invalid credentials")
		return
	}
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		problem(w, 503, "Session unavailable")
		return
	}
	token := base64.RawURLEncoding.EncodeToString(raw[:])
	if err := s.Sessions.CreateSession(r.Context(), digestToken(token), store.AuthSession{Username: req.Username, AccountVersion: account.Version, ExpiresAt: time.Now().Add(sessionLifetime)}); err != nil {
		problem(w, 503, "Session unavailable")
		return
	}
	http.SetCookie(w, s.sessionCookie(r, token, int(sessionLifetime.Seconds())))
	send(w, 200, map[string]string{"actor": req.Username, "role": account.Role})
}

func (s *Server) logoutSession(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || s.Sessions.RevokeSession(r.Context(), digestToken(cookie.Value)) != nil {
		problem(w, 503, "Session revocation unavailable")
		return
	}
	http.SetCookie(w, s.sessionCookie(r, "", -1))
	send(w, 200, map[string]bool{"success": true})
}

// getCommand lets the same authenticated actor recover an uncertain command
// after reauthentication. The durable outcome is scoped by actor in Store.
func (s *Server) getCommand(w http.ResponseWriter, r *http.Request) {
	cmdID := strings.TrimSpace(chi.URLParam(r, "id"))
	if len(cmdID) < 8 || len(cmdID) > 128 {
		problem(w, 400, "Valid command ID required (8–128 characters)")
		return
	}
	if !s.db(w) {
		return
	}
	res, err := s.Store.Command(r.Context(), "command.get", store.CommandWrite{ID: cmdID})
	if err != nil {
		problem(w, 404, "Command not found")
		return
	}
	m, ok := res.(map[string]any)
	if !ok {
		problem(w, 500, "Invalid command outcome state")
		return
	}
	status, _ := m["status"].(string)
	if status == "conflict" {
		send(w, 409, map[string]any{"command_id": cmdID, "status": "conflict", "code": "CONFLICT", "message": "Command actor or payload mismatch"})
		return
	}
	send(w, 200, map[string]any{"command_id": cmdID, "status": status, "http_status": m["http_status"], "response": m["response"]})
}

// A stream never outlives the credential/session which authorized its upgrade.
func (s *Server) liveSessionValid(r *http.Request) bool {
	return s.liveSessionMatches(r, nil)
}
func (s *Server) liveSessionMatches(r *http.Request, bound *store.AuthSession) bool {
	if s.Sessions == nil {
		return false
	}
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 500*time.Millisecond)
	defer cancel()
	session, err := s.Sessions.LookupSession(ctx, digestToken(cookie.Value))
	if err != nil || session.Revoked || !time.Now().Before(session.ExpiresAt) {
		return false
	}
	if bound != nil && (session.Username != bound.Username || session.AccountVersion != bound.AccountVersion || !session.ExpiresAt.Equal(bound.ExpiresAt)) {
		return false
	}
	account, err := readAccount(s.AccountsPath, session.Username)
	return err == nil && account.Version == session.AccountVersion && validRole(account.Role)
}
