// Pure planning for applying an EDL to the timeline:
// derives sync-adjusted clip placements from edit decisions and camera offsets.

import type { EditDecision, MultiCamSource } from './types';

export interface EdlClipPlacement {
  cameraId: string;
  mediaFileId: string;
  // Seconds, sync-adjusted source in/out points
  inPoint: number;
  outPoint: number;
  // Seconds on the timeline
  startTime: number;
  duration: number;
}

export function planEdlClipPlacements(
  edl: readonly EditDecision[],
  cameras: readonly MultiCamSource[],
): EdlClipPlacement[] {
  const placements: EdlClipPlacement[] = [];

  for (const decision of edl) {
    const camera = cameras.find(c => c.id === decision.cameraId);
    if (!camera) continue;

    // Calculate in/out points considering sync offset
    const inPoint = (decision.start + camera.syncOffset) / 1000; // Convert to seconds
    const outPoint = (decision.end + camera.syncOffset) / 1000;
    const startTime = decision.start / 1000;

    placements.push({
      cameraId: camera.id,
      mediaFileId: camera.mediaFileId,
      inPoint,
      outPoint,
      startTime,
      duration: outPoint - inPoint,
    });
  }

  return placements;
}
