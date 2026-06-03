import { describe, expect, it } from 'vitest';
import {
  resolveHorizontalRenderWindow,
  resolveStableWaveformRenderGeometry,
  resolveTimelineViewportWidth,
  resolveVisibleSourceWindow,
} from '../../src/components/timeline/utils/waveformRenderGeometry';

describe('waveform render geometry', () => {
  it('uses fallback and minimum viewport width for render scheduling', () => {
    expect(resolveTimelineViewportWidth({
      timelineViewportWidth: 0,
      fallbackPx: 1600,
      minPx: 1600,
    })).toBe(1600);

    expect(resolveTimelineViewportWidth({
      timelineViewportWidth: 800,
      fallbackPx: 1600,
      minPx: 1600,
    })).toBe(1600);

    expect(resolveTimelineViewportWidth({
      timelineViewportWidth: 2400,
      fallbackPx: 1600,
      minPx: 1600,
    })).toBe(2400);
  });

  it('clips horizontal render windows to the content width', () => {
    expect(resolveHorizontalRenderWindow({
      scrollX: 900,
      contentLeft: 400,
      contentWidth: 1200,
      viewportWidth: 600,
      overscanPx: 100,
    })).toEqual({ startPx: 400, width: 800 });

    expect(resolveHorizontalRenderWindow({
      scrollX: 50,
      contentLeft: 400,
      contentWidth: 1200,
      viewportWidth: 600,
      overscanPx: 100,
    })).toEqual({ startPx: 0, width: 350 });
  });

  it('maps a thumbnail render window back into source time', () => {
    expect(resolveVisibleSourceWindow({
      inPoint: 10,
      outPoint: 30,
      clipWidth: 1000,
      renderWindow: { startPx: 250, width: 500 },
    })).toEqual({ inPoint: 15, outPoint: 25 });
  });

  it('returns the base waveform window when stable trim rendering is inactive', () => {
    const baseRenderWindow = { startPx: 12, width: 140 };
    const geometry = resolveStableWaveformRenderGeometry({
      isAudioClip: true,
      isTrimming: true,
      isLinkedToTrimming: false,
      hasClipTrim: true,
      usesProcessedPyramid: true,
      clipWidth: 1000,
      clipLeft: 200,
      scrollX: 0,
      viewportWidth: 1600,
      overscanPx: 512,
      baseRenderWindow,
      waveformInPoint: 2,
      waveformOutPoint: 12,
      originalInPoint: 1,
      originalOutPoint: 13,
      displayDuration: 10,
    });

    expect(geometry.useStableTrimWindow).toBe(false);
    expect(geometry.renderWindow).toBe(baseRenderWindow);
    expect(geometry.contentInPoint).toBe(2);
    expect(geometry.contentOutPoint).toBe(12);
    expect(geometry.contentWidth).toBe(1000);
    expect(geometry.contentOffsetPx).toBe(0);
    expect(geometry.clipDuration).toBe(10);
  });

  it('expands waveform content around a trim so the visible waveform stays stable', () => {
    const geometry = resolveStableWaveformRenderGeometry({
      isAudioClip: true,
      isTrimming: true,
      isLinkedToTrimming: false,
      hasClipTrim: true,
      usesProcessedPyramid: false,
      clipWidth: 1000,
      clipLeft: 200,
      scrollX: 1024,
      viewportWidth: 1600,
      overscanPx: 512,
      baseRenderWindow: { startPx: 0, width: 1000 },
      waveformInPoint: 2,
      waveformOutPoint: 12,
      originalInPoint: 1,
      originalOutPoint: 14,
      displayDuration: 10,
    });

    expect(geometry.useStableTrimWindow).toBe(true);
    expect(geometry.contentInPoint).toBe(1);
    expect(geometry.contentOutPoint).toBe(14);
    expect(geometry.contentWidth).toBe(1300);
    expect(geometry.contentOffsetPx).toBe(-100);
    expect(geometry.renderWindow).toEqual({ startPx: 412, width: 888 });
    expect(geometry.clipDuration).toBe(13);
    expect(geometry.normalizationInPoint).toBe(1);
    expect(geometry.normalizationOutPoint).toBe(14);
    expect(geometry.normalizationWidth).toBe(1300);
  });
});
