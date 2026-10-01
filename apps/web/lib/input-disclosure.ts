import type {TrafficState} from "../../../packages/contracts/typescript/events";

export function inputDisclosure(frame?: Pick<TrafficState, "demand_source" | "replay"> | null): string {
  if (!frame) return "RUN INPUT UNAVAILABLE";
  if (frame.replay) return "PRERECORDED REPLAY · VIRTUAL MODEL STATE";
  if (frame.demand_source === "video_profile") return "VIDEO-DERIVED DEMAND · VIRTUAL MODEL STATE";
  return "SYNTHETIC TRAFFIC DATA";
}
