package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"traffic.local/twin/apps/api/internal/store"
)

const testAccountJSON = `{"supervisor":{"role":"supervisor","salt":"0123456789abcdef0123456789abcdef0123456789abcdef","hash":"d2a3be1964048d994b5ed534249062d6ced633286096019e1f57904b044807aa","version":1},"bob":{"role":"operator","salt":"0123456789abcdef0123456789abcdef0123456789abcdef","hash":"d2a3be1964048d994b5ed534249062d6ced633286096019e1f57904b044807aa","version":1},"alice":{"role":"operator","salt":"0123456789abcdef0123456789abcdef0123456789abcdef","hash":"d2a3be1964048d994b5ed534249062d6ced633286096019e1f57904b044807aa","version":1},"viewer":{"role":"viewer","salt":"0123456789abcdef0123456789abcdef0123456789abcdef","hash":"d2a3be1964048d994b5ed534249062d6ced633286096019e1f57904b044807aa","version":1}}`

type testSessionStore struct {
	entries   map[string]store.AuthSession
	lookupErr error
}

func (m *testSessionStore) CreateSession(_ context.Context, tokenHash string, entry store.AuthSession) error {
	if m.entries == nil {
		m.entries = map[string]store.AuthSession{}
	}
	m.entries[tokenHash] = entry
	return nil
}
func (m *testSessionStore) LookupSession(_ context.Context, tokenHash string) (store.AuthSession, error) {
	if m.lookupErr != nil {
		return store.AuthSession{}, m.lookupErr
	}
	return m.entries[tokenHash], nil
}
func (m *testSessionStore) RevokeSession(_ context.Context, tokenHash string) error {
	v := m.entries[tokenHash]
	v.Revoked = true
	m.entries[tokenHash] = v
	return nil
}

func authFixture(t *testing.T) (*Server, *testSessionStore, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "accounts.json")
	if err := os.WriteFile(path, []byte(testAccountJSON), 0600); err != nil {
		t.Fatal(err)
	}
	s := app(t)
	s.AccountsPath = path
	s.AllowedOrigin = "http://example.com"
	st := &testSessionStore{}
	s.Sessions = st
	return s, st, path
}

func authRequest(h http.Handler, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Idempotency-Key", "test-key-66901aa4-5464-4201-b3cf-6003393afc24")
	if method != http.MethodGet {
		r.Header.Set("Origin", "http://example.com")
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestLoginRequiresProvisionedPasswordAndSessionCookie(t *testing.T) {
	s, _, _ := authFixture(t)
	h := s.Handler()
	for _, body := range []string{`{"username":"alice","password":"wrong"}`, `{"username":"unknown","password":"correct-test-password"}`} {
		if w := authRequest(h, "POST", "/api/v1/session/login", body, nil); w.Code != http.StatusUnauthorized || len(w.Result().Cookies()) != 0 {
			t.Fatalf("bad credentials accepted: %d %s", w.Code, w.Body.String())
		}
	}
	w := authRequest(h, "POST", "/api/v1/session/login", `{"username":"alice","password":"correct-test-password"}`, nil)
	if w.Code != 200 {
		t.Fatalf("valid account rejected: %d %s", w.Code, w.Body.String())
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Value == "" {
		t.Fatalf("unprotected session cookie: %+v", cookies)
	}
	read := authRequest(h, "GET", "/api/v1/session", "", cookies[0])
	if read.Code != 200 || !strings.Contains(read.Body.String(), `"actor":"alice"`) {
		t.Fatalf("session not verified: %d %s", read.Code, read.Body.String())
	}
}

func TestForgedHeadersAndViewerMutationAreDenied(t *testing.T) {
	s, _, _ := authFixture(t)
	h := s.Handler()
	r := httptest.NewRequest("POST", "/api/v1/runs", strings.NewReader(`{}`))
	r.Header.Set("Idempotency-Key", "test-key-e2c42836-c9b1-4150-9848-1ea0be915fcd")
	r.Header.Set("Origin", "http://example.com")
	r.Header.Set("X-Actor", "admin")
	r.Header.Set("X-Role", "supervisor")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("headers authorized anonymous mutation: %d", w.Code)
	}
	login := authRequest(h, "POST", "/api/v1/session/login", `{"username":"viewer","password":"correct-test-password"}`, nil)
	if login.Code != 200 {
		t.Fatalf("viewer login: %d", login.Code)
	}
	r.AddCookie(login.Result().Cookies()[0])
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("viewer mutation: %d", w.Code)
	}
}

func TestLogoutExpiryAccountRotationAndOriginRevokeAccess(t *testing.T) {
	s, st, path := authFixture(t)
	h := s.Handler()
	login := func() *http.Cookie {
		w := authRequest(h, "POST", "/api/v1/session/login", `{"username":"alice","password":"correct-test-password"}`, nil)
		if w.Code != 200 {
			t.Fatalf("login: %d", w.Code)
		}
		return w.Result().Cookies()[0]
	}
	c := login()
	r := httptest.NewRequest("POST", "/api/v1/session/logout", nil)
	r.Header.Set("Idempotency-Key", "test-key-f504f0f4-2c6e-4784-9368-3d89b9d0751f")
	r.Header.Set("Origin", "https://evil.example")
	r.AddCookie(c)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("cross-origin logout: %d", w.Code)
	}
	if w := authRequest(h, "POST", "/api/v1/session/logout", "", c); w.Code != 200 {
		t.Fatalf("logout: %d", w.Code)
	}
	if w := authRequest(h, "GET", "/api/v1/session", "", c); w.Code != 401 {
		t.Fatalf("revoked session: %d", w.Code)
	}
	c = login()
	for k, v := range st.entries {
		v.ExpiresAt = time.Now().Add(-time.Second)
		st.entries[k] = v
	}
	if w := authRequest(h, "GET", "/api/v1/session", "", c); w.Code != 401 {
		t.Fatalf("expired session: %d", w.Code)
	}
	c = login()
	var accounts map[string]accountRecord
	if err := json.Unmarshal([]byte(testAccountJSON), &accounts); err != nil {
		t.Fatal(err)
	}
	rotated := accounts["alice"]
	rotated.Version++
	accounts["alice"] = rotated
	updated, err := json.Marshal(accounts)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, updated, 0600); err != nil {
		t.Fatal(err)
	}
	if w := authRequest(h, "GET", "/api/v1/session", "", c); w.Code != 401 {
		t.Fatalf("rotated account retained access: %d", w.Code)
	}
}

