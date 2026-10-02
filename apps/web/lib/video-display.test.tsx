import { describe, expect, it } from "vitest";
import { canvasSize, detectionFrameIndex, sameGeometry } from "./video-display";

describe("source-time display detections", () => {
  const telemetry = { schema_version: "display-detections-v2", duration_s: 15, frames: [
    {time_s: 0, valid_until_s: .1}, {time_s: .1, valid_until_s: .2}, {time_s: 12, valid_until_s: 12.1}
  ]};
  it("does not show future, stale, legacy or uncovered boxes", () => {
    expect(detectionFrameIndex(telemetry, .05)).toBe(0);
    expect(detectionFrameIndex(telemetry, .1)).toBe(1);
    expect(detectionFrameIndex(telemetry, 8)).toBe(-1);
    expect(detectionFrameIndex(telemetry, 15)).toBe(-1);
    expect(detectionFrameIndex({...telemetry, schema_version: undefined}, 0)).toBe(-1);
  });
  it("returns to the first sample on each display-only loop", () => {
    expect(detectionFrameIndex(telemetry, 12)).toBe(2);
    expect(detectionFrameIndex(telemetry, 0)).toBe(0);
    expect(detectionFrameIndex(telemetry, 0)).toBe(0);
    expect(telemetry.frames).toHaveLength(3);
  });
  it("preserves portrait and landscape proportions", () => {
    expect(canvasSize(2160, 3840)).toEqual({width: 540, height: 960});
    expect(canvasSize(3840, 2160)).toEqual({width: 960, height: 540});
  });
});

it("matches geometry regardless of Go JSON property ordering", () => {
  expect(sameGeometry({road_roi: [[0,1]], counting_line: {p1: [0,0], p2: [1,1]}},
    {counting_line: {p2: [1,1], p1: [0,0]}, road_roi: [[0,1]]})).toBe(true);
  expect(sameGeometry({road_roi: [[0,1]]}, {road_roi: [[1,0]]})).toBe(false);
});

it("uses only a display rendition bound to the registered source", async () => {
  const { displayMediaURL } = await import("./video-display");
  const hash = "a".repeat(64);
  const manifest = { schema_version: "display-rendition-v1", cameras: {"CAM-10": {source_clip_sha256: hash, filename: `CAM-10-${hash}-v1.mp4`}} };
  expect(displayMediaURL("CAM-10", hash, manifest)).toBe(`/vision-display-media/CAM-10-${hash}-v1.mp4`);
  expect(displayMediaURL("CAM-10", "b".repeat(64), manifest)).toBeNull();
  expect(displayMediaURL("CAM-11", hash, manifest)).toBeNull();
  expect(displayMediaURL("CAM-10", hash, {...manifest, cameras: {"CAM-10": {...manifest.cameras['CAM-10'], filename: "https://external.invalid/video.mp4"}}})).toBeNull();
});
