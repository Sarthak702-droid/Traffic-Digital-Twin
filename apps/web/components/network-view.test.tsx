import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { NetworkView, outcome } from "./network-view";
import network from "../../../packages/scenario-config/c1-c6.json";
import type { Network } from "../../../packages/contracts/typescript/network";

describe("comparison evidence", () => {
  afterEach(cleanup);
  it("shows unavailable instead of invented outcomes without a result", () => {
    render(<NetworkView network={network as unknown as Network} frame={null} analysis={null} onSelectNode={()=>{}}/>);
    fireEvent.click(screen.getByRole("button", {name:/Before vs After/}));
    expect(screen.getByRole("status")).toHaveTextContent("No aggregate scenario is running");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("starts the seeded aggregate demo when comparison has no active scenario", () => {
    const onStartScenario = vi.fn();
    render(<NetworkView network={network as unknown as Network} frame={null} analysis={null} onSelectNode={()=>{}} onStartScenario={onStartScenario}/>);
    fireEvent.click(screen.getByRole("button", {name:/Before vs After/}));
    fireEvent.click(screen.getByRole("button", {name:"Start peak-surge aggregate demo"}));
    expect(onStartScenario).toHaveBeenCalledTimes(1);
  });
  it("reports worse, unchanged and zero baselines without division by zero", () => {
    expect(outcome(10, 12)).toBe("Worse: 2.00 (20.0%)");
    expect(outcome(10, 8)).toBe("Improved: 2.00 (20.0%)");
    expect(outcome(0, 0)).toBe("Unchanged");
    expect(outcome(0, 2)).toBe("Worse: 2.00 (baseline is zero)");
  });
});

describe('comparison safety',()=>{
 afterEach(cleanup);
 it('does not display a comparison from another input epoch',()=>{
  const frame={schema_version:'1.1',run_id:'run',input_session_id:'current',snapshot_sequence:'9',config_hash:'cfg',metrics_version:'metrics',movements:[],signals:[],seed:1} as any;
  const comparison={run_id:'run',recommendation_id:'rec',input_session_id:'old',snapshot_sequence:'9',config_hash:'cfg',metrics_version:'metrics',baseline_max_queue_veh:1,candidate_max_queue_veh:0,horizon_s:120} as any;
  const analysis={run_id:'run',input_session_id:'current',snapshot_sequence:'9',config_hash:'cfg',metrics_version:'metrics',outcome:'recommend',forecasts:[],recommendation:{id:'rec'},comparison} as any;
  render(<NetworkView network={network as unknown as Network} frame={frame} analysis={analysis} onSelectNode={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:/Before vs After/}));
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
 });
});
