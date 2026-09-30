import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { NetworkCanvas } from "./workspace";
import { networkSchema } from "@/lib/api";
import config from "../../../packages/scenario-config/c1-c6.json";
import type { TrafficState } from "../../../packages/contracts/typescript/events";
afterEach(cleanup);
describe("configuration-driven canvas", () => {
  it("renders actual road-cell stock and does not substitute current queues for unavailable forecasts", () => {
    const network = networkSchema.parse(config);
    const frame = {movements:[],signals:[],cells:[{link_id:"C2-C1",stock_veh:[1,3]}],
      links:[{link_id:"C2-C1",stock_veh:4,queued_veh_estimate:2,inflow_vpm:10,speed_status:"unavailable"}]} as unknown as TrafficState;
    const {rerender} = render(<NetworkCanvas network={network} frame={frame} onSelect={()=>{}} />);
    expect(screen.getByRole("group",{name:"C2-C1 modeled road cells: 4.0 vehicles"})).toBeInTheDocument();
    rerender(<NetworkCanvas network={network} frame={frame} horizon={300} onSelect={()=>{}} />);
    expect(screen.getByRole("status")).toHaveTextContent("+300s forecast unavailable");
  });
  it("preserves configured camera boundaries and incident location for either graph", () => {
    const parsed = networkSchema.parse(config);
    expect(parsed).toMatchObject({camera_boundary_links:{"CAM-01":"C2-C1"},scenarios:expect.arrayContaining([expect.objectContaining({incident_node_id:"C3"})])});
  });
  it("renders supplied nodes and supports keyboard inspection", () => {
    const onSelect = vi.fn();
    const network = networkSchema.parse(config);
    render(<NetworkCanvas network={network} onSelect={onSelect} />);
    expect(screen.getAllByRole("button")).toHaveLength(6);
    fireEvent.keyDown(screen.getByRole("button", { name: /Inspect C3,/ }), {
      key: "Enter",
    });
    expect(onSelect).toHaveBeenCalledWith("C3");
  });
  it("uses replacement geometry instead of hardcoded C1–C6 nodes", () => {
    const network = networkSchema.parse(config);
    network.nodes = [
      { id: "NEW", label: "Replacement node", kind: "boundary", x: 60, y: 80 },
      { id: "END", label: "Exit", kind: "boundary", x: 300, y: 80 },
    ];
    network.links = [];
    render(<NetworkCanvas network={network} onSelect={() => {}} />);
    expect(
      screen.getByRole("button", { name: /Inspect NEW/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Inspect C1/ }),
    ).not.toBeInTheDocument();
  });
  it("rejects malformed configuration at the frontend boundary", () => {
    expect(() =>
      networkSchema.parse({ ...config, nodes: [{ id: "bad" }] }),
    ).toThrow();
  });
});
