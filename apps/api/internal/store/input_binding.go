package store

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5/pgtype"
)

type RunInputBinding struct {
	InputSessionID   string                   `json:"input_session_id"`
	ConfigHash       string                   `json:"config_hash"`
	SourceSessions   map[string]string        `json:"source_sessions"`
	SourceIdentities map[string]SourceBinding `json:"source_identities"`
}

type SourceBinding struct {
	ClipSHA256               string `json:"clip_sha256"`
	GeometrySHA256           string `json:"geometry_sha256"`
	ModelSHA256              string `json:"model_sha256"`
	ConfigHash               string `json:"config_hash"`
	DetectorVersion          string `json:"detector_version"`
	TrackerVersion           string `json:"tracker_version"`
	ObservationSchemaVersion string `json:"observation_schema_version"`
	ObservationsSHA256       string `json:"observations_sha256"`
}

var fullSHA256 = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (b RunInputBinding) validate(demandSource string) error {
	if demandSource == "seeded" && b.InputSessionID == "" {
		return nil
	}
	if demandSource != "video_profile" || b.InputSessionID == "" || !fullSHA256.MatchString(b.ConfigHash) || len(b.SourceSessions) == 0 || len(b.SourceSessions) != len(b.SourceIdentities) {
		return errors.New("video profile requires a complete immutable input binding")
	}
	for camera, session := range b.SourceSessions {
		identity, ok := b.SourceIdentities[camera]
		if camera == "" || session == "" || !ok || !fullSHA256.MatchString(identity.ClipSHA256) || !fullSHA256.MatchString(identity.GeometrySHA256) || !fullSHA256.MatchString(identity.ModelSHA256) || !fullSHA256.MatchString(identity.ConfigHash) || !fullSHA256.MatchString(identity.ObservationsSHA256) || identity.DetectorVersion == "" || identity.TrackerVersion == "" || identity.ObservationSchemaVersion == "" {
			return errors.New("source identity is incomplete")
		}
	}
	return nil
}

func (s *Store) GetRunInput(ctx context.Context, runID pgtype.UUID) (RunInputBinding, error) {
	var result RunInputBinding
	var sources, identities []byte
	err := s.Pool.QueryRow(ctx, "SELECT input_session_id,config_hash,source_sessions,source_identities FROM run_input_bindings WHERE run_id=$1", runID).Scan(&result.InputSessionID, &result.ConfigHash, &sources, &identities)
	if err != nil {
		return result, err
	}
	if err = json.Unmarshal(sources, &result.SourceSessions); err != nil {
		return result, err
	}
	err = json.Unmarshal(identities, &result.SourceIdentities)
	return result, err
}
