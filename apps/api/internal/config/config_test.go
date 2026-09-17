package config

import (
	"math"
	"testing"
)

func fixture(t *testing.T) Network {
	t.Helper()
	n, e := Load("../../../../packages/scenario-config/c1-c6.json")
	if e != nil {
		t.Fatal(e)
	}
	return n
}
func TestNetworkValidation(t *testing.T) {
	n := fixture(t)
	if len(n.Nodes) != 6 || len(n.Links) != 10 || len(n.Scenarios) != 3 {
		t.Fatal("unexpected default topology")
	}
	cases := map[string]func(*Network){
		"duplicate node":     func(n *Network) { n.Nodes[1].ID = n.Nodes[0].ID },
		"geometry overlap":   func(n *Network) { n.Nodes[1].X = n.Nodes[0].X; n.Nodes[1].Y = n.Nodes[0].Y },
		"nonfinite geometry": func(n *Network) { n.Nodes[0].X = math.NaN() },
		"unknown link":       func(n *Network) { n.Links[0].To = "missing" },
		"zero storage":       func(n *Network) { n.Links[0].Storage = 0 },
		"turning sum":        func(n *Network) { n.Movements[0].Ratio = .99 },
		"min max":            func(n *Network) { n.Phases[0].Min = 100 },
		"clearance":          func(n *Network) { n.Phases[0].AllRed = 0 },
		"missing conflict":   func(n *Network) { n.Conflicts = nil },
		"conflicting greens": func(n *Network) { n.Phases[0].Movements = append(n.Phases[0].Movements, n.Phases[1].Movements[0]) },
		"boundary phase":     func(n *Network) { n.Phases[0].Node = "C2" },
		"seed":               func(n *Network) { n.Scenarios[0].Seed = 0 },
		"duplicate seed":     func(n *Network) { n.Scenarios[1].Seed = n.Scenarios[0].Seed },
		"disconnected route": func(n *Network) { n.Scenarios[2].Route = []string{"C6", "C2"} },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			n := fixture(t)
			mutate(&n)
			if n.Validate() == nil {
				t.Fatal("invalid configuration accepted")
			}
		})
	}
}
