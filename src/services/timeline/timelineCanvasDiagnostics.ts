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

export interface TimelineCanvasStoreDiagnostics {
  trackIds: readonly string[];
  clipCount: number;
  clipCountByTrackId: Readonly<Record<string, number>>;
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

function createEmptyTotals() {
  return {
    trackCount: 0,
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
  };
}

function addTrackDiagnostics(
  totals: ReturnType<typeof createEmptyTotals>,
  track: TimelineCanvasTrackDiagnostics,
): void {
  totals.trackCount += 1;
  if (track.canvas) {
    totals.inputClipCount += track.canvas.inputClipCount;
    totals.visibleClipCount += track.canvas.visibleClipCount;
    totals.drawnClipCount += track.canvas.drawnClipCount;
    totals.thumbnailClipCount += track.canvas.thumbnailClipCount;
    totals.thumbnailDrawCount += track.canvas.thumbnailDrawCount;
    totals.waveformClipCount += track.canvas.waveformClipCount;
    if (track.canvas.workerMode) totals.workerTrackCount += 1;
  }
  if (track.dom) {
    totals.domOverlayCount += track.dom.domOverlayCount;
    totals.domClipBodyCount += track.dom.domClipBodyCount;
    totals.shellCount += track.dom.shellCount;
    totals.activeShellSlotCounts = mergeSlotCounts(totals.activeShellSlotCounts, track.dom.activeShellSlotCounts);
  }
}

export function getTimelineCanvasDiagnostics(store?: TimelineCanvasStoreDiagnostics): Record<string, unknown> {
  const now = nowMs();
  const reportedTracks = Array.from(tracks.values())
    .sort((a, b) => a.trackId.localeCompare(b.trackId));
  const activeTracks: Array<TimelineCanvasTrackDiagnostics & { ageMs: number; isStale: false }> = [];
  const staleTracks: Array<TimelineCanvasTrackDiagnostics & { ageMs: number; isStale: true }> = [];

  reportedTracks.forEach((track) => {
    const ageMs = Math.max(0, now - track.updatedAt);
    if (ageMs > STALE_TRACK_MS) {
      staleTracks.push({ ...track, ageMs, isStale: true });
    } else {
      activeTracks.push({ ...track, ageMs, isStale: false });
    }
  });

  const totals = createEmptyTotals();
  activeTracks.forEach((track) => addTrackDiagnostics(totals, track));
  const reportedTotals = createEmptyTotals();
  reportedTracks.forEach((track) => addTrackDiagnostics(reportedTotals, track));

  const reportedTrackIds = new Set(reportedTracks.map((track) => track.trackId));
  const missingTrackIds = store
    ? store.trackIds.filter((trackId) => !reportedTrackIds.has(trackId))
    : [];

  return {
    totals: {
      ...totals,
      staleTrackCount: staleTracks.length,
      reportedTrackCount: reportedTotals.trackCount,
      reportedInputClipCount: reportedTotals.inputClipCount,
      reportedDomClipBodyCount: reportedTotals.domClipBodyCount,
      reportedShellCount: reportedTotals.shellCount,
      storeTrackCount: store?.trackIds.length,
      storeInputClipCount: store?.clipCount,
      missingTrackIds,
      missingTrackCount: missingTrackIds.length,
      storeClipCountByTrackId: store?.clipCountByTrackId,
    },
    tracks: activeTracks,
    staleTracks,
  };
}

export function buildTimelineCanvasStoreDiagnostics(input: {
  tracks: readonly { id: string }[];
  clips: readonly { trackId: string }[];
}): TimelineCanvasStoreDiagnostics {
  const clipCountByTrackId: Record<string, number> = {};
  input.clips.forEach((clip) => {
    clipCountByTrackId[clip.trackId] = (clipCountByTrackId[clip.trackId] ?? 0) + 1;
  });

  return {
    trackIds: input.tracks.map((track) => track.id),
    clipCount: input.clips.length,
    clipCountByTrackId,
  };
}

export function clearTimelineCanvasDiagnostics(): void {
  tracks.clear();
}
