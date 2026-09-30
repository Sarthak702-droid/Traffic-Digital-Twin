import type { TrafficState } from '../../../packages/contracts/typescript/events';

export function observationQuery(
  camera: string,
  mode: string,
  frame: TrafficState | null,
  boundaryMapping: Record<string, string>,
  sourceSessions: Record<string, string>,
) {
  const query = new URLSearchParams({ camera_id: camera, mode });
  if (frame?.demand_source === 'video_profile' && boundaryMapping[camera]) {
    query.set('run_id', frame.run_id);
  } else if (sourceSessions[camera]) {
    query.set('source_session_id', sourceSessions[camera]);
  }
  return `/api/v1/observations?${query}`;
}
