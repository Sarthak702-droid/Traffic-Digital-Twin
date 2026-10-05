package store

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Defense in depth at the aggregate export boundary, including nested payloads.
func RejectPrivateFields(value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var decoded any
	if err = json.Unmarshal(b, &decoded); err != nil {
		return err
	}
	denied := map[string]bool{"track_id": true, "track_ids": true, "tracking_id": true, "trail": true, "trails": true, "trajectory": true, "trajectories": true, "bbox": true, "bbox_history": true, "raw_frame": true, "raw_frames": true, "raw_video": true, "password": true, "credentials": true, "compute_token": true, "clip_path": true, "model_path": true}
	normalized := map[string]bool{}
	normalize := func(key string) string {
		return strings.NewReplacer("_", "", "-", "", ".", "", " ", "").Replace(strings.ToLower(key))
	}
	for key := range denied {
		normalized[normalize(key)] = true
	}
	for _, key := range []string{"session_token", "access_token", "api_key", "password_hash", "password_salt", "token"} {
		normalized[normalize(key)] = true
	}
	var walk func(any) error
	walk = func(v any) error {
		switch x := v.(type) {
		case map[string]any:
			for key, child := range x {
				if normalized[normalize(key)] {
					return fmt.Errorf("private field prohibited in aggregate report: %s", key)
				}
				if e := walk(child); e != nil {
					return e
				}
			}
		case []any:
			for _, child := range x {
				if e := walk(child); e != nil {
					return e
				}
			}
		}
		return nil
	}
	return walk(decoded)
}
