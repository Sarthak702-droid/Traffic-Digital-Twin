import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VisionAnalyticsPanel } from "./vision-analytics-panel";

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

describe("T13: Vision & Network UI Integration (PRD §19.3)", () => {
  it("renders all 12 camera selectors and switches to the matching stream dashboard", () => {
    render(<VisionAnalyticsPanel />);

    // Verify the first six cameras and the second bank of six all exist.
    const cam1 = screen.getByRole("button", { name: "CAM-01" });
    const cam2 = screen.getByRole("button", { name: "CAM-02" });
    const cam3 = screen.getByRole("button", { name: "CAM-03" });
    const cam4 = screen.getByRole("button", { name: "CAM-04" });
    const cam5 = screen.getByRole("button", { name: "CAM-05" });
    const cam6 = screen.getByRole("button", { name: "CAM-06" });
    const cam7 = screen.getByRole("button", { name: "CAM-07" });
    const cam12 = screen.getByRole("button", { name: "CAM-12" });

    expect(cam1).toBeInTheDocument();
    expect(cam2).toBeInTheDocument();
    expect(cam3).toBeInTheDocument();
    expect(cam4).toBeInTheDocument();
    expect(cam5).toBeInTheDocument();
    expect(cam6).toBeInTheDocument();
    expect(cam7).toBeInTheDocument();
    expect(cam12).toBeInTheDocument();

    // Default selected camera is CAM-01
    expect(cam1).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Camera CAM-01 \(C2 → C1 Approach\)/i)).toBeInTheDocument();

    // Switch to CAM-02
    fireEvent.click(cam2);
    expect(cam2).toHaveAttribute("aria-pressed", "true");
    expect(cam1).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/Camera CAM-02 \(C4 → C1 Approach\)/i)).toBeInTheDocument();
    expect(screen.getByText(/CAM-02 Stream Dashboard/i)).toBeInTheDocument();

    // A stream in the second bank receives its own selected-camera dashboard too.
    fireEvent.click(cam12);
    expect(cam12).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Camera CAM-12 \(Intersection 4\)/i)).toBeInTheDocument();
    expect(screen.getByText(/CAM-12 Stream Dashboard/i)).toBeInTheDocument();
  });

  it("labels cached playback and does not claim that online inference is active", () => {
    render(<VisionAnalyticsPanel />);

    const cachedBtn = screen.getByRole("button", { name: /Cached Observations \(ITD v1\.2\)/i });
    expect(cachedBtn).toBeInTheDocument();
    expect(cachedBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Online inference requires a running vision job/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Online Inference Stream/i })).toBeNull();
  });

  it("renders PRD §19.3 authority classification labels clearly differentiating observation from modeled state", () => {
    render(<VisionAnalyticsPanel />);

    // Check the active data-authority classifications.
    expect(screen.getByText(/OBSERVED FROM VIDEO:/i)).toBeInTheDocument();
    expect(screen.getByText(/VIDEO STREAM SCOPE:/i)).toBeInTheDocument();
    expect(screen.getByText(/MODELED NETWORK STATE:/i)).toBeInTheDocument();
    expect(screen.getByText(/FORECAST:/i)).toBeInTheDocument();
  });

  it("mounts authoritative MP4 video element linked to media endpoint", () => {
    render(<VisionAnalyticsPanel />);

    const videoEl = screen.getByLabelText(/Authoritative MP4 Video Feed/i) as HTMLVideoElement;
    expect(videoEl).toBeInTheDocument();
    expect(videoEl.tagName.toLowerCase()).toBe("video");
    expect(videoEl.src).toContain("/api/v1/clips/CAM-01/media");

    // Switching camera updates the video source
    const cam3 = screen.getByRole("button", { name: "CAM-03" });
    fireEvent.click(cam3);
    expect(videoEl.src).toContain("/api/v1/clips/CAM-03/media");
  });

  it("shows useful selected-camera live frame insights", () => {
    render(<VisionAnalyticsPanel />);

    expect(screen.getByText(/Recorded Frame Insights/i)).toBeInTheDocument();
    expect(screen.getByText(/Queue pressure/i)).toBeInTheDocument();
    expect(screen.getByText(/Dominant type/i)).toBeInTheDocument();
    expect(screen.getByText(/Detected classes/i)).toBeInTheDocument();
  });
});
