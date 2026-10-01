package httpapi

import (
	"context"
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"net/http"
	"time"
)

func (s *Server) getRunReport(w http.ResponseWriter, r *http.Request) {
	var id pgtype.UUID
	if err := id.Scan(chi.URLParam(r, "id")); err != nil || !id.Valid {
		problem(w, 400, "A valid run UUID is required")
		return
	}
	if !s.db(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	report, err := s.Store.RunReport(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		problem(w, 404, "Run not found")
		return
	}
	if err != nil {
		problem(w, 503, "Durable run report unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", `attachment; filename="traffic-run-`+id.String()+`.json"`)
	send(w, 200, report)
}
