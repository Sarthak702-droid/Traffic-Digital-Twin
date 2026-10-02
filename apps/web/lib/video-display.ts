export const DISPLAY_TELEMETRY_VERSION = "display-detections-v2";

// Select only a completed inference sample at or before the displayed source time.
// Never clamp uncovered video to the final detection frame.
export function detectionFrameIndex(telemetry: any, time: number): number {
  if (telemetry?.schema_version !== DISPLAY_TELEMETRY_VERSION || !Number.isFinite(time) || time < 0 || time >= telemetry.duration_s) return -1;
  const frames = telemetry.frames ?? [];
  let low = 0, high = frames.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (frames[mid].time_s <= time) low = mid + 1;
    else high = mid;
  }
  const index = low - 1;
  return index >= 0 && time < frames[index].valid_until_s ? index : -1;
}

export function canvasSize(width: number, height: number) {
  const scale = Math.min(1, 960 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function sameGeometry(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