func TestViewerCanLogoutWithoutMutationAuthority(t *testing.T) {
	s, _, _ := authFixture(t)
	h := s.Handler()
	login := authRequest(h, "POST", "/api/v1/session/login", `{"username":"viewer","password":"correct-test-password"}`, nil)
	if login.Code != 200 {
		t.Fatalf("viewer login: %d", login.Code)
	}
	cookie := login.Result().Cookies()[0]
	if w := authRequest(h, "POST", "/api/v1/session/logout", "", cookie); w.Code != 200 {
		t.Fatalf("viewer logout: %d", w.Code)
	}
	if w := authRequest(h, "GET", "/api/v1/session", "", cookie); w.Code != 401 {
		t.Fatalf("viewer session retained: %d", w.Code)
	}
}

func TestDatabaseSessionSurvivesHandlerRecreationAndRevokes(t *testing.T) {
	st, cleanup := setupTestStore(t)
	if st == nil {
		return
	}
	defer cleanup()
	s, _, _ := authFixture(t)
	s.Sessions = st
	login := authRequest(s.Handler(), "POST", "/api/v1/session/login", `{"username":"alice","password":"correct-test-password"}`, nil)
	if login.Code != 200 {
		t.Fatalf("database login: %d %s", login.Code, login.Body.String())
	}
	cookie := login.Result().Cookies()[0]
	other := app(t)
	other.AccountsPath = s.AccountsPath
	other.Sessions = st
	if w := authRequest(other.Handler(), "GET", "/api/v1/session", "", cookie); w.Code != 200 {
		t.Fatalf("session lost on handler recreation: %d", w.Code)
	}
	if w := authRequest(other.Handler(), "POST", "/api/v1/session/logout", "", cookie); w.Code != 200 {
		t.Fatalf("database logout: %d", w.Code)
	}
	if w := authRequest(s.Handler(), "GET", "/api/v1/session", "", cookie); w.Code != 401 {
		t.Fatalf("revoked session accepted by first handler: %d", w.Code)
	}
}

func TestLoginDoesNotReserveOperatorCommandIdentity(t *testing.T) {
	st, cleanup := setupTestStore(t)
	if st == nil {
		return
	}
	defer cleanup()
	s, _, _ := authFixture(t)
	s.Sessions, s.Store = st, st
	r := httptest.NewRequest("POST", "/api/v1/session/login", strings.NewReader(`{"username":"alice","password":"correct-test-password"}`))
	r.Header.Set("Idempotency-Key", "test-key-d5fe7fb8-f7f2-4287-b51e-4c2b80e9922f")
	r.Header.Set("Origin", "http://example.com")
	r.Header.Set("Idempotency-Key", "login-must-not-reserve")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("login with command header: %d %s", w.Code, w.Body.String())
	}
	var count int
	if err := st.Pool.QueryRow(context.Background(), "SELECT count(*) FROM command_outcomes WHERE id='login-must-not-reserve'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("login reserved command identity: %d %v", count, err)
	}
}

func TestSessionStoreFailureIsUnavailableNotExpired(t *testing.T) {
	s, st, _ := authFixture(t)
	login := authRequest(s.Handler(), "POST", "/api/v1/session/login", `{"username":"alice","password":"correct-test-password"}`, nil)
	if login.Code != 200 {
		t.Fatalf("login: %d", login.Code)
	}
	st.lookupErr = errors.New("database offline")
	w := authRequest(s.Handler(), "GET", "/api/v1/session", "", login.Result().Cookies()[0])
	if w.Code != 503 {
		t.Fatalf("dependency loss presented as expired session: %d", w.Code)
	}
}
