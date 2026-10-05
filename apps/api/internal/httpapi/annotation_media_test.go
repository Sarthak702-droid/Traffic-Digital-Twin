package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrivateAnnotationPreviewIdentityAndPrivacy(t *testing.T) {
	s := app(t)
	base := t.TempDir()
	t.Chdir(base)
	for _, dir := range []string{"reports", "packages/camera-config", "private"} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	hash := strings.Repeat("a", 64)
	filename := "CAM-01-" + hash + "-annotated-v1.mp4"
	body := []byte("annotated sampled video")
	sum := sha256.Sum256(body)
	os.WriteFile("reports/asset-manifest.json", []byte(`{"assets":[{"filename":"source.mp4","assigned_slot":"CAM-01","sha256":"`+hash+`"}]}`), 0600)
	os.WriteFile("packages/camera-config/cameras.json", []byte(`{"cameras":{"CAM-01":{"geometry":{}}}}`), 0600)
	os.WriteFile(filepath.Join("private", filename), body, 0600)
	t.Setenv("VISION_ANNOTATION_DIR", filepath.Join(base, "private"))
	entry := map[string]any{"source_clip_sha256": hash, "model_sha256": "06006ecb5fe52a348ceed805bf0aa6b32af7e24e689d09a6582f6d53159d6b00", "filename": filename, "rendition_sha256": hex.EncodeToString(sum[:]), "geometry": map[string]any{}, "sample_fps": 2, "duration_s": 1, "coverage_complete": true, "aggregates": map[string]any{"schema_version": "display-aggregates-v3", "camera_id": "CAM-01", "geometry": map[string]any{}, "duration_s": 1, "source_identity": map[string]any{"clip_sha256": hash}, "frames": []any{}}}
	write := func() {
		b, _ := json.Marshal(map[string]any{"schema_version": "display-annotation-v1", "cameras": map[string]any{"CAM-01": entry}})
		os.WriteFile("private/manifest.json", b, 0600)
	}
	write()
	request := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, testRequest(http.MethodGet, path, nil))
		return w
	}
	w := request("/api/v1/clips/CAM-01/annotation")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "/api/v1/clips/CAM-01/annotation/media") {
		t.Fatalf("metadata: %d %s", w.Code, w.Body.String())
	}
	w = request("/api/v1/clips/CAM-01/annotation/media")
	if w.Code != 200 || w.Body.String() != string(body) {
		t.Fatalf("media: %d %s", w.Code, w.Body.String())
	}
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		req := testRequest(method, "/api/v1/clips/CAM-01/annotation/media", nil)
		req.Header.Set("Range", "bytes=0-8")
		recorder := httptest.NewRecorder()
		s.Handler().ServeHTTP(recorder, req)
		if recorder.Code != 206 || recorder.Header().Get("Content-Range") == "" {
			t.Fatalf("range %s: %d", method, recorder.Code)
		}
		if method == http.MethodHead && recorder.Body.Len() != 0 {
			t.Fatal("HEAD leaked body")
		}
	}
	unauth := httptest.NewRecorder()
	s.Handler().ServeHTTP(unauth, httptest.NewRequest(http.MethodGet, "/api/v1/clips/CAM-01/annotation/media", nil))
	if unauth.Code != 401 {
		t.Fatalf("unauthenticated: %d", unauth.Code)
	}
	for key, value := range map[string]any{"source_clip_sha256": strings.Repeat("b", 64), "filename": "../outside.mp4", "coverage_complete": false, "geometry": map[string]any{"changed": true}, "model_sha256": strings.Repeat("c", 64), "rendition_sha256": strings.Repeat("d", 64), "aggregates": map[string]any{"bbox_history": []any{}}} {
		old := entry[key]
		entry[key] = value
		write()
		w = request("/api/v1/clips/CAM-01/annotation/media")
		if w.Code == 200 {
			t.Fatalf("accepted invalid %s", key)
		}
		entry[key] = old
	}
	write()
	os.Remove(filepath.Join("private", filename))
	os.Symlink(filepath.Join(base, "outside.mp4"), filepath.Join("private", filename))
	w = request("/api/v1/clips/CAM-01/annotation/media")
	if w.Code == 200 {
		t.Fatal("symlink accepted")
	}
}
