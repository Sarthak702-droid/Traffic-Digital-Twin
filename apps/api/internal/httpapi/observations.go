package httpapi

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

type ObservationResponse struct {
	SchemaVersion string           `json:"schema_version"`
	CameraID      string           `json:"camera_id,omitempty"`
	Count         int              `json:"count"`
	Observations  []map[string]any `json:"observations"`
}

func (s *Server) getObservations(w http.ResponseWriter, r *http.Request) {
	camID := r.URL.Query().Get("camera_id")
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "cached_observations"
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
					obs["processing_mode"] = mode
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
		// Fallback check if direct mp4 in directory
		if strings.HasSuffix(clipID, ".mp4") {
			targetFilename = clipID
		} else {
			targetFilename = clipID + ".mp4"
		}
	}

	// Canonicalize and prevent path traversal
	cleanPath := filepath.Clean(targetFilename)
	if strings.Contains(cleanPath, "..") || filepath.IsAbs(cleanPath) {
		problem(w, 403, "Access to path forbidden")
		return
	}

	info, err := os.Stat(cleanPath)
	if err != nil || info.IsDir() {
		problem(w, 404, "Requested media clip not found")
		return
	}

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeFile(w, r, cleanPath)
}
