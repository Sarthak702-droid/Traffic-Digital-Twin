package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"regexp"

	"github.com/go-chi/chi/v5"
	"traffic.local/twin/apps/api/internal/store"
)

const annotationModelSHA = "06006ecb5fe52a348ceed805bf0aa6b32af7e24e689d09a6582f6d53159d6b00"

type annotationEntry struct {
	SourceSHA    string         `json:"source_clip_sha256"`
	ModelSHA     string         `json:"model_sha256"`
	Filename     string         `json:"filename"`
	RenditionSHA string         `json:"rendition_sha256"`
	Geometry     any            `json:"geometry"`
	SampleFPS    float64        `json:"sample_fps"`
	Duration     float64        `json:"duration_s"`
	Complete     bool           `json:"coverage_complete"`
	Aggregates   map[string]any `json:"aggregates"`
}

// Raster previews are private source media, never observation/report payloads.
// OpenRoot confines both manifest and media; an open descriptor pins the file
// across checksum verification and range delivery after atomic regeneration.
func (s *Server) annotationPreview(camera string) (annotationEntry, *os.File, error) {
	var entry annotationEntry
	if !regexp.MustCompile(`^CAM-[0-9]{2}$`).MatchString(camera) {
		return entry, nil, fmt.Errorf("unregistered camera")
	}
	data, err := readFileWithReportFallback("asset-manifest.json")
	if err != nil {
		return entry, nil, err
	}
	var assets struct {
		Assets []struct {
			Camera string `json:"assigned_slot"`
			SHA    string `json:"sha256"`
		} `json:"assets"`
	}
	if err = json.Unmarshal(data, &assets); err != nil {
		return entry, nil, err
	}
	expected := ""
	for _, asset := range assets.Assets {
		if asset.Camera == camera {
			expected = asset.SHA
		}
	}
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(expected) {
		return entry, nil, fmt.Errorf("unregistered source identity")
	}
	config, err := readFileWithReportFallback("packages/camera-config/cameras.json")
	if err != nil {
		return entry, nil, err
	}
	var cameras struct {
		Cameras map[string]struct {
			Geometry any `json:"geometry"`
		} `json:"cameras"`
	}
	if err = json.Unmarshal(config, &cameras); err != nil {
		return entry, nil, err
	}
	configured, ok := cameras.Cameras[camera]
	if !ok {
		return entry, nil, fmt.Errorf("missing camera geometry")
	}
	directory := os.Getenv("VISION_ANNOTATION_DIR")
	if directory == "" {
		directory = ".runtime/vision/display-annotations"
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return entry, nil, err
	}
	defer root.Close()
	info, err := root.Lstat("manifest.json")
	if err != nil || !info.Mode().IsRegular() {
		return entry, nil, fmt.Errorf("missing regular preview manifest")
	}
	manifest, err := root.Open("manifest.json")
	if err != nil {
		return entry, nil, err
	}
	data, err = io.ReadAll(io.LimitReader(manifest, 4*1024*1024+1))
	manifest.Close()
	if err != nil || len(data) > 4*1024*1024 {
		return entry, nil, fmt.Errorf("preview manifest exceeds bound")
	}
	var decoded struct {
		Version string                     `json:"schema_version"`
		Cameras map[string]annotationEntry `json:"cameras"`
	}
	if err = json.Unmarshal(data, &decoded); err != nil {
		return entry, nil, err
	}
	entry = decoded.Cameras[camera]
	expectedGeometry, _ := json.Marshal(configured.Geometry)
	actualGeometry, _ := json.Marshal(entry.Geometry)
	if decoded.Version != "display-annotation-v1" || !entry.Complete || entry.SourceSHA != expected || entry.ModelSHA != annotationModelSHA || !bytes.Equal(expectedGeometry, actualGeometry) || entry.Filename != camera+"-"+expected+"-annotated-v1.mp4" || entry.SampleFPS <= 0 || math.IsNaN(entry.SampleFPS) || math.IsInf(entry.SampleFPS, 0) || entry.Duration <= 0 || math.IsNaN(entry.Duration) || math.IsInf(entry.Duration, 0) {
		return entry, nil, fmt.Errorf("preview identity or coverage mismatch")
	}
	aggregateSource, _ := entry.Aggregates["source_identity"].(map[string]any)
	aggregateGeometry, _ := json.Marshal(entry.Aggregates["geometry"])
	if entry.Aggregates["schema_version"] != "display-aggregates-v3" || entry.Aggregates["camera_id"] != camera || aggregateSource["clip_sha256"] != expected || !bytes.Equal(expectedGeometry, aggregateGeometry) || entry.Aggregates["duration_s"] != entry.Duration || store.RejectPrivateFields(entry.Aggregates) != nil {
		return entry, nil, fmt.Errorf("invalid aggregate preview metadata")
	}
	info, err = root.Lstat(entry.Filename)
	if err != nil || !info.Mode().IsRegular() {
		return entry, nil, fmt.Errorf("missing regular preview media")
	}
	media, err := root.Open(entry.Filename)
	if err != nil {
		return entry, nil, err
	}
	digest := sha256.New()
	_, err = io.Copy(digest, media)
	if err != nil || hex.EncodeToString(digest.Sum(nil)) != entry.RenditionSHA {
		media.Close()
		return entry, nil, fmt.Errorf("preview checksum mismatch")
	}
	if _, err = media.Seek(0, io.SeekStart); err != nil {
		media.Close()
		return entry, nil, err
	}
	return entry, media, nil
}
func (s *Server) getAnnotation(w http.ResponseWriter, r *http.Request) {
	camera := chi.URLParam(r, "id")
	entry, media, err := s.annotationPreview(camera)
	if err != nil {
		problem(w, 404, "Vehicle annotations unavailable for this registered clip")
		return
	}
	defer media.Close()
	w.Header().Set("Cache-Control", "private, no-store")
	send(w, 200, map[string]any{"schema_version": "display-annotation-v1", "status": "available", "camera_id": camera, "source_clip_sha256": entry.SourceSHA, "geometry": entry.Geometry, "sample_fps": entry.SampleFPS, "duration_s": entry.Duration, "media_url": "/api/v1/clips/" + camera + "/annotation/media", "aggregates": entry.Aggregates})
}
func (s *Server) getAnnotationMedia(w http.ResponseWriter, r *http.Request) {
	entry, media, err := s.annotationPreview(chi.URLParam(r, "id"))
	if err != nil {
		problem(w, 404, "Vehicle annotations unavailable for this registered clip")
		return
	}
	defer media.Close()
	info, err := media.Stat()
	if err != nil {
		problem(w, 404, "Annotation media unavailable")
		return
	}
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, entry.Filename, info.ModTime(), media)
}
