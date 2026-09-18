import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { DgpPresentationModal } from "./dgp-presentation";
import type { TrafficState } from "../../../packages/contracts/typescript/events";

const makeSampleState = (): TrafficState => ({
  schema_version: "1.0",
  run_id: "run-e11-test",
  timestamp: new Date().toISOString(),
  simulation_time_s: 142.5,
  source: "synthetic",
  replay: false,
  movements: [],
  signals: [],
  vehicles_in_network: 38,
  inserted_total: 120,
  arrived_total: 82,
  teleported_total: 0,
  scenario_type: "peak_surge",
  seed: 1101,
  active_plan: [],
});

describe("Epic 11 S34: Guided 8-Step DGP Demonstration Presentation", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with offline briefing status badge when no live frame is connected", () => {
    render(<DgpPresentationModal open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByText(/EXPLANATORY BRIEFING/)).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 8")).toBeInTheDocument();
    expect(screen.getAllByText("Current Network State").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL/),
    ).toBeInTheDocument();
  });

  it("renders live twin status pill with scenario and seed when frame is supplied", () => {
    const frame = makeSampleState();
    render(
      <DgpPresentationModal
        open={true}
        onOpenChange={vi.fn()}
        frame={frame}
      />,
    );

    expect(screen.getByText(/LIVE TWIN ACTIVE/)).toBeInTheDocument();
    expect(screen.getByText(/peak_surge/)).toBeInTheDocument();
    expect(screen.getByText(/Seed 1101/)).toBeInTheDocument();
  });

  it("renders golden replay status badge when replay frame is supplied", () => {
    const frame = { ...makeSampleState(), replay: true };
    render(
      <DgpPresentationModal
        open={true}
        onOpenChange={vi.fn()}
        frame={frame}
      />,
    );

    expect(screen.getByText(/GOLDEN REPLAY STREAM/)).toBeInTheDocument();
  });

  it("navigates through all 8 steps using Next Step and Previous buttons", () => {
    render(<DgpPresentationModal open={true} onOpenChange={vi.fn()} />);

    // Step 1 -> Step 2
    fireEvent.click(screen.getByRole("button", { name: "Next Step" }));
    expect(screen.getByText("Step 2 of 8")).toBeInTheDocument();
    expect(screen.getAllByText("Future Congestion Prediction").length).toBeGreaterThan(0);

    // Step 2 -> Step 3
    fireEvent.click(screen.getByRole("button", { name: "Next Step" }));
    expect(screen.getByText("Step 3 of 8")).toBeInTheDocument();
    expect(screen.getAllByText("Coordinated Recommendation").length).toBeGreaterThan(0);

    // Step 3 -> Step 4
    fireEvent.click(screen.getByRole("button", { name: "Next Step" }));
    expect(screen.getByText("Step 4 of 8")).toBeInTheDocument();
    expect(screen.getAllByText("Before-vs-After Twin Simulation").length).toBeGreaterThan(0);

    // Step 4 -> Step 5
    fireEvent.click(screen.getByRole("button", { name: "Next Step" }));
    expect(screen.getByText("Step 5 of 8")).toBeInTheDocument();
    expect(screen.getAllByText("C3 Incident Scenario").length).toBeGreaterThan(0);

    // Step 5 -> Step 6
    fireEvent.click(screen.getByRole("button", { name: "Next Step" }));
    expect(screen.getByText("Step 6 of 8")).toBeInTheDocument();
    expect(screen.getAllByText("Ambulance Corridor Priority").length).toBeGreaterThan(0);

    // Step 6 -> Step 7
    fireEvent.click(screen.getByRole("button", { name: "Next Step" }));
    expect(screen.getByText("Step 7 of 8")).toBeInTheDocument();
    expect(screen.getAllByText("Human Authority & Audit Trail").length).toBeGreaterThan(0);

    // Step 7 -> Step 8
    fireEvent.click(screen.getByRole("button", { name: "Next Step" }));
    expect(screen.getByText("Step 8 of 8")).toBeInTheDocument();
    expect(screen.getAllByText("Shadow-Pilot Recommendation").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Complete Briefing/ })).toBeInTheDocument();

    // Step 8 -> Previous -> Step 7
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Step 7 of 8")).toBeInTheDocument();
  });

  it("supports keyboard arrow navigation (ArrowRight, ArrowLeft, Home, End)", () => {
    render(<DgpPresentationModal open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByText("Step 1 of 8")).toBeInTheDocument();

    // ArrowRight to Step 2
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Step 2 of 8")).toBeInTheDocument();

    // End to Step 8
    fireEvent.keyDown(window, { key: "End" });
    expect(screen.getByText("Step 8 of 8")).toBeInTheDocument();

    // Home to Step 1
    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByText("Step 1 of 8")).toBeInTheDocument();
  });

  it("toggles the presenter preflight checklist with 8 critical release controls", () => {
    render(<DgpPresentationModal open={true} onOpenChange={vi.fn()} />);

    const preflightBtn = screen.getByRole("button", {
      name: /Toggle presenter preflight checklist/,
    });
    fireEvent.click(preflightBtn);

    expect(
      screen.getByText(/Presenter Preflight Checklist \(8-Minute Demonstration Gate\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL Local Database")).toBeInTheDocument();
    expect(screen.getByText("Go Public API Gateway")).toBeInTheDocument();
    expect(screen.getByText("Private Python Simulation")).toBeInTheDocument();
    expect(screen.getByText("Private Python Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Deterministic Scenario Seeds")).toBeInTheDocument();
    expect(screen.getByText("Offline Golden Replay Fallback")).toBeInTheDocument();
    expect(screen.getByText("Display & Keyboard Accessibility")).toBeInTheDocument();
    expect(screen.getByText("Synthetic Disclosure Compliance")).toBeInTheDocument();

    // Return to slide
    fireEvent.click(screen.getByRole("button", { name: /Return to Slide/ }));
    expect(screen.getAllByText("Current Network State").length).toBeGreaterThan(0);
  });

  it("toggles speaker script notes with timing cues, pitch, and Q&A", () => {
    render(<DgpPresentationModal open={true} onOpenChange={vi.fn()} />);

    const scriptBtn = screen.getByRole("button", {
      name: /Toggle presenter script and talking points/,
    });
    fireEvent.click(scriptBtn);

    expect(screen.getByText(/SPEAKER NOTES · 60 seconds/)).toBeInTheDocument();
    expect(screen.getByText("Suggested Spoken Phrasing:")).toBeInTheDocument();
    expect(screen.getByText("Technical Truth (Under the Hood):")).toBeInTheDocument();
    expect(screen.getByText("Anticipated Question & Crisp Answer:")).toBeInTheDocument();
    expect(screen.getByText(/Director General, what you see on screen/)).toBeInTheDocument();
  });

  it("allows direct jump to any step via stepper buttons", () => {
    render(<DgpPresentationModal open={true} onOpenChange={vi.fn()} />);

    const jumpBtn = screen.getByRole("button", {
      name: "Jump to step 5: C3 Incident Scenario",
    });
    fireEvent.click(jumpBtn);

    expect(screen.getByText("Step 5 of 8")).toBeInTheDocument();
    expect(screen.getAllByText("C3 Incident Scenario").length).toBeGreaterThan(0);
  });

  it("calls onOpenChange(false) when Complete Briefing button is clicked", () => {
    const onOpenChange = vi.fn();
    render(<DgpPresentationModal open={true} onOpenChange={onOpenChange} />);

    // Jump to last step
    fireEvent.keyDown(window, { key: "End" });
    const completeBtn = screen.getByRole("button", { name: /Complete Briefing/ });
    fireEvent.click(completeBtn);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
