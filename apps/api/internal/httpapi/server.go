package httpapi

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
	"traffic.local/twin/apps/api/internal/config"
	"traffic.local/twin/apps/api/internal/contracts"
	"traffic.local/twin/apps/api/internal/store"
	"traffic.local/twin/apps/api/internal/store/queries"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

type Server struct {
	intelligence       pb.IntelligenceClient
	analysis           *pb.Analysis
	analysisFault      string
	recommendationTime float64
	manual             bool
	replaying          bool
	replayCancel       context.CancelFunc
	AllowedOrigin      string
	Network            config.Network
	Store              *store.Store
	mu                 sync.RWMutex
	state              *pb.TrafficState
	sim                *simulationLink
}
type apiError struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func send(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, status int, message string) {
	send(w, status, apiError{http.StatusText(status), message})
}
func (s *Server) SetState(state *pb.TrafficState) error {
	if e := contracts.ValidateState(state); e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = proto.Clone(state).(*pb.TrafficState)
	return nil
}
func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Recoverer)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			if r.Method != "GET" && r.Method != "HEAD" {
				if origin := r.Header.Get("Origin"); origin != "" {
					u, e := url.Parse(origin)
					if e != nil || (u.Host != r.Host && origin != s.AllowedOrigin) {
						problem(w, 403, "Cross-origin commands are disabled")
						return
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	})
	r.Get("/api/v1/network", func(w http.ResponseWriter, r *http.Request) { send(w, 200, s.Network) })
	r.Get("/api/v1/state", func(w http.ResponseWriter, r *http.Request) {
		s.mu.RLock()
		defer s.mu.RUnlock()
		if s.state == nil || (s.sim != nil && (time.Since(s.sim.received) > 2500*time.Millisecond || s.sim.fault != "")) {
			problem(w, 503, "Simulation not connected; no traffic measurements available")
			return
		}
		b, e := (protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true}).Marshal(s.state)
		if e != nil {
			problem(w, 500, "State serialization failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(b)
	})
	r.Get("/api/v1/junctions/{id}", func(w http.ResponseWriter, r *http.Request) {
		for _, n := range s.Network.Nodes {
			if n.ID == chi.URLParam(r, "id") {
				phases := []config.Phase{}
				for _, p := range s.Network.Phases {
					if p.Node == n.ID {
						phases = append(phases, p)
					}
				}
				send(w, 200, struct {
					Node         config.Node    `json:"node"`
					Phases       []config.Phase `json:"phases"`
					Availability string         `json:"availability"`
				}{n, phases, "configuration_only"})
				return
			}
		}
		problem(w, 404, "Unknown junction")
	})
	r.Get("/api/v1/health", func(w http.ResponseWriter, r *http.Request) { send(w, 200, s.health(r.Context())) })
	r.Get("/api/v1/runs", func(w http.ResponseWriter, r *http.Request) {
		if !s.db(w) {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		v, e := s.Store.Q.ListRuns(ctx, 50)
		if e != nil {
			problem(w, 503, "Run history unavailable")
			return
		}
		send(w, 200, v)
	})
	r.Post("/api/v1/runs", s.createRun)
	r.Get("/api/v1/audit", func(w http.ResponseWriter, r *http.Request) {
		if !s.db(w) {
			return
		}
		after := int64(0)
		limit := int64(50)
		var e error
		if x := r.URL.Query().Get("after"); x != "" {
			after, e = strconv.ParseInt(x, 10, 64)
			if e != nil || after < 0 {
				problem(w, 400, "after must be a nonnegative integer")
				return
			}
		}
		if x := r.URL.Query().Get("limit"); x != "" {
			limit, e = strconv.ParseInt(x, 10, 32)
			if e != nil || limit < 1 || limit > 100 {
				problem(w, 400, "limit must be 1–100")
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		rows, e := s.Store.Q.ListAudit(ctx, queries.ListAuditParams{Sequence: after, Limit: int32(limit)})
		if e != nil {
			problem(w, 503, "Audit history unavailable")
			return
		}
		next := after
		if len(rows) > 0 {
			next = rows[len(rows)-1].Sequence
		}
		send(w, 200, struct {
			Events []queries.AuditEvent `json:"events"`
			Next   int64                `json:"next_after"`
		}{rows, next})
	})
	r.Get("/api/v1/recommendations/active", s.activeRecommendation)
	r.Get("/api/v1/analysis", s.getAnalysis)
	r.Post("/api/v1/recommendations/{id}/{action}", s.decision)
	r.Post("/api/v1/scenarios/{type}/start", s.startScenario)
	r.Post("/api/v1/scenarios/reset", s.resetScenario)
	r.Post("/api/v1/mode/{mode}", s.setMode)
	r.Post("/api/v1/replay/{scenario}", s.startReplay)
	r.Get("/ws/v1/live", s.live)
	return r
}
func (s *Server) db(w http.ResponseWriter) bool {
	if s.Store == nil {
		problem(w, 503, "Database unavailable; no data was saved")
		return false
	}
	return true
}
func (s *Server) createRun(w http.ResponseWriter, r *http.Request) {
	var command struct {
		Version  string `json:"schema_version"`
		Scenario string `json:"scenario_type"`
		Seed     int64  `json:"seed"`
		Mode     string `json:"mode"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if e := d.Decode(&command); e != nil {
		problem(w, 400, "Invalid JSON command or unknown fields")
		return
	}
	if d.Decode(new(any)) != io.EOF {
		problem(w, 400, "Exactly one command required")
		return
	}
	validScenario := false
	for _, scenario := range s.Network.Scenarios {
		if command.Scenario == scenario.ID {
			validScenario = true
		}
	}
	if command.Version != "1.0" || !validScenario || command.Seed < 1 || command.Seed > 4294967295 || (command.Mode != "observe" && command.Mode != "recommend") {
		problem(w, 400, "Valid schema_version, scenario_type, uint32 seed and observe/recommend mode required")
		return
	}
	if !s.db(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	run, e := s.Store.CreateRun(ctx, s.Network.ID, command.Scenario, command.Mode, command.Seed)
	if e != nil {
		problem(w, 503, "Run could not be saved; retry when database is available")
		return
	}
	send(w, 201, run)
}
func (s *Server) health(ctx context.Context) *pb.HealthState {
	dbStatus, dbMessage := "unavailable", "Database is not configured"
	if s.Store != nil {
		c, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		if s.Store.Pool.Ping(c) == nil {
			dbStatus = "normal"
			dbMessage = "PostgreSQL connected"
		} else {
			dbMessage = "PostgreSQL connection failed"
		}
	}
	simStatus, simMessage := s.simulationHealth()
	s.mu.RLock()
	intStatus, intMessage := "unavailable", "No fresh intelligence"
	if s.analysis != nil && s.analysisFault == "" && s.state != nil && s.analysis.RunId == s.state.RunId && s.state.SimulationTimeS-s.analysis.SimulationTimeS <= 10 {
		intStatus = "normal"
		intMessage = "Conservation forecasts and bounded network candidates"
	}
	s.mu.RUnlock()
	return &pb.HealthState{Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Components: []*pb.ComponentHealth{{Component: "api", Status: "normal", Message: "Go API connected"}, {Component: "database", Status: dbStatus, Message: dbMessage}, {Component: "simulation", Status: simStatus, Message: simMessage}, {Component: "intelligence", Status: intStatus, Message: intMessage}, {Component: "signal_controller", Status: "unavailable", Message: "No live signal control"}}}
}
func (s *Server) live(w http.ResponseWriter, r *http.Request) {
	options := &websocket.AcceptOptions{}
	if s.AllowedOrigin != "" {
		options.OriginPatterns = []string{s.AllowedOrigin}
	}
	c, e := websocket.Accept(w, r, options)
	if e != nil {
		return
	}
	defer c.CloseNow()
	ctx := c.CloseRead(r.Context())
	frames := make(chan *pb.TrafficState, 1)
	s.mu.Lock()
	if s.sim != nil {
		s.sim.subscribers[frames] = struct{}{}
		if s.state != nil && time.Since(s.sim.received) < 2500*time.Millisecond && s.sim.fault == "" {
			frames <- proto.Clone(s.state).(*pb.TrafficState)
		}
	}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if s.sim != nil {
			delete(s.sim.subscribers, frames)
		}
		s.mu.Unlock()
	}()
	sequence := uint64(0)
	auditSequence := int64(0)
	lastRecommendation := ""
	lastAnalysisKey := ""
	if s.Store != nil {
		s.Store.Pool.QueryRow(ctx, "SELECT COALESCE(MAX(sequence),0) FROM audit_events").Scan(&auditSequence)
	}
	write := func(kind string, payload proto.Message) error {
		sequence++
		b, e := (protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true}).Marshal(payload)
		if e != nil {
			return e
		}
		event := struct {
			Version   string          `json:"schema_version"`
			Type      string          `json:"type"`
			Sequence  string          `json:"sequence"`
			Timestamp string          `json:"timestamp"`
			Payload   json.RawMessage `json:"payload"`
		}{"1.0", kind, strconv.FormatUint(sequence, 10), time.Now().UTC().Format(time.RFC3339Nano), b}
		writeCtx, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		return wsjson.Write(writeCtx, c, event)
	}
	if write("health.updated", s.health(ctx)) != nil {
		return
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case frame := <-frames:
			if write("network.state", frame) != nil {
				return
			}
			if frame.Incident != nil && frame.Incident.Id != "" {
				if write("incident.updated", frame.Incident) != nil {
					return
				}
			}
			if frame.Emergency != nil && frame.Emergency.Id != "" {
				if write("emergency.updated", frame.Emergency) != nil {
					return
				}
			}
			for _, signal := range frame.Signals {
				if write("junction.state", signal) != nil {
					return
				}
			}
		case <-ticker.C:
			s.mu.RLock()
			var analysis *pb.Analysis
			if s.analysis != nil && s.analysisFault == "" {
				analysis = proto.Clone(s.analysis).(*pb.Analysis)
			}
			s.mu.RUnlock()
			if analysis != nil {
				key := analysis.RunId + ":" + strconv.FormatFloat(analysis.SimulationTimeS, 'f', 0, 64)
				if key != lastAnalysisKey {
					lastAnalysisKey = key
					for _, f := range analysis.Forecasts {
						if write("forecast.updated", f) != nil {
							return
						}
					}
				}
				if analysis.Recommendation != nil {
					kind := "recommendation.updated"
					if lastRecommendation != analysis.Recommendation.Id {
						kind = "recommendation.created"
						lastRecommendation = analysis.Recommendation.Id
					}
					if write(kind, analysis.Recommendation) != nil {
						return
					}
				}
			}
			if s.Store != nil {
				auditCtx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
				rows, err := s.Store.Q.ListAudit(auditCtx, queries.ListAuditParams{Sequence: auditSequence, Limit: 100})
				cancel()
				if err == nil {
					for _, row := range rows {
						auditSequence = row.Sequence
						event := &pb.AuditEvent{Actor: row.Actor, EventType: row.EventType, Timestamp: row.CreatedAt.Time.UTC().Format(time.RFC3339Nano), Reason: row.Reason, SafetyResult: row.SafetyResult}
						if id, _ := row.ID.Value(); id != nil {
							event.Id = id.(string)
						}
						if id, _ := row.RunID.Value(); id != nil {
							event.RunId = id.(string)
						}
						if id, _ := row.RecommendationID.Value(); id != nil {
							event.RecommendationId = id.(string)
						}
						json.Unmarshal(row.BeforeValues, &event.Before)
						json.Unmarshal(row.AfterValues, &event.After)
						if write("audit.appended", event) != nil {
							return
						}
					}
				}
			}
			if write("health.updated", s.health(ctx)) != nil {
				return
			}
		}
	}
}
