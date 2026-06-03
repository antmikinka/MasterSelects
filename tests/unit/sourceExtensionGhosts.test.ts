import { describe, expect, it } from 'vitest';
import { resolveSourceExtensionGhosts } from '../../src/components/timeline/utils/sourceExtensionGhosts';

const pixelsPerSecond = 100;
const timeToPixel = (time: number) => time * pixelsPerSecond;

const baseInput = {
  enabled: true,
  isTrimming: true,
  isLinkedToTrimming: false,
  clipWidth: 500,
  clipLeft: 0,
  clipStartTime: 10,
  clipDuration: 5,
  displayStartTime: 10,
  displayDuration: 5,
  displayInPoint: 0,
  displayOutPoint: 5,
  sourceDuration: 10,
  scrollX: 0,
  viewportWidth: 1600,
  overscanPx: 512,
  timeToPixel,
};

describe('source extension ghosts', () => {
  it('returns no ghosts when disabled or not trimming', () => {
    expect(resolveSourceExtensionGhosts({
      ...baseInput,
      enabled: false,
      trimEdge: 'left',
    })).toEqual([]);

    expect(resolveSourceExtensionGhosts({
      ...baseInput,
      isTrimming: false,
      trimEdge: 'left',
    })).toEqual([]);
  });

  it('draws a left source extension ghost from available source before the clip', () => {
    expect(resolveSourceExtensionGhosts({
      ...baseInput,
      trimEdge: 'left',
      displayInPoint: 3,
    })).toEqual([
      { edge: 'left', left: -300, width: 300 },
    ]);
  });

  it('draws a right source extension ghost from remaining source after the clip', () => {
    expect(resolveSourceExtensionGhosts({
      ...baseInput,
      trimEdge: 'right',
      displayOutPoint: 5,
      sourceDuration: 8,
    })).toEqual([
      { edge: 'right', left: 500, width: 300 },
    ]);
  });

  it('falls back to original clip bounds when source extension is unavailable', () => {
    expect(resolveSourceExtensionGhosts({
      ...baseInput,
      trimEdge: 'left',
      clipStartTime: 10,
      displayStartTime: 8,
      displayInPoint: 0,
    })).toEqual([
      { edge: 'left', left: 0, width: 200 },
    ]);
  });
});
