import { describe, expect, it } from 'vitest';

import {
  clampTimelineRectToViewport,
  createTimelineRect,
  findTimelineRuntimeReferences,
  isPlainTimelineRenderData,
  isTimelineRect,
  timelineRectContainsPoint,
  timelineRectsIntersect,
  timelineTimeRangeToRect,
  type TimelineGeometrySnapshot,
  type TimelineRenderModel,
} from '../../src/components/timeline/renderModel';

const renderModel: TimelineRenderModel = {
  schemaVersion: 1,
  tracks: [
    {
      id: 'video-1',
      index: 0,
      name: 'Video 1',
      kind: 'video',
      color: '#4f86ff',
      locked: false,
      muted: false,
      hidden: false,
      expanded: true,
      dimmed: false,
      baseHeightPx: 76,
      heightPx: 76,
    },
  ],
  clips: [
    {
      id: 'clip-1',
      trackId: 'video-1',
      index: 0,
      startTime: 10,
      duration: 4,
      inPoint: 2,
      outPoint: 6,
      speed: 1,
      reversed: false,
      sourceKind: 'video',
      sourceId: 'source-1',
      mediaFileId: 'media-1',
      label: 'Interview A',
      palette: {
        fill: '#3b82f6',
        stroke: '#93c5fd',
        text: '#ffffff',
      },
      state: {
        selected: true,
        hovered: false,
        locked: false,
        muted: false,
        linked: true,
        inLinkedGroup: false,
        dimmed: false,
        disabled: false,
      },
      badges: {
        proxy: { status: 'ready' },
        audioProxy: { status: 'none' },
        download: { status: 'ready', progress: 1 },
        reversed: false,
        linked: { linkedClipId: 'clip-1-audio' },
        transcript: { status: 'ready', markerCount: 2 },
        analysis: { status: 'queued', markerCount: 0 },
        nestedComposition: {
          compositionId: 'comp-2',
          hasMixdown: true,
          boundaryCount: 3,
        },
      },
      cacheRefs: {
        thumbnails: {
          sourceId: 'source-1',
          mediaFileId: 'media-1',
          fileHash: 'hash-1',
          frameCount: 20,
          durationSeconds: 12,
        },
        waveform: {
          sourceRefId: 'waveform-source-1',
          processedRefId: 'waveform-processed-1',
          channelCount: 2,
          referencePeak: 0.87,
        },
        spectrogram: {
          sourceRefId: 'spectrogram-source-1',
          tileSetId: 'tiles-1',
          tileCount: 8,
        },
        loudness: { refId: 'loudness-1' },
        beatOnset: { refId: 'beat-onset-1' },
        frequencyPhase: { refId: 'frequency-phase-1' },
        analysisMarkers: { refId: 'analysis-markers-1' },
      },
      markers: [
        { id: 'word-1', time: 0.4, duration: 0.2, kind: 'transcript', label: 'The' },
        { id: 'beat-1', time: 1.1, kind: 'beat', confidence: 0.9 },
      ],
      fade: {
        fadeInDuration: 0.25,
        fadeOutDuration: 0.4,
        opacityKeyframeCount: 2,
      },
      keyframeCount: 4,
    },
  ],
  selectedClipIds: ['clip-1'],
  hoveredClipId: null,
  primarySelectedClipId: 'clip-1',
  generatedAtMs: 100,
};

