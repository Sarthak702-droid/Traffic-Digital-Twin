package httpapi

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"

	"traffic.local/twin/apps/api/internal/store"
)

type decodeCoverage struct {
	Status              string  `json:"status"`
	RequestedFrames     int     `json:"requested_frames"`
	DecodedFrames       int     `json:"decoded_frames"`
	SourceFPS           float64 `json:"source_fps"`
	DecodedUntilSourceS float64 `json:"decoded_until_source_s"`
}
type processedManifest struct {
	Coverage                 *decodeCoverage           `json:"coverage"`
	ResourceMeasurements     *store.PerceptionResource `json:"resource_measurements,omitempty"`
	Status                   string                    `json:"status"`
	CameraID                 string                    `json:"camera_id"`
	SourceSessionID          string                    `json:"source_session_id"`
	ClipSHA256               string                    `json:"clip_sha256"`
	GeometrySHA256           string                    `json:"geometry_sha256"`
	ModelSHA256              string                    `json:"model_sha256"`
	ConfigHash               string                    `json:"config_hash"`
	DetectorVersion          string                    `json:"detector_version"`
	TrackerVersion           string                    `json:"tracker_version"`
	ObservationSchemaVersion string                    `json:"observation_schema_version"`
	WindowCount              int                       `json:"window_count"`
	ObservationsSHA256       string                    `json:"observations_sha256"`
}

type observationIdentity struct {
	ClipSHA256               string `json:"clip_sha256"`
	GeometrySHA256           string `json:"geometry_sha256"`
	DetectorVersion          string `json:"detector_version"`
	TrackerVersion           string `json:"tracker_version"`
	ObservationSchemaVersion string `json:"observation_schema_version"`
	SourceSessionID          string `json:"source_session_id"`
	ConfigHash               string `json:"config_hash"`
	ProcessingMode           string `json:"processing_mode"`
}

type publicObservation struct {
	SchemaVersion           string              `json:"schema_version"`
	ObservationID           string              `json:"observation_id"`
	CameraID                string              `json:"camera_id"`
	BoundaryLinkID          string              `json:"boundary_link_id"`
	DirectionID             string              `json:"direction_id"`
	WindowStartS            float64             `json:"window_start_s"`
	WindowEndS              float64             `json:"window_end_s"`
	AvailableAtSourceS      float64             `json:"available_at_source_s"`
	ProcessedAtUTC          string              `json:"processed_at_utc"`
	CrossingsVeh            int                 `json:"crossings_veh"`
	CountsByClass           map[string]int      `json:"counts_by_class,omitempty"`
	FlowVPM                 float64             `json:"flow_vpm"`
	QueueVisibleVehEstimate *int                `json:"queue_visible_veh_estimate"`
	QueueStatus             string              `json:"queue_status"`
	SpeedKPH                *float64            `json:"speed_kph"`
	SpeedStatus             string              `json:"speed_status"`
	ObservationStatus       string              `json:"observation_status"`
	ValidationLevel         string              `json:"validation_level"`
	MediaSource             string              `json:"media_source"`
	ProcessingMode          string              `json:"processing_mode"`
	SourceIdentity          observationIdentity `json:"source_identity"`
}

type catalogEntry struct {
	Manifest     processedManifest
	ManifestPath string
	Rows         []publicObservation
	Status       string
	Reason       string
}

var sha256Hex = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (s *Server) processedDir() string {
	if s.VisionProcessedDir != "" {
		return s.VisionProcessedDir
	}
	return ".runtime/vision/processed"
}

func (s *Server) processedEntries(cameraID string) []catalogEntry {
	pattern := filepath.Join(s.processedDir(), "CAM-*", "*", "manifest.json")
	if cameraID != "" {
		pattern = filepath.Join(s.processedDir(), cameraID, "*", "manifest.json")
	}
	paths, err := filepath.Glob(pattern)
	if err != nil {
		return nil
	}
	entries := make([]catalogEntry, 0, len(paths))
	for _, path := range paths {
		entry := readProcessedEntry(path)
		if cameraID != "" && entry.Manifest.CameraID != cameraID {
			continue
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ManifestPath < entries[j].ManifestPath })
	return entries
}

