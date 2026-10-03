import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import cameras from "../../../packages/camera-config/cameras.json";
import assets from "../../../reports/asset-manifest.json";
import { VisionAnalyticsPanel } from "./vision-analytics-panel";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("retains fetched authoritative observations when the display rendition arrives later", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: vi.fn(), clearRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(),
  } as any);
  const response = (payload: unknown) => ({ ok: true, json: async () => payload }) as Response;
  let finishRendition!: (response: Response) => void;
  const delayedRendition = new Promise<Response>(resolve => { finishRendition = resolve; });
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path === "/vision-display-media/manifest.json") return delayedRendition;
    if (path === "/api/v1/cameras") return response({ cameras: cameras.cameras, assets: assets.assets });
    if (path === "/vision-display-data.json") return response({});
    if (path.startsWith("/api/v1/observations?")) return response({ status: "cached_valid", observations: [{
      window_start_s: 0, window_end_s: 5, available_at_source_s: 5, observation_status: "valid",
      crossings_veh: 1, flow_vpm: 12, processed_at_utc: "2026-10-02T00:00:00Z",
    }] });
    throw new Error(`Unexpected fixture request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<VisionAnalyticsPanel frame={{ run_id: "held-run", demand_source: "video_profile" } as any}
    boundaryMapping={{ "CAM-01": "C2-C1" }} sourceSessions={{ "CAM-01": "registered-source" }} />);
  await screen.findByText(/^Observation source: cached valid/);
  const sha = assets.assets.find(asset => asset.assigned_slot === "CAM-01")!.sha256;
  const filename = `CAM-01-${sha}-v1.mp4`;
  await act(async () => { finishRendition(response({ schema_version: "display-rendition-v1",
    cameras: { "CAM-01": { filename, source_clip_sha256: sha } } })); });
  await waitFor(() => expect(screen.getByLabelText("Recorded clip display only"))
    .toHaveAttribute("src", `/vision-display-media/${filename}`));
  expect(screen.getByText(/^Observation source: cached valid/)).toBeInTheDocument();
  const video = screen.getByLabelText("Recorded clip display only") as HTMLVideoElement;
  video.currentTime = 5.3;
  fireEvent.timeUpdate(video);
  expect(within(screen.getByRole("region", { name: "CAM-01 finalized ITD observation" })).getByText("0–5s"))
    .toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/v1/observations?"))).toHaveLength(1);
});
