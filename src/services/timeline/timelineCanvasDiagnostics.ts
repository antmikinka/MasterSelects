import type { ClipInteractionShellModuleSlot } from '../../components/timeline/interactionShell';

export interface TimelineCanvasDrawDiagnostics {
  inputClipCount: number;
  visibleClipCount: number;
  drawnClipCount: number;
  thumbnailClipCount: number;
  thumbnailDrawCount: number;
  waveformClipCount: number;
  workerMode: boolean;
}

export interface TimelineCanvasDomDiagnostics {
  domOverlayCount: number;
  domClipBodyCount: number;
  shellCount: number;
  activeShellSlotCounts: Partial<Record<ClipInteractionShellModuleSlot, number>>;
}

export interface TimelineCanvasTrackDiagnostics {
  trackId: string;
  updatedAt: number;
  canvas?: TimelineCanvasDrawDiagnostics;
  dom?: TimelineCanvasDomDiagnostics;
}

const STALE_TRACK_MS = 30000;
const tracks = new Map<string, TimelineCanvasTrackDiagnostics>();

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function mergeSlotCounts(
  a: Partial<Record<ClipInteractionShellModuleSlot, number>> | undefined,
  b: Partial<Record<ClipInteractionShellModuleSlot, number>>,
): Partial<Record<ClipInteractionShellModuleSlot, number>> {
  return Object.fromEntries(
    Object.entries({ ...(a ?? {}) }).map(([slot, count]) => [slot, count])
      .concat(Object.entries(b).map(([slot, count]) => [slot, ((a ?? {})[slot as ClipInteractionShellModuleSlot] ?? 0) + count])),
  ) as Partial<Record<ClipInteractionShellModuleSlot, number>>;
}

export function reportTimelineCanvasDrawDiagnostics(
  trackId: string,
  canvas: TimelineCanvasDrawDiagnostics,
): void {
  const existing = tracks.get(trackId);
  tracks.set(trackId, {
    trackId,
    updatedAt: nowMs(),
    dom: existing?.dom,
    canvas,
  });
}

export function reportTimelineCanvasDomDiagnostics(
  trackId: string,
  dom: TimelineCanvasDomDiagnostics,
): void {
  const existing = tracks.get(trackId);
  tracks.set(trackId, {
    trackId,
    updatedAt: nowMs(),
    canvas: existing?.canvas,
    dom,
  });
}

export function getTimelineCanvasDiagnostics(): Record<string, unknown> {
  const now = nowMs();
  const activeTracks = Array.from(tracks.values())
    .filter((track) => now - track.updatedAt <= STALE_TRACK_MS)
    .sort((a, b) => a.trackId.localeCompare(b.trackId));

  const totals = activeTracks.reduce((acc, track) => {
    if (track.canvas) {
      acc.inputClipCount += track.canvas.inputClipCount;
      acc.visibleClipCount += track.canvas.visibleClipCount;
      acc.drawnClipCount += track.canvas.drawnClipCount;
      acc.thumbnailClipCount += track.canvas.thumbnailClipCount;
      acc.thumbnailDrawCount += track.canvas.thumbnailDrawCount;
      acc.waveformClipCount += track.canvas.waveformClipCount;
      if (track.canvas.workerMode) acc.workerTrackCount += 1;
    }
    if (track.dom) {
      acc.domOverlayCount += track.dom.domOverlayCount;
      acc.domClipBodyCount += track.dom.domClipBodyCount;
      acc.shellCount += track.dom.shellCount;
      acc.activeShellSlotCounts = mergeSlotCounts(acc.activeShellSlotCounts, track.dom.activeShellSlotCounts);
    }
    return acc;
  }, {
    trackCount: activeTracks.length,
    inputClipCount: 0,
    visibleClipCount: 0,
    drawnClipCount: 0,
    thumbnailClipCount: 0,
    thumbnailDrawCount: 0,
    waveformClipCount: 0,
    domOverlayCount: 0,
    domClipBodyCount: 0,
    shellCount: 0,
    workerTrackCount: 0,
    activeShellSlotCounts: {} as Partial<Record<ClipInteractionShellModuleSlot, number>>,
  });

  return {
    totals,
    tracks: activeTracks,
  };
}