const geometrySnapshot: TimelineGeometrySnapshot = {
  schemaVersion: 1,
  viewport: {
    scrollContainerRect: createTimelineRect(0, 0, 960, 320),
    visibleContentRect: createTimelineRect(240, 0, 960, 320),
    viewportRect: createTimelineRect(0, 0, 960, 320),
    scrollX: 240,
    scrollY: 0,
    pxPerSecond: 60,
    measuredAtMs: 100,
  },
  contentWidth: 4_000,
  tracks: [
    {
      trackId: 'video-1',
      index: 0,
      laneRect: createTimelineRect(0, 20, 4_000, 76),
      rowViewportRect: createTimelineRect(240, 20, 960, 76),
      clipRowRect: createTimelineRect(0, 22, 4_000, 72),
      keyframeAreaRect: createTimelineRect(0, 96, 4_000, 44),
    },
  ],
  clips: [
    {
      clipId: 'clip-1',
      trackId: 'video-1',
      bodyRect: createTimelineRect(600, 22, 240, 72),
      visibleBodyRect: createTimelineRect(600, 22, 240, 72),
      labelRect: createTimelineRect(608, 28, 120, 18),
      thumbnailStripRect: createTimelineRect(604, 46, 232, 28),
      waveformRect: createTimelineRect(604, 74, 232, 18),
      spectrogramRect: createTimelineRect(604, 74, 232, 18),
      badgeAnchorRects: {
        proxy: createTimelineRect(812, 28, 14, 14),
        linked: createTimelineRect(828, 28, 14, 14),
      },
      sourceExtensionGhosts: [
        {
          clipId: 'clip-1',
          edge: 'right',
          rect: createTimelineRect(840, 22, 120, 72),
          sourceStartTime: 6,
          sourceEndTime: 8,
        },
      ],
      trimPreview: {
        clipId: 'clip-1',
        edge: 'right',
        bodyRect: createTimelineRect(600, 22, 260, 72),
        trimGhostRect: createTimelineRect(840, 22, 20, 72),
        role: 'lead',
      },
      fadeCurve: {
        clipId: 'clip-1',
        edge: 'both',
        controlPoints: [
          { x: 600, y: 94 },
          { x: 615, y: 22 },
          { x: 820, y: 22 },
          { x: 840, y: 94 },
        ],
        boundingRect: createTimelineRect(600, 22, 240, 72),
      },
    },
  ],
  handles: [
    {
      id: 'trim-left-clip-1',
      clipId: 'clip-1',
      trackId: 'video-1',
      kind: 'trim-left',
      rect: createTimelineRect(596, 22, 8, 72),
      hitRect: createTimelineRect(592, 22, 16, 72),
      active: false,
    },
    {
      id: 'fade-right-clip-1',
      clipId: 'clip-1',
      trackId: 'video-1',
      kind: 'fade-right',
      rect: createTimelineRect(820, 26, 12, 12),
      hitRect: createTimelineRect(816, 22, 20, 20),
      active: true,
    },
  ],
  keyframeRows: [
    {
      id: 'kf-row-opacity',
      trackId: 'video-1',
      clipId: 'clip-1',
      property: 'opacity',
      rowRect: createTimelineRect(0, 96, 4_000, 22),
      diamonds: [
        {
          keyframeId: 'kf-1',
          clipId: 'clip-1',
          trackId: 'video-1',
          property: 'opacity',
          time: 10.5,
          rect: createTimelineRect(626, 101, 10, 10),
          selected: true,
        },
      ],
    },
  ],
  transitionJunctions: [
    {
      id: 'junction-1',
      trackId: 'video-1',
      time: 14,
      rect: createTimelineRect(836, 22, 8, 72),
      dropZoneRect: createTimelineRect(816, 22, 48, 72),
      beforeClipId: 'clip-1',
      afterClipId: 'clip-2',
    },
  ],
  marqueeExclusions: [
    {
      id: 'header-video-1',
      kind: 'timeline-header',
      rect: createTimelineRect(0, 20, 216, 76),
      trackId: 'video-1',
    },
  ],
  dropTargets: [
    {
      id: 'spectral-drop-clip-1',
      kind: 'spectral-region',
      rect: createTimelineRect(604, 74, 232, 18),
      trackId: 'video-1',
      clipId: 'clip-1',
      accepts: ['image/png', 'image/jpeg'],
    },
  ],
  ruler: {
    rect: createTimelineRect(0, 0, 4_000, 20),
    contentWidth: 4_000,
    timeOrigin: 0,
    pxPerSecond: 60,
  },
};

