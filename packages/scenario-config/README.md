# Virtual network configurations

`c1-c6.json` is the original two-controlled-junction graph. `three-controlled-junctions.json` adds synthetic junction C7 between C3 and C1. Both retain the three scenario IDs and the four declared external camera inputs. The incident scenario targets C3 in the original graph and C7 in the synthetic graph; the emergency route is declared separately in each file.

Set `NETWORK_CONFIG` to the selected JSON path for **Go, simulation, and intelligence together**. The API and both Python services validate the topology at startup. The mapping in `camera_boundary_links` must cover every external boundary link once and agree with `packages/camera-config/cameras.json`. Internal-link cameras cannot inject external mass.

Lengths, capacities, turning ratios, and vehicle-space assumptions in both files are synthetic. Independent recorded clips do not constitute measured corridor flow.
