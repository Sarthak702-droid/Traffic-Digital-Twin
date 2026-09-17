import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NetworkView, outcome } from "./network-view";
import network from "../../../packages/scenario-config/c1-c6.json";
import type { Network } from "../../../packages/contracts/typescript/network";

describe("comparison evidence", () => {
  it("shows unavailable instead of invented outcomes without a result", () => {
    render(<NetworkView network={network as unknown as Network} frame={null} analysis={null} onSelectNode={()=>{}}/>);
    fireEvent.click(screen.getByRole("button", {name:/Before vs After/}));
    expect(screen.getByRole("status")).toHaveTextContent("No matching comparison available");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("reports worse, unchanged and zero baselines without division by zero", () => {
    expect(outcome(10, 12)).toBe("Worse: 2.00 (20.0%)");
    expect(outcome(10, 8)).toBe("Improved: 2.00 (20.0%)");
    expect(outcome(0, 0)).toBe("Unchanged");
    expect(outcome(0, 2)).toBe("Worse: 2.00 (baseline is zero)");
  });
});
