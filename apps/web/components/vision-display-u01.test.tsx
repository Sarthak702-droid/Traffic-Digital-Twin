import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VisionAnalyticsPanel } from "./vision-analytics-panel";

afterEach(cleanup);
describe("recorded clip display", () => {
  it("labels the seek as display only and does not silently loop the recording", () => {
    render(<VisionAnalyticsPanel />);
    expect(screen.getByText(/display seek only/i)).toBeInTheDocument();
    const video = screen.getByLabelText("Recorded clip display only") as HTMLVideoElement;
    expect(video.loop).toBe(false);
  });
});

it("allows explicit observation-session selection without an authoritative recorded run",()=>{
 const onSelectSourceSession=vi.fn();
 render(<VisionAnalyticsPanel {...{processedClips:[{camera_id:"CAM-01",source_session_id:"selected",config_hash:"cfg",status:"cached_valid",window_count:12}],sourceSessions:{},onSelectSourceSession} as any}/>);
 fireEvent.change(screen.getByRole("combobox",{name:"Observation source session"}),{target:{value:"selected"}});
 expect(onSelectSourceSession).toHaveBeenCalledWith("CAM-01","selected");
});
