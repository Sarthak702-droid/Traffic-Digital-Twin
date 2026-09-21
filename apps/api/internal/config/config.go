package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
)

type Node struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	Kind  string  `json:"kind"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}
type Link struct {
	ID      string  `json:"id"`
	From    string  `json:"from_node"`
	To      string  `json:"to_node"`
	Length  float64 `json:"length_m"`
	Lanes   int     `json:"lanes"`
	Storage int     `json:"storage_capacity_veh"`
	Speed   float64 `json:"free_flow_speed_kph"`
}
type Movement struct {
	ID       string  `json:"id"`
	Node     string  `json:"node_id"`
	Incoming string  `json:"incoming_link_id"`
	Outgoing string  `json:"outgoing_link_id"`
	Ratio    float64 `json:"turning_ratio"`
}
type Phase struct {
	Pedestrian float64  `json:"pedestrian_clearance_s"`
	MaxRed     float64  `json:"max_red_s"`
	ID         string   `json:"id"`
	Node       string   `json:"node_id"`
	Movements  []string `json:"movement_ids"`
	Min        float64  `json:"min_green_s"`
	Max        float64  `json:"max_green_s"`
	Amber      float64  `json:"amber_s"`
	AllRed     float64  `json:"all_red_s"`
}
type Scenario struct {
	Duration        float64  `json:"demand_duration_s"`
	BaseRate        float64  `json:"base_rate_vps"`
	FeederRate      float64  `json:"feeder_rate_vps"`
	SurgeRate       float64  `json:"surge_rate_vps"`
	SurgeStart      float64  `json:"surge_start_s"`
	SurgeEnd        float64  `json:"surge_end_s"`
	IncidentStart   float64  `json:"incident_start_s"`
	IncidentEnd     float64  `json:"incident_end_s"`
	EmergencyDepart float64  `json:"emergency_depart_s"`
	RecoveryCycles  int      `json:"recovery_cycles"`
	ID              string   `json:"id"`
	Seed            int64    `json:"seed"`
	Route           []string `json:"route_node_ids"`
	Capacity        float64  `json:"capacity_ratio"`
}
type FlowModel struct {
	Kind                 string  `json:"kind"`
	CellLengthM          float64 `json:"cell_length_m"`
	StepS                float64 `json:"step_s"`
	BackwardWaveSpeedKph float64 `json:"backward_wave_speed_kph"`
	QueueThresholdRatio  float64 `json:"queue_threshold_ratio"`
	FlowWindowS          float64 `json:"flow_window_s"`
	JunctionPolicy       string  `json:"junction_policy"`
	MetricsVersion       string  `json:"metrics_version"`
}
type Network struct {
	Version   string            `json:"schema_version"`
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Units     map[string]string `json:"units"`
	FlowModel FlowModel         `json:"flow_model"`
	Nodes     []Node            `json:"nodes"`
	Links     []Link            `json:"links"`
	Movements []Movement        `json:"movements"`
	Phases    []Phase           `json:"phases"`
	Conflicts [][2]string       `json:"conflicts"`
	Scenarios []Scenario        `json:"scenarios"`
}

func Load(path string) (Network, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return Network{}, e
	}
	var n Network
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e = d.Decode(&n); e != nil {
		return n, e
	}
	if d.Decode(new(any)) != io.EOF {
		return n, fmt.Errorf("trailing JSON")
	}
	return n, n.Validate()
}
func finite(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) }
func (n Network) Validate() error {
	fail := func(s string) error { return fmt.Errorf("invalid network: %s", s) }
	if n.Version != "1.0" || n.ID == "" || len(n.Nodes) < 2 {
		return fail("version, id or nodes")
	}
	f := n.FlowModel
	if f.Kind != "aggregate_ctm" || !finite(f.CellLengthM) || f.CellLengthM <= 0 || !finite(f.StepS) || f.StepS <= 0 || !finite(f.BackwardWaveSpeedKph) || f.BackwardWaveSpeedKph <= 0 || !finite(f.QueueThresholdRatio) || f.QueueThresholdRatio <= 0 || f.QueueThresholdRatio > 1 || !finite(f.FlowWindowS) || f.FlowWindowS <= 0 || f.JunctionPolicy != "strict_fifo" || f.MetricsVersion == "" {
		return fail("aggregate flow model")
	}
	nodes := map[string]Node{}
	coords := map[[2]float64]bool{}
	for _, v := range n.Nodes {
		p := [2]float64{v.X, v.Y}
		if v.ID == "" || nodes[v.ID].ID != "" || v.Label == "" || !finite(v.X) || !finite(v.Y) || v.X < 0 || v.Y < 0 || coords[p] || (v.Kind != "controlled" && v.Kind != "boundary") {
			return fail("node geometry/type/id")
		}
		nodes[v.ID] = v
		coords[p] = true
	}
	links := map[string]Link{}
	edges := map[string]bool{}
	for _, v := range n.Links {
		edge := v.From + ":" + v.To
		if v.ID == "" || links[v.ID].ID != "" || edges[edge] || nodes[v.From].ID == "" || nodes[v.To].ID == "" || v.From == v.To || !finite(v.Length) || v.Length <= 0 || v.Lanes < 1 || v.Storage < 1 || !finite(v.Speed) || v.Speed <= 0 {
			return fail("link endpoints/units/id")
		}
		links[v.ID] = v
		if f.StepS > f.CellLengthM/math.Max(v.Speed, f.BackwardWaveSpeedKph)*3.6 {
			return fail("unstable aggregate flow step")
		}
		edges[edge] = true
	}
	moves := map[string]Movement{}
	ratios := map[string]float64{}
	for _, v := range n.Movements {
		in, out := links[v.Incoming], links[v.Outgoing]
		if v.ID == "" || moves[v.ID].ID != "" || nodes[v.Node].Kind != "controlled" || in.ID == "" || out.ID == "" || in.To != v.Node || out.From != v.Node || !finite(v.Ratio) || v.Ratio <= 0 || v.Ratio > 1 {
			return fail("movement connectivity/ratio")
		}
		moves[v.ID] = v
		ratios[v.Incoming] += v.Ratio
	}
	for _, v := range n.Links {
		if nodes[v.To].Kind == "controlled" && math.Abs(ratios[v.ID]-1) > 1e-9 {
			return fail("turning ratios must sum to one on each controlled approach")
		}
	}
	conflicts := map[[2]string]bool{}
	for _, pair := range n.Conflicts {
		if moves[pair[0]].ID == "" || moves[pair[1]].ID == "" || pair[0] == pair[1] || moves[pair[0]].Node != moves[pair[1]].Node {
			return fail("conflict references")
		}
		conflicts[pair] = true
		conflicts[[2]string{pair[1], pair[0]}] = true
	}
	// Every pair of distinct protected approaches must be declared conflicting.
	for _, a := range n.Movements {
		for _, b := range n.Movements {
			if a.Node == b.Node && a.Incoming != b.Incoming && !conflicts[[2]string{a.ID, b.ID}] {
				return fail("missing protected-approach conflict")
			}
		}
	}
	phaseIDs := map[string]bool{}
	covered := map[string]bool{}
	for _, p := range n.Phases {
		if p.ID == "" || phaseIDs[p.ID] || nodes[p.Node].Kind != "controlled" || len(p.Movements) == 0 || !finite(p.Min) || !finite(p.Max) || !finite(p.Amber) || !finite(p.AllRed) || p.Min <= 0 || p.Max < p.Min || p.Amber <= 0 || p.AllRed <= 0 || !finite(p.Pedestrian) || p.Pedestrian < 0 || p.AllRed < p.Pedestrian || !finite(p.MaxRed) || p.MaxRed <= 0 {
			return fail("phase timing/node/id")
		}
		phaseIDs[p.ID] = true
		seen := map[string]bool{}
		for _, a := range p.Movements {
			if moves[a].Node != p.Node || seen[a] {
				return fail("phase movement reference")
			}
			seen[a] = true
			covered[a] = true
			for _, b := range p.Movements {
				if conflicts[[2]string{a, b}] {
					return fail("conflicting greens")
				}
			}
		}
	}
	for id := range moves {
		if !covered[id] {
			return fail("movement has no serving phase")
		}
	}
	expected := map[string]bool{"peak_surge": false, "incident_c3": false, "ambulance_corridor": false}
	seeds := map[int64]bool{}
	for _, s := range n.Scenarios {
		seen, ok := expected[s.ID]
		if !ok || seen || s.Seed <= 0 || s.Seed > 4294967295 || seeds[s.Seed] || len(s.Route) < 2 || !finite(s.Capacity) || s.Capacity < 0 || s.Capacity > 1 {
			return fail("scenario id/seed/route/capacity")
		}
		expected[s.ID] = true
		seeds[s.Seed] = true
		for i, id := range s.Route {
			if nodes[id].ID == "" || (i > 0 && !edges[s.Route[i-1]+":"+id]) {
				return fail("scenario route is disconnected")
			}
		}
	}
	for _, seen := range expected {
		if !seen {
			return fail("three primary scenarios required")
		}
	}
	return nil
}
