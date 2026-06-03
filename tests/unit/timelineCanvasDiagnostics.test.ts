import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTimelineCanvasStoreDiagnostics,
  clearTimelineCanvasDiagnostics,
  getTimelineCanvasDiagnostics,
  reportTimelineCanvasDomDiagnostics,
  reportTimelineCanvasDrawDiagnostics,
} from '../../src/services/timeline/timelineCanvasDiagnostics';

describe('timeline canvas diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearTimelineCanvasDiagnostics();
  });

  it('keeps stale renderer diagnostics separate from canonical store totals', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);

    reportTimelineCanvasDrawDiagnostics('track-a', {
      inputClipCount: 120,
      visibleClipCount: 40,
      drawnClipCount: 35,
      thumbnailClipCount: 12,
      thumbnailDrawCount: 10,
      waveformClipCount: 4,
      workerMode: false,
    });
    reportTimelineCanvasDomDiagnostics('track-a', {
      domOverlayCount: 2,
      domClipBodyCount: 1,
      shellCount: 2,
      activeShellSlotCounts: { stem: 1 },
    });

    nowSpy.mockReturnValue(61_500);
    const diagnostics = getTimelineCanvasDiagnostics(buildTimelineCanvasStoreDiagnostics({
      tracks: [{ id: 'track-a' }, { id: 'track-b' }],
      clips: Array.from({ length: 1447 }, (_, index) => ({
        trackId: index < 720 ? 'track-a' : 'track-b',
      })),
    })) as {
      totals: {
        trackCount: number;
        staleTrackCount: number;
        reportedTrackCount: number;
        reportedInputClipCount: number;
        storeTrackCount: number;
        storeInputClipCount: number;
        missingTrackCount: number;
        missingTrackIds: string[];
        inputClipCount: number;
        domClipBodyCount: number;
        shellCount: number;
        activeShellSlotCounts: { stem?: number };
      };
      tracks: Array<{ trackId: string; isStale: boolean; ageMs: number }>;
      staleTracks: Array<{ trackId: string; isStale: boolean; ageMs: number }>;
    };

    expect(diagnostics.totals.trackCount).toBe(0);
    expect(diagnostics.totals.staleTrackCount).toBe(1);
    expect(diagnostics.totals.reportedTrackCount).toBe(1);
    expect(diagnostics.totals.reportedInputClipCount).toBe(120);
    expect(diagnostics.totals.storeTrackCount).toBe(2);
    expect(diagnostics.totals.storeInputClipCount).toBe(1447);
    expect(diagnostics.totals.missingTrackCount).toBe(1);
    expect(diagnostics.totals.missingTrackIds).toEqual(['track-b']);
    expect(diagnostics.totals.inputClipCount).toBe(0);
    expect(diagnostics.totals.domClipBodyCount).toBe(0);
    expect(diagnostics.totals.shellCount).toBe(0);
    expect(diagnostics.totals.activeShellSlotCounts.stem).toBeUndefined();
    expect(diagnostics.tracks).toEqual([]);
    expect(diagnostics.staleTracks[0]).toMatchObject({
      trackId: 'track-a',
      isStale: true,
      ageMs: 60500,
    });
  });
});
