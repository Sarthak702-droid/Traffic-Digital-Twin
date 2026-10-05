package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"io"
	"net/http"
	"regexp"

	"traffic.local/twin/apps/api/internal/store"
)

type responseCapture struct {
	http.ResponseWriter
	statusCode  int
	body        bytes.Buffer
	wroteHeader bool
}

func (r *responseCapture) WriteHeader(code int) {
	if !r.wroteHeader {
		r.statusCode = code
		r.wroteHeader = true
		r.ResponseWriter.WriteHeader(code)
	}
}

func (r *responseCapture) Write(b []byte) (int, error) {
	if !r.wroteHeader {
		r.WriteHeader(http.StatusOK)
	}
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}

// idempotency handles state-changing mutations with Idempotency-Key enforcement (S41).
func (s *Server) idempotency(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if (r.Method != "POST" && r.Method != "PUT" && r.Method != "PATCH" && r.Method != "DELETE") || r.URL.Path == "/api/v1/session/login" || r.URL.Path == "/api/v1/session/logout" {
			next.ServeHTTP(w, r)
			return
		}

		key := r.Header.Get("Idempotency-Key")
		if !regexp.MustCompile(`^[A-Za-z0-9._:-]{8,128}$`).MatchString(key) {
			problem(w, 400, "Valid Idempotency-Key required (8–128 safe ASCII characters)")
			return
		}
		if s.Store == nil {
			problem(w, 503, "Command reservation store unavailable; no action dispatched")
			return
		}

		var bodyBytes []byte
		if r.Body != nil {
			var err error
			bodyBytes, err = io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
			if err != nil {
				problem(w, 400, "Could not read request body for idempotency validation")
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		}

		hash, err := commandEnvelopeHash(r, bodyBytes)
		if err != nil {
			problem(w, 400, "One valid JSON command body required")
			return
		}

		res, err := s.Store.Command(r.Context(), "command.reserve", store.CommandWrite{
			ID:     key,
			Hash:   hash,
			Route:  r.URL.Path,
			Method: r.Method, EnvelopeVersion: "command-v2",
		})
		if err != nil {
			// A write whose durable command identity could not be reserved is
			// intentionally not dispatched. Retrying blindly could duplicate a
			// virtual control action after a transient database failure.
			problem(w, http.StatusServiceUnavailable, "Command identity could not be reserved; no action was dispatched")
			return
		}

		m, _ := res.(map[string]any)
		if m != nil {
			status, _ := m["status"].(string)
			switch status {
			case "completed":
				code := http.StatusOK
				if c, ok := m["http_status"].(*int); ok && c != nil && *c > 0 {
					code = *c
				} else if c, ok := m["http_status"].(int); ok && c > 0 {
					code = c
				} else if c, ok := m["http_status"].(float64); ok && c > 0 {
					code = int(c)
				}
				w.Header().Set("Idempotency-Replayed", "true")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(code)
				if raw, ok := m["response"].(json.RawMessage); ok && len(raw) > 0 {
					w.Write(raw)
				} else if rawStr, ok := m["response"].(string); ok && len(rawStr) > 0 {
					w.Write([]byte(rawStr))
				} else {
					json.NewEncoder(w).Encode(m["response"])
				}
				return

			case "conflict":
				problem(w, 409, "Idempotency key conflict: identical key submitted with different payload or actor")
				return

			case "pending":
				problem(w, 409, "Command with this idempotency key is already pending or in progress")
				return

			case "reserved":
				capture := &responseCapture{
					ResponseWriter: w,
					statusCode:     http.StatusOK,
				}
				next.ServeHTTP(capture, r)

				if capture.statusCode >= 200 && capture.statusCode < 500 {
					var raw json.RawMessage = capture.body.Bytes()
					if len(raw) == 0 {
						raw = json.RawMessage(`{}`)
					}
					if _, err := s.Store.Command(r.Context(), "command.finish", store.CommandWrite{
						ID:         key,
						Hash:       hash,
						HTTPStatus: capture.statusCode,
						Response:   raw,
					}); err != nil {
						// The business handler may already have atomically committed its
						// own outcome. Leave it recoverable through GET /commands/{id};
						// never emit a second business command to compensate here.
						w.Header().Set("Idempotency-Outcome", "unknown")
					}
				}
				return
			}
		}

		problem(w, 503, "Command reservation returned an invalid state; no action dispatched")
	})
}

// Stable actor scope permits recovery after re-login. The concrete path and
// query are bound as well as the route template: path parameters are commands.
func commandEnvelopeHash(r *http.Request, body []byte) (string, error) {
	var value any
	if len(bytes.TrimSpace(body)) > 0 {
		d := json.NewDecoder(bytes.NewReader(body))
		d.UseNumber()
		if err := d.Decode(&value); err != nil {
			return "", err
		}
		if err := d.Decode(new(any)); err != io.EOF {
			return "", io.ErrUnexpectedEOF
		}
	}
	route := ""
	if rc := chi.RouteContext(r.Context()); rc != nil {
		route = rc.RoutePattern()
	}
	envelope := struct {
		Version, Actor, Method, Route, Path, Query string
		AccountVersion                             int
		Body                                       any
	}{
		"command-v2", store.Actor(r.Context()), r.Method, route, r.URL.EscapedPath(), r.URL.Query().Encode(), store.AccountVersion(r.Context()), value,
	}
	b, err := json.Marshal(envelope)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(b)
	return hex.EncodeToString(digest[:]), nil
}
