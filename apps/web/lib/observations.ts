export interface DisplayObservation {
  observation_id: string;
  window_end_s: number;
  available_at_source_s: number;
  processed_at_utc: string;
  crossings_veh: number;
  [key: string]: unknown;
}

export function latestDisplayObservation<T extends DisplayObservation>(rows: T[], displaySourceS: number): T | null {
  if (!Number.isFinite(displaySourceS) || displaySourceS < 0) return null;
  return rows.filter((row) => Number.isFinite(row.window_end_s) && Number.isFinite(row.available_at_source_s) &&
    row.window_end_s <= displaySourceS && row.available_at_source_s <= displaySourceS &&
    !!row.processed_at_utc && !Number.isNaN(Date.parse(row.processed_at_utc)))
    .sort((a, b) => a.window_end_s - b.window_end_s).at(-1) ?? null;
}
