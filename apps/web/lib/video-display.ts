export const DISPLAY_TELEMETRY_VERSION = "display-aggregates-v3";

export function isAggregateTelemetry(value: any): boolean {
  if(value?.schema_version!==DISPLAY_TELEMETRY_VERSION || !Array.isArray(value.frames)) return false;
  const denied=new Set(["trackid","trackids","trackingid","detections","trail","trails","bbox","bboxhistory","centroid","trajectory","trajectories","rawframe","rawvideo","credentials","password","computetoken"]);
  const walk=(item:any,depth:number):boolean=>{
    if(depth>50)return false;
    if(Array.isArray(item))return item.every(child=>walk(child,depth+1));
    if(item && typeof item==="object")return Object.entries(item).every(([key,child])=>!denied.has(key.toLowerCase().replace(/[^a-z0-9]/g,"")) && walk(child,depth+1));
    return true;
  };
  return walk(value,0);
}

// Select only a completed inference sample at or before the displayed source time.
// Never clamp uncovered video to the final detection frame.
export function detectionFrameIndex(telemetry: any, time: number): number {
  if (!isAggregateTelemetry(telemetry) || !Number.isFinite(time) || time < 0 || time >= telemetry.duration_s) return -1;
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

// A display copy is never an authoritative input. Its source must match the registry.
export function displayMediaURL(camera: string, clipSha256: string | undefined, manifest: any): string | null {
  if (!clipSha256 || !/^[a-f0-9]{64}$/.test(clipSha256) || manifest?.schema_version !== "display-rendition-v1") return null;
  const entry = manifest.cameras?.[camera];
  const filename = `${camera}-${clipSha256}-v1.mp4`;
  return entry?.source_clip_sha256 === clipSha256 && entry.filename === filename ? `/vision-display-media/${filename}` : null;
}

// Raster annotations travel as authenticated private media, never box histories.
export function annotationMediaURL(camera: string, clipSha256: string | undefined, geometry: unknown, manifest: any): string | null {
  const url = `/api/v1/clips/${camera}/annotation/media`;
  if (!clipSha256 || !/^[a-f0-9]{64}$/.test(clipSha256) || manifest?.schema_version !== "display-annotation-v1"
      || manifest.status !== "available" || manifest.camera_id !== camera || manifest.source_clip_sha256 !== clipSha256
      || manifest.media_url !== url || !sameGeometry(geometry, manifest.geometry)
      || !Number.isFinite(manifest.duration_s) || manifest.duration_s <= 0
      || !Number.isFinite(manifest.sample_fps) || manifest.sample_fps <= 0) return null;
  return url;
}
