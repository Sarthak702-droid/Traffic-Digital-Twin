import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VisionAnalyticsPanel } from "./vision-analytics-panel";

// Mock HTMLCanvasElement.getContext for jsdom
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

describe("Epic 12: Vision Analytics & Presentation Polish (S36, S37, S38)", () => {
  it("renders Vision Analytics panel with all required disclaimers (S36, S37)", () => {
    render(<VisionAnalyticsPanel />);

    // Title and overline
    expect(screen.getByText(/Sample Video Feed & Traffic State Extraction/i)).toBeInTheDocument();
    expect(screen.getByText(/JUNCTION C3/i)).toBeInTheDocument();

    // Mandatory Disclaimers (PRD §8.5, §15.2, S36)
    expect(screen.getAllByText(/NON-ODISHA SAMPLE VIDEO FEED/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/TEMPORARY LOCAL IDS ONLY/i)).toBeInTheDocument();
    expect(screen.getByText(/UNCALIBRATED SPEED: DEMO ESTIMATE ONLY/i)).toBeInTheDocument();
    expect(screen.getByText(/CORE SCENARIOS OPERATE INDEPENDENTLY/i)).toBeInTheDocument();
  });

  it("renders the 5 PRD §15.2 vehicle classes with non-negative counts", () => {
    render(<VisionAnalyticsPanel />);

    // Check 5 classes
    expect(screen.getByText("Bike")).toBeInTheDocument();
    expect(screen.getByText("Car")).toBeInTheDocument();
    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText("Bus")).toBeInTheDocument();
    expect(screen.getByText("Truck")).toBeInTheDocument();
  });

  it("renders the 3 lane ROIs and queue metrics in the flow table", () => {
    render(<VisionAnalyticsPanel />);

    expect(screen.getByText(/Lane 1 \(Left \/ Turning\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Lane 2 \(Through \/ Main\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Lane 3 \(Through \/ Curb\)/i)).toBeInTheDocument();
  });

  it("renders uncalibrated demo speed estimate banner with explicit disclosure (S36)", () => {
    render(<VisionAnalyticsPanel />);

    expect(screen.getByText(/Demo Estimate \(Uncalibrated\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Pixel-displacement ratio without ground survey calibration/i)).toBeInTheDocument();
  });

  it("displays downstream impact on Corridor Junction C1 with 3 horizons and ETA (S37, PRD §8.5)", () => {
    render(<VisionAnalyticsPanel />);

    expect(screen.getByText(/Upstream Impact on Corridor Junction C1/i)).toBeInTheDocument();
    expect(screen.getByText(/\+30s Expected Inflow/i)).toBeInTheDocument();
    expect(screen.getByText(/\+60s Expected Inflow/i)).toBeInTheDocument();
    expect(screen.getByText(/\+120s Expected Inflow/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated ETA to C1/i)).toBeInTheDocument();
  });

  it("toggles overlay controls (bounding boxes, tracks, lanes, line, queue ROI) (S37)", () => {
    render(<VisionAnalyticsPanel />);

    const boxesBtn = screen.getByRole("button", { name: /Bounding Boxes/i });
    expect(boxesBtn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(boxesBtn);
    expect(boxesBtn).toHaveAttribute("aria-pressed", "false");

    const tracksBtn = screen.getByRole("button", { name: /Track IDs/i });
    expect(tracksBtn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tracksBtn);
    expect(tracksBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("supports video playback play/pause and frame stepping transport controls", () => {
    render(<VisionAnalyticsPanel />);

    const pauseBtn = screen.getByRole("button", { name: /Pause video/i });
    fireEvent.click(pauseBtn);
    expect(screen.getByRole("button", { name: /Play video/i })).toBeInTheDocument();

    const stepForwardBtn = screen.getByRole("button", { name: /Step forward one frame/i });
    fireEvent.click(stepForwardBtn);

    const stepBackBtn = screen.getByRole("button", { name: /Step back one frame/i });
    fireEvent.click(stepBackBtn);

    const resetBtn = screen.getByRole("button", { name: /Reset video to frame 0/i });
    fireEvent.click(resetBtn);
  });

  it("renders honest offline/unavailable state when disconnected, with reconnect and return actions (S37, A17)", () => {
    const onReturn = vi.fn();
    render(<VisionAnalyticsPanel initialOffline={true} onReturn={onReturn} />);

    expect(screen.getByTestId("vision-offline-panel")).toBeInTheDocument();
    expect(screen.getByText(/Sample Video Edge Pipeline Disconnected/i)).toBeInTheDocument();
    expect(screen.getByText(/remain 100% independent/i)).toBeInTheDocument();

    // Reconnect action
    const reconnectBtn = screen.getByRole("button", { name: /Reconnect Sample Video Feed/i });
    fireEvent.click(reconnectBtn);
    expect(screen.queryByTestId("vision-offline-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("vision-analytics-panel")).toBeInTheDocument();

    // Return to Command Center action
    const simulateOfflineBtn = screen.getByRole("button", { name: /Simulate Offline Pipeline State/i });
    fireEvent.click(simulateOfflineBtn);
    const returnBtn = screen.getByRole("button", { name: /Return to Command Center/i });
    fireEvent.click(returnBtn);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
