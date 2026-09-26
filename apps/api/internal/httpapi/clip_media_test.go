package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegisteredClipMediaUsesConfiguredPrivateDirectory(t *testing.T) {
	s := app(t)
	root := t.TempDir()
	t.Chdir(root)
	if err := os.Mkdir("reports", 0700); err != nil {
		t.Fatal(err)
	}
	manifest := `{"assets":[{"filename":"sample.mp4","assigned_slot":"CAM-01"}]}`
	if err := os.WriteFile(filepath.Join("reports", "asset-manifest.json"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	media := filepath.Join(root, "private media")
	if err := os.Mkdir(media, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(media, "sample.mp4"), []byte("recorded sample"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VIDEO_ASSET_DIR", media)
	for _, path := range []string{"/api/v1/clips/CAM-01/media", "/api/v1/vision/clips/CAM-01/media"} {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, testRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK || w.Body.String() != "recorded sample" {
			t.Fatalf("%s: %d %q", path, w.Code, w.Body.String())
		}
	}
	if err := os.Remove(filepath.Join(media, "sample.mp4")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "outside.mp4"), filepath.Join(media, "sample.mp4")); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, testRequest(http.MethodGet, "/api/v1/clips/CAM-01/media", nil))
	if w.Code != http.StatusNotFound || strings.Contains(w.Body.String(), "outside.mp4") {
		t.Fatalf("symlink served: %d %q", w.Code, w.Body.String())
	}
}
