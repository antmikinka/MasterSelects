// TimelineClipCanvas - issue #228 canvas clip renderer.
//
// Draws a track's visible clip bodies onto a viewport-sized <canvas> instead of
// mounting one heavy DOM component per clip. This makes large comps render in
// O(visible clips) draw calls with a Level-of-Detail scheme.

import { memo, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { TimelineAudioDisplayMode, TimelineClipDragPreview } from '../../stores/timeline/types';
import { useMediaStore } from '../../stores/mediaStore';
import {
  MIN_CLIP_DURATION,
  TIMELINE_CLIP_CANVAS_LOD_BAR_PX,
  TIMELINE_CLIP_CANVAS_LOD_LABEL_PX,
} from './timelineRenderConstants';
import type { ClipDragState, ClipTrimState } from './types';
import type { TimelinePaintSourceClip } from '../../timeline';
import { useTimelineClipCanvasAudioWarmups } from './hooks/useTimelineClipCanvasAudioWarmups';
import { useTimelineClipCanvasMainThreadDraw } from './hooks/useTimelineClipCanvasMainThreadDraw';
import { useTimelineClipCanvasThumbnailWarmups } from './hooks/useTimelineClipCanvasThumbnailWarmups';
import { useTimelineClipCanvasWorkerRuntime } from './hooks/useTimelineClipCanvasWorkerRuntime';
import type { TimelineClipCanvasSpectrogramTileSetMap } from './utils/timelineClipCanvasSpectrogramResource';
import {
  canLoopExtendTimelineVectorClip,
  getTimelineClipSourceDuration,
  isInfiniteTimelineSourceType,
} from './utils/clipSourceTiming';
import type { TimelineClipCanvasWaveformPyramidMap } from './utils/timelineClipCanvasWaveformResource';
import {
  hasTimelineClipCanvasPassiveDecorations,
  type TimelineClipCanvasMediaStatus,
} from './utils/timelineClipCanvasPassiveDecorations';
import type { TimelineClipCanvasTrimGeometry } from './utils/timelineClipCanvasTrimResource';
import {
  collectTimelineClipCanvasWorkerThumbnailPreparation,
} from './utils/timelineClipCanvasThumbnailPreparation';
import {
  collectTimelineClipCanvasVisibleAudioArtifactClipIds,
} from './utils/timelineClipCanvasVisibleArtifactCollection';
import {
  createTimelineClipCanvasWorkerPreparedResourcesByClipId,
} from './utils/timelineClipCanvasPreparedResources';
import {
  createTimelineClipCanvasWorkerPaintClipInput,
  getTimelineClipCanvasWorkerEligibility,
} from './utils/timelineClipCanvasWorkerModel';

export const MAX_CANVAS_WIDTH_PX = 16000;

// The clip canvas paints a sliding window that follows the scroll position, so
// its backing store only ever needs to span the visible viewport plus overscan.
// Browsers (notably Chrome on Linux/Mesa) silently render a canvas blank once
// its backing store exceeds the GPU's max compositable size, so the backing
// width is capped well below the typical 16384 hardware limit. Sizing the
// canvas to the full timeline content width instead blanks the whole lane at
// high zoom; this keeps it bounded at every zoom level.
// See docs/Features/Linux-Mesa-GPU.md (rules 1-2) and issue #259.
const SAFE_MAX_CANVAS_BACKING_PX = 8192;
// Used before the live viewport width has been measured, to avoid a one-frame
// oversized backing store on first paint.
const SAFE_VIEWPORT_FALLBACK_PX = 4096;

const LOD_BAR_PX = TIMELINE_CLIP_CANVAS_LOD_BAR_PX;
const LOD_LABEL_PX = TIMELINE_CLIP_CANVAS_LOD_LABEL_PX;
const LOD_THUMB_PX = LOD_BAR_PX;
const CANVAS_THUMB_SLOT_PX = 71;
const MAX_THUMB_SLOTS = 48;

const THUMBNAIL_VIEWPORT_OVERSCAN_PX = 600;
const CANVAS_RENDER_OVERSCAN_PX = 1200;

interface TimelineClipCanvasProps {
  clips: readonly TimelinePaintSourceClip[];
  trackId: string;
  height: number;
  contentWidth: number;
  timeToPixel: (time: number) => number;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId?: string | null;
  trackColor: string;
  scrollX: number;
  viewportWidth: number;
  waveformsEnabled?: boolean;
  audioDisplayMode?: TimelineAudioDisplayMode;
  clipDrag?: ClipDragState | null;
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
  waveformPyramids?: TimelineClipCanvasWaveformPyramidMap;
  spectrogramTileSets?: TimelineClipCanvasSpectrogramTileSetMap;
}

type MediaFileCanvasStatusMap = ReadonlyMap<string, TimelineClipCanvasMediaStatus>;

function resolveClipGeometry(
  clip: TimelinePaintSourceClip,
  props: Pick<TimelineClipCanvasProps, 'clipDrag' | 'clipDragPreview' | 'clipTrim' | 'trackId'>,
): TimelineClipCanvasTrimGeometry {
  const { clipDrag, clipDragPreview, clipTrim, trackId } = props;
  let startTime = clip.startTime;
  let duration = clip.duration;
  let inPoint = clip.inPoint ?? 0;
  let outPoint = clip.outPoint ?? inPoint + duration;
  let visible = clip.trackId === trackId;
  let trimEdge: 'left' | 'right' | undefined;
  const sourceDuration = getTimelineClipSourceDuration(clip);
  const dragPreviewPatch = clipDragPreview?.patches[clip.id];
  const isPrimaryDragClip = clipDrag?.clipId === clip.id;
  const isLinkedSlipClip = Boolean(
    clipDrag?.toolGesture === 'slip' &&
      !clipDrag.altKeyPressed &&
      clip.linkedClipId === clipDrag.clipId,
  );

  if (isPrimaryDragClip) {
    visible = clipDrag.currentTrackId === trackId;
    const previewStartTime = dragPreviewPatch ? Math.max(0, dragPreviewPatch.startTime) : startTime;
    startTime = clipDrag.snappedTime !== null ? clipDrag.snappedTime : previewStartTime;
  } else if (clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined) {
    startTime = Math.max(0, clip.startTime + clipDrag.multiSelectTimeDelta);
  } else if (dragPreviewPatch) {
    startTime = Math.max(0, dragPreviewPatch.startTime);
    visible = (dragPreviewPatch.trackId ?? clip.trackId) === trackId;
  }

  if (
    clipDrag?.toolGesture === 'slip' &&
    (isPrimaryDragClip || isLinkedSlipClip) &&
    typeof clipDrag.sourceTimeDelta === 'number'
  ) {
    const visibleSourceDuration = Math.max(0.001, outPoint - inPoint);
    const maxInPoint = Math.max(0, sourceDuration - visibleSourceDuration);
    const nextInPoint = Math.max(0, Math.min(maxInPoint, inPoint + clipDrag.sourceTimeDelta));
    inPoint = nextInPoint;
    outPoint = nextInPoint + visibleSourceDuration;
  }

  if (clipTrim?.clipId === clip.id) {
    trimEdge = clipTrim.edge;
    const deltaTime = clipTrim.appliedDelta;
    const sourceType = clip.source?.type;
    const isInfiniteClip = isInfiniteTimelineSourceType(sourceType);
    if (clipTrim.edge === 'left') {
      const maxTrim = clipTrim.originalDuration - MIN_CLIP_DURATION;
      const minTrim = isInfiniteClip
        ? -clipTrim.originalStartTime
        : -clipTrim.originalInPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      startTime = clipTrim.originalStartTime + clampedDelta;
      duration = clipTrim.originalDuration - clampedDelta;
      inPoint = clipTrim.originalInPoint + clampedDelta;
      outPoint = clipTrim.originalOutPoint;
    } else {
      const maxExtend = isInfiniteClip || canLoopExtendTimelineVectorClip(clip)
        ? Number.MAX_SAFE_INTEGER
        : sourceDuration - clipTrim.originalOutPoint;
      const minTrim = -(clipTrim.originalDuration - MIN_CLIP_DURATION);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      startTime = clipTrim.originalStartTime;
      duration = clipTrim.originalDuration + clampedDelta;
      inPoint = clipTrim.originalInPoint;
      outPoint = clipTrim.originalOutPoint + clampedDelta;
    }
  }

  return {
    startTime,
    duration: Math.max(0.001, duration),
    inPoint,
    outPoint,
    visible,
    trimEdge,
    originalStartTime: clip.startTime,
    originalEndTime: clip.startTime + clip.duration,
    sourceDuration,
  };
}

function createWorkerDrawableClips(
  clips: readonly TimelinePaintSourceClip[],
  props: Pick<TimelineClipCanvasProps, 'clipDrag' | 'clipDragPreview' | 'clipTrim' | 'trackId'>,
): readonly TimelinePaintSourceClip[] {
  const drawableClips: TimelinePaintSourceClip[] = [];
  for (const clip of clips) {
    const geometry = resolveClipGeometry(clip, props);
    if (!geometry.visible) continue;
    drawableClips.push({
      ...clip,
      startTime: geometry.startTime,
      duration: geometry.duration,
      inPoint: geometry.inPoint,
      outPoint: geometry.outPoint,
    });
  }
  return drawableClips;
}

function getCanvasClipMediaFileId(clip: TimelinePaintSourceClip): string | null {
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

function getMediaFileCanvasStatus(
  clip: TimelinePaintSourceClip,
  mediaFileStatusById: MediaFileCanvasStatusMap,
): TimelineClipCanvasMediaStatus | undefined {
  const mediaFileId = getCanvasClipMediaFileId(clip);
  return mediaFileId ? mediaFileStatusById.get(mediaFileId) : undefined;
}

function TimelineClipCanvasComponent(props: TimelineClipCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [redrawNonce, bumpRedraw] = useReducer((n: number) => n + 1, 0);
  const {
    clips,
    trackId,
    height,
    timeToPixel,
    selectedClipIds,
    hoveredClipId,
    trackColor,
    scrollX,
    viewportWidth,
    waveformsEnabled,
    audioDisplayMode,
    clipDrag,
    clipDragPreview,
    clipTrim,
  } = props;
  const geometryProps = useMemo(() => ({
    trackId,
    clipDrag,
    clipDragPreview,
    clipTrim,
  }), [clipDrag, clipDragPreview, clipTrim, trackId]);
  // Measure the visible timeline viewport so the canvas backing stays bounded
  // regardless of zoom. The `viewportWidth` prop is the clip row width, which
  // equals the full timeline content width on wide/zoomed timelines — sizing the
  // canvas to that overflows the GPU's max canvas size and blanks the lane on
  // Linux/Mesa. The sliding window (`canvasOffsetX`) already follows the scroll
  // position, so the canvas only needs to span the visible viewport + overscan.
  const [measuredViewportWidth, setMeasuredViewportWidth] = useState(0);
  useLayoutEffect(() => {
    const viewport = canvasRef.current?.closest('.timeline-section-viewport');
    if (!viewport) return;
    const update = () => {
      setMeasuredViewportWidth((previous) => (
        previous === viewport.clientWidth ? previous : viewport.clientWidth
      ));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const scrollBucket = Math.round(scrollX / 200);
  const canvasOffsetX = Math.max(0, scrollBucket * 200 - CANVAS_RENDER_OVERSCAN_PX);
  const devicePixelRatio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const windowViewportWidth = Math.min(
    viewportWidth,
    measuredViewportWidth > 0 ? measuredViewportWidth : SAFE_VIEWPORT_FALLBACK_PX,
  );
  const cssWidth = Math.max(
    1,
    Math.min(
      MAX_CANVAS_WIDTH_PX,
      Math.floor(SAFE_MAX_CANVAS_BACKING_PX / devicePixelRatio),
      Math.ceil(windowViewportWidth + CANVAS_RENDER_OVERSCAN_PX * 2),
    ),
  );
  const visibleAudioArtifactClipIds = useMemo(
    () => collectTimelineClipCanvasVisibleAudioArtifactClipIds({
      clips,
      scrollX,
      viewportWidth,
      timeToPixel,
      resolveGeometry: (clip) => resolveClipGeometry(clip, geometryProps),
      thumbnailViewportOverscanPx: THUMBNAIL_VIEWPORT_OVERSCAN_PX,
    }),
    [clips, geometryProps, scrollX, timeToPixel, viewportWidth],
  );
  const { waveformPyramids, spectrogramTileSets } = useTimelineClipCanvasAudioWarmups({
    clips,
    scrollX,
    viewportWidth,
    cssWidth,
    timeToPixel,
    waveformsEnabled,
    audioDisplayMode,
    isInteractionPreviewActive: Boolean(clipDrag || clipDragPreview),
    renderOverscanPx: CANVAS_RENDER_OVERSCAN_PX,
    visibleAudioArtifactClipIds,
    requestRedraw: bumpRedraw,
  });

  const mediaFilesState = useMediaStore((state) => state.files);
  const mediaFiles = useMemo(
    () => (Array.isArray(mediaFilesState) ? mediaFilesState : []),
    [mediaFilesState],
  );
  const mediaFileStatusById = useMemo(() => {
    const map = new Map<string, TimelineClipCanvasMediaStatus>();
    for (const file of mediaFiles) {
      map.set(file.id, {
        proxyStatus: file.proxyStatus,
        proxyProgress: file.proxyProgress,
        audioProxyStatus: file.audioProxyStatus,
        audioProxyProgress: file.audioProxyProgress,
        hasProxyAudio: file.hasProxyAudio,
      });
    }
    return map;
  }, [mediaFiles]);
  const workerThumbnailPreparation = useMemo(
    () => {
      void redrawNonce;
      return collectTimelineClipCanvasWorkerThumbnailPreparation({
        clips,
        height,
        cssWidth,
        canvasOffsetX,
        scrollX,
        viewportWidth,
        timeToPixel,
        resolveGeometry: (clip) => resolveClipGeometry(clip, geometryProps),
        renderOverscanPx: CANVAS_RENDER_OVERSCAN_PX,
        thumbnailViewportOverscanPx: THUMBNAIL_VIEWPORT_OVERSCAN_PX,
        minThumbnailWidth: LOD_THUMB_PX,
        thumbnailSlotPx: CANVAS_THUMB_SLOT_PX,
        maxThumbnailSlots: MAX_THUMB_SLOTS,
      });
    },
    [canvasOffsetX, clips, cssWidth, geometryProps, height, redrawNonce, scrollX, timeToPixel, viewportWidth],
  );
  useTimelineClipCanvasThumbnailWarmups({
    clips,
    mediaFiles,
    scrollX,
    viewportWidth,
    timeToPixel,
    resolveGeometry: (clip) => resolveClipGeometry(clip, geometryProps),
    thumbnailViewportOverscanPx: THUMBNAIL_VIEWPORT_OVERSCAN_PX,
    missingBitmapRefs: workerThumbnailPreparation.missingBitmapRefs,
    requestRedraw: bumpRedraw,
  });
  const workerPreparedResourcesByClipId = useMemo(
    () => createTimelineClipCanvasWorkerPreparedResourcesByClipId({
      clips,
      waveformPyramids,
      spectrogramTileSets,
      waveformsEnabled,
      audioDisplayMode,
      height,
      cssWidth,
      canvasOffsetX,
      scrollX,
      viewportWidth,
      timeToPixel,
      activeTrimClipId: clipTrim?.clipId ?? null,
      renderOverscanPx: CANVAS_RENDER_OVERSCAN_PX,
      minThumbnailWidth: LOD_THUMB_PX,
      thumbnailSlotPx: CANVAS_THUMB_SLOT_PX,
      maxThumbnailSlots: MAX_THUMB_SLOTS,
      resolveGeometry: (clip) => resolveClipGeometry(clip as TimelinePaintSourceClip, geometryProps),
      getMediaStatus: (clip) => getMediaFileCanvasStatus(clip as TimelinePaintSourceClip, mediaFileStatusById),
    }),
    [audioDisplayMode, canvasOffsetX, clipTrim, clips, cssWidth, geometryProps, height, mediaFileStatusById, scrollX, spectrogramTileSets, timeToPixel, viewportWidth, waveformPyramids, waveformsEnabled],
  );
  const workerDrawableClips = useMemo(
    () => createWorkerDrawableClips(clips, geometryProps),
    [clips, geometryProps],
  );
  const workerPaintClips = useMemo(
    () => workerDrawableClips.map(createTimelineClipCanvasWorkerPaintClipInput),
    [workerDrawableClips],
  );
  const passiveDecorationClipIds = useMemo(() => {
    const ids = new Set<string>();
    workerDrawableClips.forEach((clip) => {
      if (hasTimelineClipCanvasPassiveDecorations(clip, getMediaFileCanvasStatus(clip, mediaFileStatusById))) {
        ids.add(clip.id);
      }
    });
    return ids;
  }, [mediaFileStatusById, workerDrawableClips]);
  const hasPassiveDecorations = passiveDecorationClipIds.size > 0;
  const workerEligibility = useMemo(() => getTimelineClipCanvasWorkerEligibility({
    clips: workerPaintClips,
    waveformsEnabled,
    audioDisplayMode,
    preparedResourcesByClipId: workerPreparedResourcesByClipId,
    preparedThumbnailClipIds: workerThumbnailPreparation.handledClipIds,
    passiveDecorationClipIds,
    hasPassiveDecorations,
    hasClipTrim: Boolean(clipTrim),
    activeTrimClipId: clipTrim?.clipId ?? null,
  }), [audioDisplayMode, clipTrim, hasPassiveDecorations, passiveDecorationClipIds, waveformsEnabled, workerPaintClips, workerPreparedResourcesByClipId, workerThumbnailPreparation.handledClipIds]);
  const {
    workerMode,
    workerCanvasGeneration,
    workerRuntimeFallbackReason,
    markMainThreadCanvasContextInitialized,
  } = useTimelineClipCanvasWorkerRuntime({
    canvasRef,
    trackId,
    height,
    cssWidth,
    canvasOffsetX,
    timeToPixel,
    selectedClipIds,
    hoveredClipId,
    trackColor,
    waveformsEnabled,
    audioDisplayMode,
    workerEligibility,
    workerPaintClips,
    workerPreparedResourcesByClipId,
    workerThumbnailPreparation,
    passiveDecorationClipIds,
    hasPassiveDecorations,
    hasClipTrim: Boolean(clipTrim),
    activeTrimClipId: clipTrim?.clipId ?? null,
  });

  useTimelineClipCanvasMainThreadDraw({
    canvasRef,
    workerMode,
    workerCanvasGeneration,
    workerRuntimeFallbackReason,
    workerEligibility,
    markMainThreadCanvasContextInitialized,
    clips,
    trackId,
    height,
    cssWidth,
    canvasOffsetX,
    timeToPixel,
    selectedClipIds,
    hoveredClipId,
    trackColor,
    scrollX,
    scrollBucket,
    viewportWidth,
    waveformsEnabled,
    audioDisplayMode,
    clipDrag,
    clipDragPreview,
    clipTrim,
    waveformPyramids,
    spectrogramTileSets,
    mediaFileStatusById,
    redrawNonce,
    resolveGeometry: (clip) => resolveClipGeometry(clip, geometryProps),
    getMediaStatus: (clip) => getMediaFileCanvasStatus(clip, mediaFileStatusById),
    requestRedraw: bumpRedraw,
    renderOverscanPx: CANVAS_RENDER_OVERSCAN_PX,
    thumbnailViewportOverscanPx: THUMBNAIL_VIEWPORT_OVERSCAN_PX,
    lodBarPx: LOD_BAR_PX,
    lodLabelPx: LOD_LABEL_PX,
    lodThumbnailPx: LOD_THUMB_PX,
    maxThumbnailSlots: MAX_THUMB_SLOTS,
    thumbnailSlotPx: CANVAS_THUMB_SLOT_PX,
  });

  return (
    <canvas
      key={`${trackId}:${workerCanvasGeneration}`}
      ref={canvasRef}
      className="timeline-clip-canvas"
      style={{ position: 'absolute', left: canvasOffsetX, top: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    />
  );
}

export const TimelineClipCanvas = memo(TimelineClipCanvasComponent);
