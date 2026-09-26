import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VisionAnalyticsPanel } from "./vision-analytics-panel";

describe("recorded clip display", () => {
  it("labels the seek as display only and does not silently loop the recording", () => {
    render(<VisionAnalyticsPanel />);
    expect(screen.getByText(/display seek only/i)).toBeInTheDocument();
    const video = screen.getByLabelText("Recorded clip display only") as HTMLVideoElement;
    expect(video.loop).toBe(false);
  });
});
