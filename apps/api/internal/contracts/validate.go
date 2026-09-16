package contracts

import (
	"fmt"
	"math"
	"time"
	pb "traffic.local/twin/packages/contracts/gen/go"
)

func ValidateState(s *pb.TrafficState) error {
	if s == nil || s.SchemaVersion != "1.0" || s.RunId == "" || s.Source != "synthetic" {
		return fmt.Errorf("version, run_id and synthetic source required")
	}
	if _, e := time.Parse(time.RFC3339Nano, s.Timestamp); e != nil {
		return fmt.Errorf("RFC3339 timestamp required")
	}
	if math.IsNaN(s.SimulationTimeS) || math.IsInf(s.SimulationTimeS, 0) || s.SimulationTimeS < 0 {
		return fmt.Errorf("invalid simulation_time_s")
	}
	ids := map[string]bool{}
	for _, m := range s.Movements {
		if m == nil || m.MovementId == "" || ids[m.MovementId] || m.CurrentPhaseId == "" {
			return fmt.Errorf("unique movement id and phase required")
		}
		ids[m.MovementId] = true
		for _, v := range []float64{m.QueueVeh, m.ArrivalRateVpm, m.DepartureRateVpm, m.AvgSpeedKph, m.OccupancyRatio, m.DownstreamCapacityVeh, m.WaitingAgeS} {
			if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
				return fmt.Errorf("movement values must be finite and nonnegative")
			}
		}
		if m.OccupancyRatio > 1 {
			return fmt.Errorf("occupancy_ratio must be <=1")
		}
	}
	if len(s.Movements) == 0 {
		return fmt.Errorf("at least one movement required")
	}
	return nil
}
