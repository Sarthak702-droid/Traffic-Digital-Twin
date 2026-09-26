import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ActionRail } from "./action-rail";
import network from "../../../packages/scenario-config/c1-c6.json";
import type { Analysis } from "../../../packages/contracts/typescript/events";
import type { Network } from "../../../packages/contracts/typescript/network";

const mutation = { mutate: vi.fn(), isPending: false, isError: false, error: null, isSuccess: false, reset: vi.fn() };
const props = { network: network as unknown as Network, frame: null, scenarioID: "peak_surge" as const,
  setScenarioID: vi.fn(), seed: "1101", setSeed: vi.fn(), dbReady: true, liveFresh: true,
  prepareMutation: mutation, resetMutation: mutation, onSimulate: vi.fn(), onApprove: vi.fn(),
  onModify: vi.fn(), onReject: vi.fn(), decisionPending: false };

describe("explicit analysis outcomes", () => {
  it("explains no action and unsuitable input without offering approval", () => {
    render(<ActionRail {...props} analysis={{ run_id: "run", simulation_time_s: 1, forecasts: [], alternatives: [], outcome: "no_action", outcome_reason: "Gain below threshold" } as Analysis} />);
    expect(screen.getByText(/No timing change recommended.*Gain below threshold/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve in Twin/ })).not.toBeInTheDocument();
    cleanup();
    render(<ActionRail {...props} analysis={{ run_id: "run", simulation_time_s: 1, forecasts: [], alternatives: [], outcome: "cannot_evaluate", outcome_reason: "Stale input" } as Analysis} />);
    expect(screen.getByText(/Cannot evaluate a safe plan.*Stale input/)).toBeInTheDocument();
  });
});
