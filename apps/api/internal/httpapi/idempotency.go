package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"

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
		if r.Method != "POST" && r.Method != "PUT" && r.Method != "PATCH" && r.Method != "DELETE" {
			next.ServeHTTP(w, r)
			return
		}

		key := r.Header.Get("Idempotency-Key")
		if key == "" || len(key) < 8 || len(key) > 128 || s.Store == nil {
			next.ServeHTTP(w, r)
			return
		}

		var bodyBytes []byte
		if r.Body != nil {
			var err error
			bodyBytes, err = io.ReadAll(r.Body)
			if err != nil {
				problem(w, 400, "Could not read request body for idempotency validation")
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		}

		hasher := sha256.New()
		hasher.Write(bodyBytes)
		hash := hex.EncodeToString(hasher.Sum(nil))

		res, err := s.Store.Command(r.Context(), "command.reserve", store.CommandWrite{
			ID:    key,
			Hash:  hash,
			Route: r.URL.Path,
		})
		if err != nil {
			next.ServeHTTP(w, r)
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
					_, _ = s.Store.Command(r.Context(), "command.finish", store.CommandWrite{
						ID:         key,
						Hash:       hash,
						HTTPStatus: capture.statusCode,
						Response:   raw,
					})
				}
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}
