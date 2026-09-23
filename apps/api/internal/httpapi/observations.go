package httpapi

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

func videoProfileReady() bool {
	data, err := os.ReadFile("packages/camera-config/cameras.json")
	if err != nil {
		return false
	}
	var config struct {
		Cameras map[string]struct {
			AssignedVideo       string `json:"assigned_video"`
			InjectsBoundaryMass bool   `json:"injects_boundary_mass"`
		} `json:"cameras"`
	}
	if json.Unmarshal(data, &config) != nil {
		return false
	}
	ready := 0
	for id, camera := range config.Cameras {
		if !camera.InjectsBoundaryMass {
			continue
		}
		if camera.AssignedVideo == "" {
			return false
		}
		if info, err := os.Lstat(camera.AssignedVideo); err != nil || !info.Mode().IsRegular() {
			return false
		}
		file, err := os.Open(filepath.Join(".runtime/vision/observations", id+"_observations.jsonl"))
		if err != nil {
			return false
		}
		scanner := bufio.NewScanner(file)
		valid := false
		for scanner.Scan() {
			var observation struct {
				Status string `json:"observation_status"`
			}
			if json.Unmarshal(scanner.Bytes(), &observation) == nil && observation.Status == "valid" {
				valid = true
				break
			}
		}
		file.Close()
		if !valid {
			return false
		}
		ready++
	}
	return ready == 4
}

type ObservationResponse struct {
	SchemaVersion string           `json:"schema_version"`
	CameraID      string           `json:"camera_id,omitempty"`
	Count         int              `json:"count"`
	Observations  []map[string]any `json:"observations"`
}

func (s *Server) getObservations(w http.ResponseWriter, r *http.Request) {
	camID := r.URL.Query().Get("camera_id")
	if camID != "" && !regexp.MustCompile(`^CAM-[0-9]{2}$`).MatchString(camID) {
		problem(w, 400, "Invalid registered camera ID")
		return
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "cached_observations"
	}
	if mode != "cached_observations" {
		problem(w, 409, "Online inference requires a running vision job; select cached observations")
		return
	}

	startS := -1.0
	if val := r.URL.Query().Get("start_s"); val != "" {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			startS = f
		}
	}

	endS := 999999.0
	if val := r.URL.Query().Get("end_s"); val != "" {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			endS = f
		}
	}

	obsDir := ".runtime/vision/observations"
	// Find observation files
	pattern := filepath.Join(obsDir, "*.jsonl")
	if camID != "" {
		pattern = filepath.Join(obsDir, camID+"*.jsonl")
	}

	matches, err := filepath.Glob(pattern)
	if err != nil || len(matches) == 0 {
		send(w, 200, ObservationResponse{
			SchemaVersion: "camera-observation-v1",
			CameraID:      camID,
			Count:         0,
			Observations:  []map[string]any{},
		})
		return
	}

	var results []map[string]any
	for _, fpath := range matches {
		file, err := os.Open(fpath)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var obs map[string]any
			if err := json.Unmarshal([]byte(line), &obs); err == nil {
				wStart, _ := obs["window_start_s"].(float64)
				wEnd, _ := obs["window_end_s"].(float64)
				if (startS < 0 || wStart >= startS) && wEnd <= endS {
					obs["processing_mode"] = "cached_observations"
					results = append(results, obs)
				}
			}
		}
		file.Close()
	}

	sort.Slice(results, func(i, j int) bool {
		t1, _ := results[i]["window_start_s"].(float64)
		t2, _ := results[j]["window_start_s"].(float64)
		return t1 < t2
	})

	send(w, 200, ObservationResponse{
		SchemaVersion: "camera-observation-v1",
		CameraID:      camID,
		Count:         len(results),
		Observations:  results,
	})
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
	if manifest, err := os.ReadFile("asset-manifest.json"); err == nil {
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
	data, err := os.ReadFile(manifestPath)
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
	manifestData, err := os.ReadFile("asset-manifest.json")
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

	info, err := os.Lstat(cleanPath)
	if err != nil || !info.Mode().IsRegular() {
		problem(w, 404, "Requested media clip not found")
		return
	}

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeFile(w, r, cleanPath)
}
