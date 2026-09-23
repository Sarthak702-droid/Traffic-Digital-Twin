"""
Video-Derived Demand Adapter and Provider with Causal Delayed Uniform Release.
PRD §13; Tasks T08, T10.
Satisfies mass conservation:
  initial_stock + cumulative_offered = current_stock + backlogs + cumulative_exits
"""

from __future__ import annotations
import glob
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


CAMERA_TO_BOUNDARY_LINK = {
    "CAM-01": "C2-C1",
    "CAM-02": "C4-C1",
    "CAM-03": "C5-C1",
    "CAM-06": "C6-C3"
}

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
        eof_policy: str = "drain_with_warning"  # "drain_with_warning" or "pause_at_watermark"
    ):
        self.observations_dir = Path(observations_dir)
        self.scale = scale
        self.eof_policy = eof_policy
        self.commitments_by_link: Dict[str, List[DemandBinCommitment]] = {}
        self.cumulative_profile_mass: Dict[str, float] = {}
        self.cumulative_offered_mass: Dict[str, float] = {}
        self.last_committed_watermark_s: Dict[str, float] = {}
        self._load_observations()

    def _load_observations(self):
        for link in CAMERA_TO_BOUNDARY_LINK.values():
            self.commitments_by_link[link] = []
            self.cumulative_profile_mass[link] = 0.0
            self.cumulative_offered_mass[link] = 0.0
            self.last_committed_watermark_s[link] = 0.0

        for cam_id, link in CAMERA_TO_BOUNDARY_LINK.items():
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
                    "assigned_camera": BOUNDARY_LINK_TO_CAMERA[link],
                    "total_profile_mass_veh": round(self.cumulative_profile_mass.get(link, 0.0), 3),
                    "total_offered_mass_veh": round(self.cumulative_offered_mass.get(link, 0.0), 3),
                    "pending_unreleased_mass_veh": round(self.get_pending_unreleased_mass(link), 3),
                    "last_committed_watermark_s": self.last_committed_watermark_s.get(link, 0.0),
                    "bins_count": len(self.commitments_by_link.get(link, []))
                }
                for link in CAMERA_TO_BOUNDARY_LINK.values()
            }
        }
