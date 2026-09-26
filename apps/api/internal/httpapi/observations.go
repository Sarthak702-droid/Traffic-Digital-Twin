package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"traffic.local/twin/apps/api/internal/store"
)

func (s *Server) videoProfileReady() bool {
	if len(s.Network.CameraBoundaryLinks) == 0 {
		return false
	}
	for camera, boundary := range s.Network.CameraBoundaryLinks {
		entries := s.processedEntries(camera)
		if len(entries) != 1 || entries[0].Status != "cached_valid" {
			return false
		}
		for _, row := range entries[0].Rows {
			if row.BoundaryLinkID != boundary {
				return false
			}
		}
	}
	return true
}

type ObservationResponse struct {
	SchemaVersion   string              `json:"schema_version"`
	CameraID        string              `json:"camera_id,omitempty"`
	SourceSessionID string              `json:"source_session_id,omitempty"`
	InputSessionID  string              `json:"input_session_id,omitempty"`
	Status          string              `json:"status"`
	Reason          string              `json:"reason,omitempty"`
	Count           int                 `json:"count"`
	Observations    []publicObservation `json:"observations"`
}

func (s *Server) getObservations(w http.ResponseWriter, r *http.Request) {
	camID := r.URL.Query().Get("camera_id")
	if camID != "" && !regexp.MustCompile(`^CAM-[0-9]{2}$`).MatchString(camID) {
		problem(w, 400, "Invalid registered camera ID")
		return
	}
	selectedSession := r.URL.Query().Get("source_session_id")
	inputSession := ""
	var boundIdentity store.SourceBinding
	if runID := r.URL.Query().Get("run_id"); runID != "" {
		if camID == "" {
			problem(w, 400, "camera_id is required for a run-scoped observation query")
			return
		}
		if !s.db(w) {
			return
		}
		var id pgtype.UUID
		if err := id.Scan(runID); err != nil {
			problem(w, 400, "run_id must be a UUID")
			return
		}
		binding, err := s.Store.GetRunInput(r.Context(), id)
		if err != nil {
			problem(w, 404, "Run has no recorded input binding")
			return
		}
		bound := binding.SourceSessions[camID]
		if bound == "" {
			problem(w, 409, "Camera is not part of this run input")
			return
		}
		if selectedSession != "" && selectedSession != bound {
			problem(w, 409, "Source session does not match the run binding")
			return
		}
		selectedSession = bound
		inputSession = binding.InputSessionID
		boundIdentity = binding.SourceIdentities[camID]
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "cached_observations"
	}
	if mode != "cached_observations" {
		problem(w, 409, "Online inference requires a running vision job; select cached observations")
		return
	}

	startS := 0.0
	if val := r.URL.Query().Get("start_s"); val != "" {
		var err error
		startS, err = strconv.ParseFloat(val, 64)
		if err != nil || !finiteSource(startS) {
			problem(w, 400, "start_s must be finite and nonnegative")
			return
		}
	}

	endS := 1e12
	if val := r.URL.Query().Get("end_s"); val != "" {
		var err error
		endS, err = strconv.ParseFloat(val, 64)
		if err != nil || !finiteSource(endS) {
			problem(w, 400, "end_s must be finite and nonnegative")
			return
		}
	}
	if endS < startS {
		problem(w, 400, "end_s must not precede start_s")
		return
	}
	asOf := 1e12
	if val := r.URL.Query().Get("as_of_source_s"); val != "" {
		var err error
		asOf, err = strconv.ParseFloat(val, 64)
		if err != nil || !finiteSource(asOf) {
			problem(w, 400, "as_of_source_s must be finite and nonnegative")
			return
		}
	}
	entry, err := selectProcessedEntry(s.processedEntries(camID), selectedSession)
	if err != nil {
		if !os.IsNotExist(err) {
			problem(w, 409, err.Error())
			return
		}
		send(w, 200, ObservationResponse{SchemaVersion: "camera-observation-v1", CameraID: camID, InputSessionID: inputSession, Status: "missing", Reason: "No matching finalized source session", Observations: []publicObservation{}})
		return
	}
	if inputSession != "" && entry.Manifest.sourceBinding() != boundIdentity {
		problem(w, 409, "Processed source identity changed after run binding")
		return
	}
	results := []publicObservation{}
	status, reason := entry.Status, entry.Reason
	if entry.Status == "cached_valid" {
		for _, row := range entry.Rows {
			if row.WindowStartS >= startS && row.WindowEndS <= endS && row.AvailableAtSourceS <= asOf {
				results = append(results, row)
			}
		}
		if len(results) == 0 {
			status, reason = "missing", "No finalized window is available at the requested source time"
		}
		if len(results) > 0 && asOf < 1e12 {
			latest := results[len(results)-1]
			if asOf-latest.WindowEndS > 2*(latest.WindowEndS-latest.WindowStartS) {
				status, reason = "stale", "Latest finalized source window is older than two window durations"
			}
		}
	}
	send(w, 200, ObservationResponse{SchemaVersion: "camera-observation-v1", CameraID: entry.Manifest.CameraID,
		SourceSessionID: entry.Manifest.SourceSessionID, InputSessionID: inputSession, Status: status, Reason: reason,
		Count: len(results), Observations: results})
}