func readProcessedEntry(manifestPath string) catalogEntry {
	entry := catalogEntry{ManifestPath: manifestPath, Status: "degraded", Reason: "Processed observation manifest is invalid"}
	data, err := os.ReadFile(manifestPath)
	if err != nil || json.Unmarshal(data, &entry.Manifest) != nil {
		return entry
	}
	if entry.Manifest.Status == "failed" && entry.Manifest.CameraID == "" {
		entry.Manifest.CameraID = filepath.Base(filepath.Dir(filepath.Dir(manifestPath)))
	}
	m := entry.Manifest
	if m.Status == "complete" && (m.Coverage == nil || m.Coverage.Status != "complete") {
		entry.Status = "incomplete_decode"
		entry.Reason = "Requested decoded coverage is unproven; reprocess the clip"
		return entry
	}
	if m.Status == "failed" {
		entry.Reason = "Clip processing failed"
		return entry
	}
	if m.Coverage == nil || m.Coverage.Status != "complete" || m.Coverage.RequestedFrames <= 0 || m.Coverage.DecodedFrames < m.Coverage.RequestedFrames || !finiteSource(m.Coverage.SourceFPS) || m.Coverage.SourceFPS <= 0 || !finiteSource(m.Coverage.DecodedUntilSourceS) || m.Coverage.DecodedUntilSourceS < float64(m.Coverage.RequestedFrames)/m.Coverage.SourceFPS || m.Status != "complete" || m.CameraID != filepath.Base(filepath.Dir(filepath.Dir(manifestPath))) ||
		m.SourceSessionID == "" || m.WindowCount < 1 || m.ObservationSchemaVersion != "camera-observation-v1" ||
		!sha256Hex.MatchString(m.ClipSHA256) || !sha256Hex.MatchString(m.GeometrySHA256) ||
		!sha256Hex.MatchString(m.ModelSHA256) || !sha256Hex.MatchString(m.ConfigHash) ||
		!sha256Hex.MatchString(m.ObservationsSHA256) || m.DetectorVersion == "" || m.TrackerVersion == "" {
		return entry
	}
	path := filepath.Join(filepath.Dir(manifestPath), "observations.jsonl")
	f, err := os.Open(path)
	if err != nil {
		entry.Reason = "Finalized observation file is missing"
		return entry
	}
	defer f.Close()
	hasher := sha256.New()
	scanner := bufio.NewScanner(io.TeeReader(f, hasher))
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	previousEnd := -1.0
	seen := map[string]bool{}
	for scanner.Scan() {
		var artifact any
		var row publicObservation
		if json.Unmarshal(scanner.Bytes(), &artifact) != nil || store.RejectPrivateFields(artifact) != nil || json.Unmarshal(scanner.Bytes(), &row) != nil {
			entry.Rows = nil
			return entry
		}
		if seen[row.ObservationID] || (len(entry.Rows) > 0 && row.WindowStartS == entry.Rows[len(entry.Rows)-1].WindowStartS && row.WindowEndS == previousEnd) {
			entry.Status = "duplicate"
			entry.Reason = "Duplicate finalized observation window"
			entry.Rows = nil
			return entry
		}
		if row.WindowStartS < previousEnd {
			entry.Status = "out_of_order"
			entry.Reason = "Out-of-order or overlapping finalized observation window"
			entry.Rows = nil
			return entry
		}
		if row.WindowEndS > m.Coverage.DecodedUntilSourceS || !validProcessedRow(row, m, previousEnd) {
			entry.Reason = "Finalized observation identity, ordering or timing is invalid"
			entry.Rows = nil
			return entry
		}
		entry.Rows = append(entry.Rows, row)
		seen[row.ObservationID] = true
		previousEnd = row.WindowEndS
	}
	if scanner.Err() != nil || len(entry.Rows) != m.WindowCount || hex.EncodeToString(hasher.Sum(nil)) != m.ObservationsSHA256 {
		entry.Reason = "Finalized observation checksum or window count differs from manifest"
		entry.Rows = nil
		return entry
	}
	entry.Status = "cached_valid"
	entry.Reason = ""
	return entry
}

func validProcessedRow(row publicObservation, m processedManifest, previousEnd float64) bool {
	id := row.SourceIdentity
	if row.SchemaVersion != "camera-observation-v1" || row.CameraID != m.CameraID || row.ObservationID == "" ||
		id.SourceSessionID != m.SourceSessionID || id.ClipSHA256 != m.ClipSHA256 ||
		id.GeometrySHA256 != m.GeometrySHA256 || id.ConfigHash != m.ConfigHash ||
		id.DetectorVersion != m.DetectorVersion || id.TrackerVersion != m.TrackerVersion ||
		id.ObservationSchemaVersion != m.ObservationSchemaVersion || id.ProcessingMode != "online_inference" ||
		row.ObservationStatus != "valid" || row.ValidationLevel == "" || row.MediaSource != "recorded_video" ||
		row.ProcessingMode != "online_inference" || row.CrossingsVeh < 0 ||
		!finiteSource(row.WindowStartS) || !finiteSource(row.WindowEndS) || !finiteSource(row.AvailableAtSourceS) ||
		row.WindowStartS < previousEnd || row.WindowEndS <= row.WindowStartS || row.AvailableAtSourceS < row.WindowEndS {
		return false
	}
	if (row.DirectionID != "approaching" && row.DirectionID != "departing" && row.DirectionID != "both") ||
		row.CountsByClass == nil || !finiteSource(row.FlowVPM) ||
		(row.QueueStatus != "estimated_visible_region" && row.QueueStatus != "unavailable" && row.QueueStatus != "geometry_invalid" && row.QueueStatus != "degraded") ||
		(row.SpeedStatus != "uncalibrated" && row.SpeedStatus != "calibrated" && row.SpeedStatus != "unavailable") ||
		(row.ValidationLevel != "provisional_unreviewed" && row.ValidationLevel != "agent_reviewed" && row.ValidationLevel != "independently_verified") {
		return false
	}
	for _, count := range row.CountsByClass {
		if count < 0 {
			return false
		}
	}
	if row.QueueVisibleVehEstimate != nil && *row.QueueVisibleVehEstimate < 0 {
		return false
	}
	if row.SpeedKPH != nil && !finiteSource(*row.SpeedKPH) {
		return false
	}
	completed, err := time.Parse(time.RFC3339Nano, row.ProcessedAtUTC)
	return err == nil && !completed.After(time.Now().Add(time.Minute))
}

