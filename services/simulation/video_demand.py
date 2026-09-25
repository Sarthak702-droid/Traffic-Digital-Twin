"""
Video-Derived Demand Adapter and Provider with Causal Delayed Uniform Release.
PRD §13; Tasks T08, T10.
Satisfies mass conservation:
  initial_stock + cumulative_offered = current_stock + backlogs + cumulative_exits
"""

from __future__ import annotations
import glob
import hashlib
import json
import math
import os
from datetime import datetime, timezone
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from services.shared.network_config import load_config
import twin_pb2 as pb


CAMERA_TO_BOUNDARY_LINK = load_config()["camera_boundary_links"]

BOUNDARY_LINK_TO_CAMERA = {v: k for k, v in CAMERA_TO_BOUNDARY_LINK.items()}


@dataclass
class DemandBinCommitment:
    source_window_start: float
    source_window_end: float
    available_at_s: float
    total_mass_veh: float
    release_window_start_s: float
    release_window_end_s: float
    rate_vps: float
    released_mass_veh: float = 0.0


class VideoProfileDemandProvider:
    """
    Supplies boundary demand from 5-second CameraObservation bins.
    Delayed uniform release: bin [t_start, t_end) available at t_end
    releases its vehicles uniformly over [t_end, t_end + (t_end - t_start)).
    """
    def __init__(
        self,
        observations_dir: str = ".runtime/vision/observations",
        scale: float = 1.0,
        eof_policy: str = "drain_with_warning",  # "drain_with_warning" or "pause_at_watermark"
        camera_boundary_links: Dict[str, str] | None = None,
        processed_dir: str | Path | None = None,
        source_bindings=None,
    ):
        self.observations_dir = Path(observations_dir)
        self.scale = scale
        self.eof_policy = eof_policy
        self.camera_boundary_links = dict(camera_boundary_links if camera_boundary_links is not None else load_config()["camera_boundary_links"])
        self.processed_dir = Path(processed_dir) if processed_dir is not None else None
        self.source_bindings = list(source_bindings) if source_bindings is not None else None
        self.finalized_rows: list[pb.FinalizedObservation] = []
        self.commitments_by_link: Dict[str, List[DemandBinCommitment]] = {}
        self.cumulative_profile_mass: Dict[str, float] = {}
        self.cumulative_offered_mass: Dict[str, float] = {}
        self.last_committed_watermark_s: Dict[str, float] = {}
        if self.source_bindings is None:
            self._load_observations()
        else:
            self._load_bound_observations()

    def _init_links(self):
        for link in self.camera_boundary_links.values():
            self.commitments_by_link[link] = []
            self.cumulative_profile_mass[link] = 0.0
            self.cumulative_offered_mass[link] = 0.0
            self.last_committed_watermark_s[link] = 0.0

    def _load_observations(self):
        self._init_links()

        for cam_id, link in self.camera_boundary_links.items():
            pattern = str(self.observations_dir / f"{cam_id}*.jsonl")
            matched_files = glob.glob(pattern)
            if not matched_files:
                continue

            # Read observations ordered by window_start_s
            obs_list = []
            for fpath in matched_files:
                with open(fpath, "r") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            obs_list.append(json.loads(line))
                        except Exception:
                            pass

            obs_list.sort(key=lambda x: x.get("window_start_s", 0.0))

            seen_windows = set()
            for obs in obs_list:
                if obs.get("observation_status") != "valid":
                    continue
                w_start = float(obs.get("window_start_s", 0.0))
                w_end = float(obs.get("window_end_s", w_start + 5.0))
                if not (w_end > w_start) or (w_start, w_end) in seen_windows:
                    continue
                seen_windows.add((w_start, w_end))
                duration = w_end - w_start
                crossings = float(obs.get("crossings_veh", 0)) * self.scale
                if not (0 <= crossings < float("inf")):
                    continue

                avail_at = float(obs.get("available_at_source_s", w_end))
                # Causal release: supplies mass over [avail_at, avail_at + duration)
                rel_start = avail_at
                rel_end = avail_at + duration
                rate = crossings / duration

                comm = DemandBinCommitment(
                    source_window_start=w_start,
                    source_window_end=w_end,
                    available_at_s=avail_at,
                    total_mass_veh=crossings,
                    release_window_start_s=rel_start,
                    release_window_end_s=rel_end,
                    rate_vps=rate
                )
                self.commitments_by_link[link].append(comm)
                self.cumulative_profile_mass[link] += crossings
                self.last_committed_watermark_s[link] = max(self.last_committed_watermark_s[link], rel_end)

    def _load_bound_observations(self):
        self._init_links()
        if self.processed_dir is None:
            raise ValueError('Bound processed observation directory is required')
        selections = {source.camera_id: source for source in self.source_bindings}
        if len(selections) != len(self.source_bindings) or set(selections) != set(self.camera_boundary_links):
            raise ValueError('Exactly one bound source per boundary camera is required')
        for camera, link in self.camera_boundary_links.items():
            selected = selections[camera]
            matches = []
            for manifest_path in (self.processed_dir / camera).glob('*/manifest.json'):
                try:
                    manifest = json.loads(manifest_path.read_text())
                except (OSError, ValueError):
                    continue
                if manifest.get('source_session_id') == selected.source_session_id:
                    matches.append((manifest_path, manifest))
            if len(matches) != 1:
                raise ValueError(f'Missing or ambiguous bound source identity for {camera}')
            manifest_path, manifest = matches[0]
            identity = {
                'camera_id': selected.camera_id, 'source_session_id': selected.source_session_id,
                'clip_sha256': selected.clip_sha256, 'geometry_sha256': selected.geometry_sha256,
                'model_sha256': selected.model_sha256, 'config_hash': selected.config_hash,
                'observations_sha256': selected.observations_sha256,
                'detector_version': selected.detector_version, 'tracker_version': selected.tracker_version,
                'observation_schema_version': selected.observation_schema_version,
            }
            if manifest.get('status') != 'complete' or any(manifest.get(k) != v for k, v in identity.items()):
                raise ValueError(f'Bound source identity changed for {camera}')
            path = manifest_path.parent / 'observations.jsonl'
            try:
                data = path.read_bytes()
            except OSError as exc:
                raise ValueError(f'Bound observation file missing for {camera}') from exc
            if hashlib.sha256(data).hexdigest() != selected.observations_sha256:
                raise ValueError(f'Bound observation checksum changed for {camera}')
            try:
                rows = [json.loads(line) for line in data.splitlines() if line.strip()]
            except ValueError as exc:
                raise ValueError(f'Invalid bound observation JSON for {camera}') from exc
            if not rows or len(rows) != manifest.get('window_count'):
                raise ValueError(f'Bound observation window count changed for {camera}')
            previous_end = -1.0
            seen = set()
            for row in rows:
                start, end, available = (row.get(k) for k in ('window_start_s','window_end_s','available_at_source_s'))
                crossings = row.get('crossings_veh')
                source = row.get('source_identity') or {}
                if (row.get('camera_id') != camera or row.get('boundary_link_id') != link or
                    row.get('schema_version') != selected.observation_schema_version or
                    row.get('observation_status') != 'valid' or
                    any(source.get(k) != v for k, v in identity.items() if k not in ('camera_id','model_sha256','observations_sha256')) or
                    not all(isinstance(v, (int,float)) and math.isfinite(v) for v in (start,end,available)) or
                    start < 0 or start < previous_end or end <= start or available < end or
                    type(crossings) is not int or crossings < 0 or
                    not isinstance(row.get('observation_id'), str) or not row['observation_id'] or
                    row['observation_id'] in seen):
                    raise ValueError(f'Invalid or out-of-order bound observation for {camera}')
                try:
                    completed = datetime.fromisoformat(row['processed_at_utc'].replace('Z','+00:00'))
                except (KeyError, TypeError, ValueError) as exc:
                    raise ValueError(f'Missing processing completion for {camera}') from exc
                if completed.tzinfo is None or completed > datetime.now(timezone.utc):
                    raise ValueError(f'Invalid processing completion for {camera}')
                previous_end = end
                seen.add(row['observation_id'])
                duration = end - start
                mass = crossings * self.scale
                if not math.isfinite(mass) or mass < 0:
                    raise ValueError(f'Invalid scaled boundary mass for {camera}')
                self.commitments_by_link[link].append(DemandBinCommitment(start,end,available,mass,available,available+duration,mass/duration))
                self.cumulative_profile_mass[link] += mass
                self.last_committed_watermark_s[link] = max(self.last_committed_watermark_s[link],available+duration)
                self.finalized_rows.append(pb.FinalizedObservation(
                    observation_id=row['observation_id'], camera_id=camera, boundary_link_id=link,
                    window_start_s=start, window_end_s=end, available_at_source_s=available,
                    processed_at_utc=row['processed_at_utc'], crossings_veh=crossings,
                    observation_status='valid', source_identity=pb.SourceIdentity(
                        clip_sha256=selected.clip_sha256, geometry_sha256=selected.geometry_sha256,
                        detector_version=selected.detector_version, tracker_version=selected.tracker_version,
                        observation_schema_version=selected.observation_schema_version,
                        source_session_id=selected.source_session_id, config_hash=selected.config_hash,
                        processing_mode='online_inference')))

    def finalized_history(self, as_of_source_s: float, max_bins: int = 60) -> list[pb.FinalizedObservation]:
        eligible = [row for row in self.finalized_rows if row.available_at_source_s <= as_of_source_s]
        eligible.sort(key=lambda row:(row.boundary_link_id,row.window_start_s))
        by_link = {}
        for row in eligible:
            by_link.setdefault(row.boundary_link_id, []).append(row)
        return [row for rows in by_link.values() for row in rows[-max_bins:]]

    def next(self, simulation_time_s: int, dt: float = 1.0) -> Dict[str, float]:
        """
        Computes the external demand offered at integer simulation time tick.
        Conserves exact total mass.
        """
        offered = {}
        t_now = float(simulation_time_s)
        t_next = t_now + dt

        for link, commitments in self.commitments_by_link.items():
            link_demand = 0.0
            for comm in commitments:
                # Active release window overlap [rel_start, rel_end) with [t_now, t_next)
                overlap_start = max(t_now, comm.release_window_start_s)
                overlap_end = min(t_next, comm.release_window_end_s)
                if overlap_end > overlap_start:
                    delta_t = overlap_end - overlap_start
                    portion = comm.rate_vps * delta_t
                    # Conserve exact total mass per commitment
                    remaining = comm.total_mass_veh - comm.released_mass_veh
                    amount = min(portion, max(0.0, remaining))
                    comm.released_mass_veh += amount
                    link_demand += amount

            self.cumulative_offered_mass[link] += link_demand
            offered[link] = link_demand

        return offered

    def get_pending_unreleased_mass(self, link: str) -> float:
        commitments = self.commitments_by_link.get(link, [])
        return sum(max(0.0, c.total_mass_veh - c.released_mass_veh) for c in commitments)

    def export_manifest(self) -> Dict[str, Any]:
        return {
            "schema_version": "demand-profile-manifest-v1",
            "scale": self.scale,
            "eof_policy": self.eof_policy,
            "boundary_links": {
                link: {
                    "assigned_camera": {v: k for k, v in self.camera_boundary_links.items()}[link],
                    "total_profile_mass_veh": round(self.cumulative_profile_mass.get(link, 0.0), 3),
                    "total_offered_mass_veh": round(self.cumulative_offered_mass.get(link, 0.0), 3),
                    "pending_unreleased_mass_veh": round(self.get_pending_unreleased_mass(link), 3),
                    "last_committed_watermark_s": self.last_committed_watermark_s.get(link, 0.0),
                    "bins_count": len(self.commitments_by_link.get(link, []))
                }
                for link in self.camera_boundary_links.values()
            }
        }
