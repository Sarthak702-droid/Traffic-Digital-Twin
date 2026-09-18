package httpapi

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/go-chi/chi/v5"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"net/http"
	"os"
	"path/filepath"
	"time"
	"traffic.local/twin/apps/api/internal/contracts"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

type replayRecord struct {
	State    json.RawMessage `json:"state"`
	Analysis json.RawMessage `json:"analysis"`
}

func (s *Server) startReplay(w http.ResponseWriter, r *http.Request) {
	if !s.requireLease(w) {
		return
	}
	scenario := chi.URLParam(r, "scenario")
	var seed uint32
	for _, c := range s.Network.Scenarios {
		if c.ID == scenario {
			seed = uint32(c.Seed)
		}
	}
	if seed == 0 {
		problem(w, 400, "Unknown replay scenario")
		return
	}
	if !s.db(w) {
		return
	}
	if s.sim == nil {
		problem(w, 503, "Replay stream service unavailable")
		return
	}
	directory := os.Getenv("REPLAY_DIR")
	if directory == "" {
		directory = "packages/replay"
	}
	var manifest struct {
		ConfigID   string `json:"config_id"`
		Recordings map[string]struct {
			SHA256 string `json:"sha256"`
		} `json:"recordings"`
	}
	metadata, e := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if e != nil || json.Unmarshal(metadata, &manifest) != nil || manifest.ConfigID != s.Network.ID {
		problem(w, 503, "Replay manifest/configuration mismatch")
		return
	}
	recording, e := os.ReadFile(filepath.Join(directory, scenario+".jsonl.gz"))
	if e != nil || fmt.Sprintf("%x", sha256.Sum256(recording)) != manifest.Recordings[scenario].SHA256 {
		problem(w, 503, "Replay checksum mismatch")
		return
	}
	file, e := os.Open(filepath.Join(directory, scenario+".jsonl.gz"))
	if e != nil {
		problem(w, 503, "Verified replay recording unavailable")
		return
	}
	defer file.Close()
	gz, e := gzip.NewReader(file)
	if e != nil {
		problem(w, 503, "Invalid replay recording")
		return
	}
	defer gz.Close()
	scanner := bufio.NewScanner(gz)
	scanner.Buffer(make([]byte, 65536), 4<<20)
	var frames []*pb.TrafficState
	var analyses []*pb.Analysis
	for scanner.Scan() {
		var record replayRecord
		frame := new(pb.TrafficState)
		analysis := new(pb.Analysis)
		if json.Unmarshal(scanner.Bytes(), &record) != nil || protojson.Unmarshal(record.State, frame) != nil || frame.ScenarioType != scenario || contracts.ValidateState(frame) != nil {
			problem(w, 503, "Invalid replay state")
			return
		}
		if len(record.Analysis) > 0 && string(record.Analysis) != "null" {
			if protojson.Unmarshal(record.Analysis, analysis) != nil {
				problem(w, 503, "Invalid replay analysis")
				return
			}
		}
		frames = append(frames, frame)
		analyses = append(analyses, analysis)
	}
	if scanner.Err() != nil || len(frames) < 480 {
		problem(w, 503, "Incomplete eight-minute replay")
		return
	}
	s.sim.commands.Lock()
	defer s.sim.commands.Unlock()
	run, e := s.Store.CreateRun(r.Context(), s.Network.ID, scenario, "observe", int64(seed))
	if e != nil {
		problem(w, 503, "Replay run persistence failed")
		return
	}
	if _, e = s.Store.Activate(r.Context(), run.ID, "Started prerecorded synthetic golden replay; controls disabled"); e != nil {
		problem(w, 503, "Replay audit failed")
		return
	}
	value, _ := run.ID.Value()
	runID := value.(string)
	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	if s.replayCancel != nil {
		s.replayCancel()
	}
	s.replayCancel = cancel
	s.replaying = true
	s.manual = true
	s.analysis = nil
	s.state = nil
	s.sim.command = &pb.RunCommand{SchemaVersion: "1.0", RunId: runID, ScenarioType: scenario, Seed: seed, Mode: "observe"}
	s.mu.Unlock()
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for i := 0; i < len(frames); i++ {
			frame := proto.Clone(frames[i]).(*pb.TrafficState)
			frame.RunId = runID
			frame.Replay = true
			frame.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
			if frame.Incident != nil {
				frame.Incident.RunId = runID
			}
			if frame.Emergency != nil {
				frame.Emergency.RunId = runID
			}
			if e := s.acceptFrame(frame); e != nil {
				return
			}
			analysis := proto.Clone(analyses[i]).(*pb.Analysis)
			analysis.RunId = runID
			for _, f := range analysis.Forecasts {
				f.RunId = runID
			}
			analysis.Recommendation = nil
			analysis.Alternatives = nil
			s.mu.Lock()
			if s.replaying && s.sim.command.RunId == runID {
				s.analysis = analysis
				s.analysisFault = ""
			}
			s.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
		s.mu.Lock()
		if s.sim.command.RunId == runID {
			s.sim.fault = "Replay complete; restart recording"
		}
		s.mu.Unlock()
	}()
	send(w, 200, map[string]any{"run_id": runID, "mode": "golden_replay", "frames": len(frames)})
}
