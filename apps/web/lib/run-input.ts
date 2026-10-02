export interface ProcessedClip {
  camera_id: string;
  source_session_id: string;
  status: string;
  config_hash: string;
  window_count?: number;
  latest_completed_window_end_source_s?: number;
}
export function videoInputReady(mapping: Record<string,string>, clips: ProcessedClip[], sessions: Record<string,string>, expectedConfigHash?: string): boolean {
  const cameras=Object.keys(mapping);
  if(!cameras.length) return false;
  const selected=cameras.map(camera=>clips.find(clip=>clip.camera_id===camera && clip.source_session_id===sessions[camera] && clip.status==='cached_valid' && (!expectedConfigHash || clip.config_hash===expectedConfigHash)));
  return selected.every(clip=>!!clip && !!clip.config_hash) && new Set(selected.map(clip=>clip?.config_hash)).size===1;
}
export function buildScenarioInput(source:'seeded'|'video_profile', sessions:Record<string,string>, mapping:Record<string,string>) {
  return {demand_source:source,...(source==='video_profile'?{source_sessions:Object.fromEntries(Object.keys(mapping).map(camera=>[camera,sessions[camera]??'']))}:{})};
}
