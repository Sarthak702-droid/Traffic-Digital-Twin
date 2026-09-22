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
  it("renders camera selector with CAM-01 through CAM-06 and switches cameras", () => {
    render(<VisionAnalyticsPanel />);

    // Verify all 6 camera buttons exist
    const cam1 = screen.getByRole("button", { name: "CAM-01" });
    const cam2 = screen.getByRole("button", { name: "CAM-02" });
    const cam3 = screen.getByRole("button", { name: "CAM-03" });
    const cam4 = screen.getByRole("button", { name: "CAM-04" });
    const cam5 = screen.getByRole("button", { name: "CAM-05" });
    const cam6 = screen.getByRole("button", { name: "CAM-06" });

    expect(cam1).toBeInTheDocument();
    expect(cam2).toBeInTheDocument();
    expect(cam3).toBeInTheDocument();
    expect(cam4).toBeInTheDocument();
    expect(cam5).toBeInTheDocument();
    expect(cam6).toBeInTheDocument();

    // Default selected camera is CAM-01
    expect(cam1).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Camera CAM-01 \(Approach to Junction C1\)/i)).toBeInTheDocument();

    // Switch to CAM-02
    fireEvent.click(cam2);
    expect(cam2).toHaveAttribute("aria-pressed", "true");
    expect(cam1).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/Camera CAM-02 \(Approach to Junction C1\)/i)).toBeInTheDocument();
  });

  it("renders dual processing modes and toggles between cached and online inference", () => {
    render(<VisionAnalyticsPanel />);

    const cachedBtn = screen.getByRole("button", { name: /Cached Observations \(ITD v1\.2\)/i });
    const onlineBtn = screen.getByRole("button", { name: /Online Inference Stream/i });

    expect(cachedBtn).toBeInTheDocument();
    expect(onlineBtn).toBeInTheDocument();

    // Default mode is cached observations
    expect(cachedBtn).toHaveAttribute("aria-pressed", "true");
    expect(onlineBtn).toHaveAttribute("aria-pressed", "false");

    // Switch to online stream mode
    fireEvent.click(onlineBtn);
    expect(onlineBtn).toHaveAttribute("aria-pressed", "true");
    expect(cachedBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("renders PRD §19.3 authority classification labels clearly differentiating observation from modeled state", () => {
    render(<VisionAnalyticsPanel />);

    // Check all 5 authority classification labels
    expect(screen.getByText(/OBSERVED FROM VIDEO:/i)).toBeInTheDocument();
    expect(screen.getByText(/VIDEO-DERIVED SCENARIO INPUT:/i)).toBeInTheDocument();
    expect(screen.getByText(/MODELED NETWORK STATE:/i)).toBeInTheDocument();
    expect(screen.getByText(/FORECAST:/i)).toBeInTheDocument();
    expect(screen.getByText(/UNAVAILABLE:/i)).toBeInTheDocument();
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

  it("honestly marks uncalibrated speed unavailable without fabricating values", () => {
    render(<VisionAnalyticsPanel />);

    expect(screen.getByText(/No calibrated speed measurement/i)).toBeInTheDocument();
    expect(screen.getByText(/Uncalibrated sample video is not an authoritative km\/h source/i)).toBeInTheDocument();
  });
});