describe('timeline render model contracts', () => {
  it('keeps the render model structured-clone-safe plain data', () => {
    expect(findTimelineRuntimeReferences(renderModel)).toEqual([]);
    expect(isPlainTimelineRenderData(renderModel)).toBe(true);

    const cloned = structuredClone(renderModel);
    expect(cloned).toEqual(renderModel);
  });

  it('keeps the geometry snapshot structured-clone-safe plain data', () => {
    expect(findTimelineRuntimeReferences(geometrySnapshot)).toEqual([]);
    expect(isPlainTimelineRenderData(geometrySnapshot)).toBe(true);

    const cloned = structuredClone(geometrySnapshot);
    expect(cloned).toEqual(geometrySnapshot);
  });

  it('rejects runtime references and cache-warming callbacks', () => {
    const video = document.createElement('video');
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    const objectUrl = 'blob:http://localhost/source-1';
    const warmCache = () => undefined;

    const issues = findTimelineRuntimeReferences({
      source: {
        file,
        video,
        objectUrl,
        warmCache,
      },
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      'non-plain-object',
      'non-plain-object',
      'object-url',
      'function',
    ]);
    expect(issues.map((issue) => issue.path)).toEqual([
      '$.source.file',
      '$.source.video',
      '$.source.objectUrl',
      '$.source.warmCache',
    ]);
  });

  it('allows shared plain data while still detecting cycles', () => {
    const shared = { fill: '#111111' };
    const repeatedPlainData = {
      first: shared,
      second: shared,
    };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    expect(findTimelineRuntimeReferences(repeatedPlainData)).toEqual([]);
    expect(findTimelineRuntimeReferences(cycle)).toEqual([
      { path: '$.self', code: 'cycle', valueTag: '[object Object]' },
    ]);
  });

  it('covers the required geometry lanes for overlays and hit testing', () => {
    expect(geometrySnapshot.tracks[0].laneRect).toEqual(createTimelineRect(0, 20, 4_000, 76));
    expect(geometrySnapshot.tracks[0].rowViewportRect).toEqual(createTimelineRect(240, 20, 960, 76));
    expect(geometrySnapshot.clips[0].bodyRect).toEqual(createTimelineRect(600, 22, 240, 72));
    expect(geometrySnapshot.clips[0].sourceExtensionGhosts[0].edge).toBe('right');
    expect(geometrySnapshot.handles.map((handle) => handle.kind)).toEqual(['trim-left', 'fade-right']);
    expect(geometrySnapshot.keyframeRows[0].diamonds[0].rect).toEqual(createTimelineRect(626, 101, 10, 10));
    expect(geometrySnapshot.transitionJunctions[0].dropZoneRect).toEqual(createTimelineRect(816, 22, 48, 72));
    expect(geometrySnapshot.marqueeExclusions[0].kind).toBe('timeline-header');
    expect(geometrySnapshot.dropTargets[0].kind).toBe('spectral-region');
  });

  it('provides pure rect helpers for future geometry resolvers', () => {
    const trackRect = createTimelineRect(0, 20, 4_000, 76);
    const clipRect = timelineTimeRangeToRect({ startTime: 10, duration: 4 }, trackRect, 60);
    const viewport = createTimelineRect(650, 0, 100, 200);

    expect(isTimelineRect(clipRect)).toBe(true);
    expect(clipRect).toEqual(createTimelineRect(600, 20, 240, 76));
    expect(timelineRectContainsPoint(clipRect, { x: 620, y: 40 })).toBe(true);
    expect(timelineRectsIntersect(clipRect, viewport)).toBe(true);
    expect(clampTimelineRectToViewport(clipRect, viewport)).toEqual(createTimelineRect(650, 20, 100, 76));
  });
});