func finiteSource(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}

func selectProcessedEntry(entries []catalogEntry, session string) (catalogEntry, error) {
	if session != "" {
		for _, entry := range entries {
			if entry.Manifest.SourceSessionID == session {
				return entry, nil
			}
		}
		return catalogEntry{}, os.ErrNotExist
	}
	if len(entries) == 0 {
		return catalogEntry{}, os.ErrNotExist
	}
	if len(entries) > 1 {
		return catalogEntry{}, errors.New("Multiple source sessions exist; select source_session_id")
	}
	return entries[0], nil
}

func (e catalogEntry) publicStatus() map[string]any {
	m := e.Manifest
	result := map[string]any{"status": e.Status, "reason": e.Reason, "camera_id": m.CameraID,
		"source_session_id": m.SourceSessionID, "clip_sha256": m.ClipSHA256,
		"geometry_sha256": m.GeometrySHA256, "model_sha256": m.ModelSHA256,
		"config_hash": m.ConfigHash, "detector_version": m.DetectorVersion,
		"tracker_version": m.TrackerVersion, "observation_schema_version": m.ObservationSchemaVersion,
		"window_count": len(e.Rows)}
	if len(e.Rows) > 0 {
		latest := e.Rows[len(e.Rows)-1]
		result["latest_completed_window_end_source_s"] = latest.WindowEndS
		result["available_at_source_s"] = latest.AvailableAtSourceS
		result["processed_at_utc"] = latest.ProcessedAtUTC
	}
	return result
}

func validateSourceRange(start, end float64) error {
	if !finiteSource(start) || !finiteSource(end) || end < start {
		return fmt.Errorf("invalid source time range")
	}
	return nil
}

func (s *Server) resolveInputBinding(selected map[string]string) (store.RunInputBinding, error) {
	result := store.RunInputBinding{SourceSessions: map[string]string{}, SourceIdentities: map[string]store.SourceBinding{}}
	if len(selected) != len(s.Network.CameraBoundaryLinks) || len(selected) == 0 {
		return result, errors.New("Select one finalized source session for every configured boundary camera")
	}
	for cameraID, boundaryLink := range s.Network.CameraBoundaryLinks {
		session := selected[cameraID]
		if session == "" {
			return result, fmt.Errorf("Missing source session for %s", cameraID)
		}
		entry, err := selectProcessedEntry(s.processedEntries(cameraID), session)
		if err != nil || entry.Status != "cached_valid" || len(entry.Rows) == 0 {
			return result, fmt.Errorf("Source session for %s is missing or unsuitable", cameraID)
		}
		for _, row := range entry.Rows {
			if row.BoundaryLinkID != boundaryLink {
				return result, fmt.Errorf("Boundary mapping for %s changed", cameraID)
			}
		}
		if result.ConfigHash != "" && result.ConfigHash != entry.Manifest.ConfigHash {
			return result, errors.New("Selected source sessions use different network configurations")
		}
		result.ConfigHash = entry.Manifest.ConfigHash
		result.SourceSessions[cameraID] = session
		result.SourceIdentities[cameraID] = entry.Manifest.sourceBinding()
	}
	result.InputSessionID = store.UUID().String()
	return result, nil
}

func (m processedManifest) sourceBinding() store.SourceBinding {
	return store.SourceBinding{ClipSHA256: m.ClipSHA256, GeometrySHA256: m.GeometrySHA256,
		ModelSHA256: m.ModelSHA256, ConfigHash: m.ConfigHash, DetectorVersion: m.DetectorVersion,
		TrackerVersion: m.TrackerVersion, ObservationSchemaVersion: m.ObservationSchemaVersion,
		ObservationsSHA256: m.ObservationsSHA256}
}
