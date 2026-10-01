import {describe, expect, it} from "vitest";
import {inputDisclosure} from "./input-disclosure";

describe("authoritative input disclosure", () => {
  it("distinguishes recorded demand from model state and seeded inputs", () => {
    expect(inputDisclosure({demand_source:"video_profile", replay:false})).toBe("VIDEO-DERIVED DEMAND · VIRTUAL MODEL STATE");
    expect(inputDisclosure({demand_source:"seeded", replay:false})).toBe("SYNTHETIC TRAFFIC DATA");
  });
  it("labels explicit replay and missing run input separately", () => {
    expect(inputDisclosure({demand_source:"video_profile", replay:true})).toBe("PRERECORDED REPLAY · VIRTUAL MODEL STATE");
    expect(inputDisclosure(undefined)).toBe("RUN INPUT UNAVAILABLE");
  });
});
