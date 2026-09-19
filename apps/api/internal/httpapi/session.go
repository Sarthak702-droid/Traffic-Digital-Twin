package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"traffic.local/twin/apps/api/internal/store"
)

// getCommand serves the permissioned command-status read contract (S41).
// It retrieves the recorded outcome of an uncertain or completed command.
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
		send(w, 409, map[string]any{
			"command_id": cmdID,
			"status":     "conflict",
			"code":       "CONFLICT",
			"message":    "Command actor or payload mismatch",
		})
		return
	}

	send(w, 200, map[string]any{
		"command_id":  cmdID,
		"status":      status,
		"http_status": m["http_status"],
		"response":    m["response"],
	})
}

// getSession returns the current actor and role for demonstration sessions.
func (s *Server) getSession(w http.ResponseWriter, r *http.Request) {
	actor := store.Actor(r.Context())
	role := store.Role(r.Context())
	send(w, 200, map[string]string{
		"actor": actor,
		"role":  role,
	})
}

// loginSession authenticates a demonstration operator or supervisor.
func (s *Server) loginSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Username == "" {
		problem(w, 400, "Valid username required")
		return
	}

	role := "operator"
	if strings.Contains(strings.ToLower(req.Username), "super") {
		role = "supervisor"
	} else if strings.Contains(strings.ToLower(req.Username), "view") {
		role = "viewer"
	}

	send(w, 200, map[string]string{
		"actor": req.Username,
		"role":  role,
	})
}

// logoutSession signs out the session.
func (s *Server) logoutSession(w http.ResponseWriter, r *http.Request) {
	send(w, 200, map[string]bool{"success": true})
}
