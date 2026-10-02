"""Causal tuning diagnostics on declared synthetic count traces, never held-out evidence."""
import argparse
import json
import math
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.intelligence.forecast_demand import CausalForecaster


def score_trace(counts, bin_s, scoring_start_s, horizons, history_limit_bins):
    if bin_s <= 0 or history_limit_bins < 1 or any(
        not math.isfinite(value) or value < 0 for value in counts
    ):
        raise ValueError("Invalid synthetic count trace")
    scores = {}
    for horizon in horizons:
        if horizon <= 0 or horizon % bin_s:
            raise ValueError("Horizon must contain whole finalized bins")
        steps = horizon // bin_s
        pairs = []
        for end in range(1, len(counts)):
            if end * bin_s < scoring_start_s or end + steps > len(counts):
                continue
            forecaster = CausalForecaster()
            for count in counts[max(0, end - history_limit_bins):end]:
                forecaster.update("synthetic-boundary", count * 60 / bin_s)
            forecast = forecaster.forecast_link("synthetic-boundary")
            pairs.append((forecast.active_forecast[horizon] * horizon / 60,
                          forecast.baseline_persistence[horizon] * horizon / 60,
                          sum(counts[end:end + steps])))
        item = {"status": "available" if pairs else "unavailable", "eligible_origins": len(pairs),
                "target_type": "synthetic_counts"}
        if pairs:
            item.update(first_origin_prediction_veh=pairs[0][0], first_origin_actual_veh=pairs[0][2],
                        active_mae_veh=sum(abs(a - y) for a, _, y in pairs) / len(pairs),
                        persistence_mae_veh=sum(abs(b - y) for _, b, y in pairs) / len(pairs),
                        active_bias_veh=sum(a - y for a, _, y in pairs) / len(pairs))
            # The operating forecaster is already boundary-local: this comparator
            # is identical, not a fabricated independent policy improvement.
            item["local_only_mae_veh"] = item["active_mae_veh"]
        else:
            item["reason"] = "insufficient_later_finalized_bins"
        scores[horizon] = item
    return scores


def evaluate(protocol):
    if protocol["evidence_scope"] != "tuning_only":
        raise ValueError("This diagnostic supports tuning only")
    cases = []
    for condition in protocol["trace_conditions"]:
        for seed in protocol["seeds"]:
            rng = random.Random(seed)
            counts = []
            for index in range(protocol["duration_s"] // protocol["bin_s"]):
                level = protocol["base_count_per_bin"]
                if condition in ("rising", "falling"):
                    level += (1 if condition == "rising" else -1) * index * protocol["trend_count_per_bin"]
                elif condition == "change_point" and index * protocol["bin_s"] >= protocol["change_point_s"]:
                    level = protocol["changed_count_per_bin"]
                elif condition not in ("constant_noisy", "change_point"):
                    raise ValueError("Unknown synthetic trace condition")
                counts.append(max(0, round(rng.gauss(level, protocol["noise_std_count"]))))
            scores = score_trace(counts, protocol["bin_s"], protocol["scoring_start_s"],
                                 protocol["horizons_s"], protocol["history_limit_bins"])
            for item in scores.values():
                baseline = item.get("persistence_mae_veh")
                improvement = ((baseline - item["active_mae_veh"]) / baseline
                               if baseline else None)
                item["improvement_fraction"] = improvement
                item["diagnostic_criterion_met"] = (item["eligible_origins"] >= protocol["minimum_eligible_origins"]
                    and improvement is not None and improvement >= protocol["minimum_mae_improvement_fraction"])
            cases.append({"condition": condition, "seed": seed, "scores": scores})
    return {"protocol": protocol, "evidence_scope": "tuning_only", "gate_pass": False,
            "diagnostic_criterion_scope": "improvement_vs_persistence_only",
            "local_only_comparator": "identical_to_active_boundary_local_policy",
            "local_only_improvement_available": False, "cases": cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = evaluate(json.loads(args.protocol.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"cases": len(result["cases"]), "gate_pass": False}))


if __name__ == "__main__":
    main()
