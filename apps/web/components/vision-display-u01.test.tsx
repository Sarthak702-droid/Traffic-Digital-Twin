import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VisionAnalyticsPanel } from "./vision-analytics-panel";

afterEach(cleanup);
describe("recorded clip display", () => {
  it("loops display playback and keeps only the video transport without a timer", () => {
    render(<VisionAnalyticsPanel />);
    expect(screen.getByText(/display seek only/i)).toBeInTheDocument();
    const video = screen.getByLabelText("Recorded clip display only") as HTMLVideoElement;
    expect(video.loop).toBe(true);
    expect(screen.queryByRole("slider", { name: "Video frame scrubber" })).not.toBeInTheDocument();
    expect(screen.queryByText("Replay progress")).not.toBeInTheDocument();
    expect(screen.getByText("Class Breakdown unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause video" }));
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "CAM-12" }));
    expect(screen.getByRole("button", { name: "Play video" })).toBeInTheDocument();
  });
});

it("allows explicit observation-session selection without an authoritative recorded run",()=>{
 const onSelectSourceSession=vi.fn();
 render(<VisionAnalyticsPanel {...{processedClips:[{camera_id:"CAM-01",source_session_id:"selected",config_hash:"cfg",status:"cached_valid",window_count:12}],sourceSessions:{},onSelectSourceSession} as any}/>);
 fireEvent.change(screen.getByRole("combobox",{name:"Observation source session"}),{target:{value:"selected"}});
 expect(onSelectSourceSession).toHaveBeenCalledWith("CAM-01","selected");
});

it("uses actual portrait metadata for the canvas", () => {
  render(<VisionAnalyticsPanel />);
  const video = screen.getByLabelText("Recorded clip display only");
  Object.defineProperty(video, "videoWidth", { value: 2160, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: 3840, configurable: true });
  fireEvent.loadedMetadata(video);
  expect(video).toHaveAttribute("data-media-ready", "true");
  const canvas = screen.getByLabelText(/Computer vision video stream/);
  expect(Number(canvas.getAttribute("width")) / Number(canvas.getAttribute("height"))).toBeCloseTo(2160 / 3840, 2);
  fireEvent.click(screen.getByRole("button", { name: "CAM-11" }));
  expect(video).toHaveAttribute("data-media-ready", "false");
});