func (s *Server) getProcessedClips(w http.ResponseWriter, r *http.Request) {
	items := []map[string]any{}
	for _, entry := range s.processedEntries("") {
		items = append(items, entry.publicStatus())
	}
	send(w, 200, map[string]any{"clips": items, "count": len(items)})
}

func readFileWithReportFallback(filename string) ([]byte, error) {
	if data, err := os.ReadFile(filepath.Join("reports", filename)); err == nil {
		return data, nil
	}
	return os.ReadFile(filename)
}

func (s *Server) getCameras(w http.ResponseWriter, r *http.Request) {
	camCfgPath := "packages/camera-config/cameras.json"
	data, err := os.ReadFile(camCfgPath)
	if err != nil {
		send(w, 200, map[string]any{
			"schema_version": "camera-config-v1",
			"cameras":        map[string]any{},
		})
		return
	}
	var res map[string]any
	if err := json.Unmarshal(data, &res); err != nil {
		problem(w, 500, "Corrupt camera configuration")
		return
	}
	if manifest, err := readFileWithReportFallback("asset-manifest.json"); err == nil {
		var assets struct {
			Assets []map[string]any `json:"assets"`
		}
		if json.Unmarshal(manifest, &assets) == nil {
			res["assets"] = assets.Assets
		}
	}
	send(w, 200, res)
}

func (s *Server) getDemandProfiles(w http.ResponseWriter, r *http.Request) {
	manifestPath := "demand-profile-manifest.json"
	data, err := readFileWithReportFallback(manifestPath)
	if err != nil {
		send(w, 200, map[string]any{
			"schema_version": "demand-profile-manifest-v1",
			"status":         "no_profile_manifest_generated",
		})
		return
	}
	var res map[string]any
	if err := json.Unmarshal(data, &res); err != nil {
		problem(w, 500, "Corrupt demand manifest")
		return
	}
	send(w, 200, res)
}

func (s *Server) getClipMedia(w http.ResponseWriter, r *http.Request) {
	clipID := chi.URLParam(r, "id")
	if clipID == "" {
		problem(w, 400, "Missing clip ID")
		return
	}

	targetFilename := ""
	// Check if clipID matches an assigned slot or filename
	manifestData, err := readFileWithReportFallback("asset-manifest.json")
	if err == nil {
		var manifest struct {
			Assets []struct {
				Filename     string `json:"filename"`
				AssignedSlot string `json:"assigned_slot"`
			} `json:"assets"`
		}
		if json.Unmarshal(manifestData, &manifest) == nil {
			for _, a := range manifest.Assets {
				if strings.EqualFold(a.AssignedSlot, clipID) || strings.EqualFold(a.Filename, clipID) || strings.EqualFold(strings.TrimSuffix(a.Filename, ".mp4"), clipID) {
					targetFilename = a.Filename
					break
				}
			}
		}
	}

	if targetFilename == "" {
		problem(w, 404, "Clip is not registered")
		return
	}

	// Canonicalize and prevent path traversal
	cleanPath := filepath.Clean(targetFilename)
	if cleanPath != filepath.Base(cleanPath) || filepath.IsAbs(cleanPath) {
		problem(w, 403, "Access to path forbidden")
		return
	}

	mediaRoot := os.Getenv("VIDEO_ASSET_DIR")
	if mediaRoot == "" {
		mediaRoot = "traffic video"
	}
	mediaPath := filepath.Join(mediaRoot, cleanPath)
	info, err := os.Lstat(mediaPath)
	if err != nil || !info.Mode().IsRegular() {
		problem(w, 404, "Requested media clip not found")
		return
	}

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeFile(w, r, mediaPath)
}
