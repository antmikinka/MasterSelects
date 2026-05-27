import { describe, expect, it } from 'vitest';
import { createCompositionHistorySignature } from '../../src/hooks/useGlobalHistory';
import type { Composition } from '../../src/stores/mediaStore/types';

function composition(overrides: Partial<Composition> = {}): Composition {
  return {
    id: overrides.id ?? 'comp-1',
    name: overrides.name ?? 'Main',
    type: 'composition',
    parentId: overrides.parentId ?? null,
    createdAt: overrides.createdAt ?? 1,
    width: overrides.width ?? 1920,
    height: overrides.height ?? 1080,
    frameRate: overrides.frameRate ?? 30,
    duration: overrides.duration ?? 60,
    backgroundColor: overrides.backgroundColor ?? '#000000',
    timelineData: overrides.timelineData ?? {
      tracks: [],
      clips: [],
      playheadPosition: 0,
      duration: 60,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    },
  };
}

describe('createCompositionHistorySignature', () => {
  it('ignores active composition timelineData mirror changes', () => {
    const before = composition();
    const after = composition({
      timelineData: {
        ...before.timelineData!,
        clips: [
          {
            id: 'clip-1',
            trackId: 'video-1',
            name: 'Clip',
            mediaFileId: 'media-1',
            startTime: 0,
            duration: 5,
            inPoint: 0,
            outPoint: 5,
            sourceType: 'video',
            transform: {
              position: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1 },
              rotation: { x: 0, y: 0, z: 0 },
              opacity: 1,
              blendMode: 'normal',
            },
            effects: [],
          },
        ],
      },
    });

    expect(createCompositionHistorySignature([after], 'comp-1'))
      .toBe(createCompositionHistorySignature([before], 'comp-1'));
  });

  it('ignores inactive composition view-state changes', () => {
    const before = composition({ id: 'nested-comp' });
    const after = composition({
      id: 'nested-comp',
      timelineData: {
        ...before.timelineData!,
        playheadPosition: 12.5,
        zoom: 180,
        scrollX: 420,
      },
    });

    expect(createCompositionHistorySignature([after], 'main-comp'))
      .toBe(createCompositionHistorySignature([before], 'main-comp'));
  });

  it('tracks inactive composition content changes', () => {
    const before = composition({ id: 'nested-comp' });
    const after = composition({
      id: 'nested-comp',
      timelineData: {
        ...before.timelineData!,
        tracks: [
          { id: 'video-1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false },
        ],
      },
    });

    expect(createCompositionHistorySignature([after], 'main-comp'))
      .not.toBe(createCompositionHistorySignature([before], 'main-comp'));
  });

  it('tracks active composition settings changes', () => {
    const before = composition();
    const after = composition({ width: 1280 });

    expect(createCompositionHistorySignature([after], 'comp-1'))
      .not.toBe(createCompositionHistorySignature([before], 'comp-1'));
  });
});
