import { describe, expect, it } from "vitest";
import { latestDisplayObservation } from "./observations";

describe("display-only finalized observation selection", () => {
  const rows = [
    { observation_id: "zero", window_end_s: 5, available_at_source_s: 6, processed_at_utc: "2026-09-27T00:00:00Z", crossings_veh: 0 },
    { observation_id: "future", window_end_s: 10, available_at_source_s: 12, processed_at_utc: "2026-09-27T00:00:01Z", crossings_veh: 4 },
  ];
  it("preserves valid zero and waits for actual availability", () => {
    expect(latestDisplayObservation(rows, 5)).toBeNull();
    expect(latestDisplayObservation(rows, 6)?.crossings_veh).toBe(0);
    expect(latestDisplayObservation(rows, 10)?.observation_id).toBe("zero");
    expect(latestDisplayObservation(rows, 12)?.observation_id).toBe("future");
  });
});

it('does not hold old measurements beyond two window durations',()=>{
 const row={observation_id:'old',window_start_s:0,window_end_s:5,available_at_source_s:5,processed_at_utc:'2026-09-01T00:00:00Z',crossings_veh:3};
 expect(latestDisplayObservation([row],16)).toBeNull();
 expect(latestDisplayObservation([row],6)?.crossings_veh).toBe(3);
});
