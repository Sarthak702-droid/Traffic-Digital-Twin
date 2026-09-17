import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { NetworkCanvas } from "./workspace";
import { networkSchema } from "@/lib/api";
import config from "../../../packages/scenario-config/c1-c6.json";
afterEach(cleanup);
describe("configuration-driven canvas", () => {
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
