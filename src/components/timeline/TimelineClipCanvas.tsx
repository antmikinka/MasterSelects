// TimelineClipCanvas — issue #228 canvas clip renderer.
//
// Draws a track's visible clip bodies onto a viewport-sized <canvas> instead of
// mounting one heavy DOM component per clip. This makes large comps render in
// O(visible clips) draw calls with a Level-of-Detail scheme, instead of paying
// React reconciliation + browser layout/paint for hundreds of DOM nodes.
//
// Coordinate space: the canvas is absolutely positioned inside `.track-clip-row`
// at a finite absolute timeline X (`canvasOffsetX`). Draw code subtracts that
// offset from `timeToPixel(...)`, so high zoom never requires a giant backing
// store and never needs to switch back to visible legacy DOM clips. Interaction
// handles still use invisible DOM shells for the active/hovered clip.

import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { thumbnailCacheService } from '../../services/thumbnailCacheService';
import { reportTimelineCanvasDrawDiagnostics, type TimelineCanvasDrawDiagnostics } from '../../services/timeline/timelineCanvasDiagnostics';
import {
  collectVisibleTimelineThumbnailRefs,
  scheduleVisibleTimelineThumbnailDbWarmup,
  type VisibleTimelineThumbnailRef,
} from '../../services/timeline/timelineThumbnailDbWarmup';
import { scheduleVisibleTimelineThumbnailGeneration } from '../../services/timeline/timelineThumbnailGenerationWarmup';
import {
  collectTimelineWaveformArtifactRefs,
  getCachedTimelineWaveformArtifact,
  warmTimelineWaveformArtifacts,
} from '../../services/timeline/timelineWaveformArtifactWarmup';
import {
  collectVisibleTimelineSourceWaveformGenerationRequests,
  scheduleVisibleTimelineSourceWaveformGeneration,
} from '../../services/timeline/timelineSourceWaveformWarmup';
import { getThumbnailBitmap, ensureThumbnailBitmap } from '../../services/timeline/thumbnailBitmapCache';
import { flags } from '../../engine/featureFlags';
import type { TimelineAudioDisplayMode, TimelineClipDragPreview } from '../../stores/timeline/types';
import { useMediaStore } from '../../stores/mediaStore';
import { MIN_CLIP_DURATION } from './timelineRenderConstants';
import {
  buildWaveformLod,
  normalizeWaveformColumnsForDisplay,
  resolveWaveformDisplayReferencePeak,
  smoothWaveformColumns,
  type TimelineWaveformPyramid,
  type WaveformColumn,
} from './utils/waveformLod';
import type { ClipDragState, ClipTrimState } from './types';
import type { ClipAudioState } from '../../types/audio';
import {
  type VectorAnimationClipSettings,
} from '../../types/vectorAnimation';
import {
  getPreferredWaveformPyramidRef,
  hasLegacyWaveformSamples,
} from '../../utils/audioWaveformPresence';
import {
  canLoopExtendTimelineVectorClip,
  getTimelineClipSourceDuration,
  isInfiniteTimelineSourceType,
} from './utils/clipSourceTiming';
import { buildFadeCurvePath, type FadeCurveKeyframe } from './utils/fadeCurvePath';

// Browser 2D canvas backing-store limit is ~16384px in Chrome; stay safely under.
export const MAX_CANVAS_WIDTH_PX = 16000;

// Level-of-Detail thresholds, in CSS px of clip width.
const LOD_BAR_PX = 4;        // below this: nothing meaningful, draw a thin bar
const LOD_LABEL_PX = 14;     // above this: room for a (truncated) label
const LOD_THUMB_PX = LOD_BAR_PX; // above this: draw at least one poster thumbnail
const CANVAS_THUMB_SLOT_PX = 71; // target width of one filmstrip frame (matches DOM THUMB_WIDTH)
const MAX_THUMB_SLOTS = 48;  // hard cap per clip
const WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM = 250;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH = 16_384;
const WAVEFORM_GENERATION_DELAY_MS = 300;
const MAX_RENDERED_WAVEFORM_CHANNELS = 2;

export interface CanvasFadeVisuals {
  keyframes: readonly FadeCurveKeyframe[];
  clipDuration: number;
  isAudioClip: boolean;
}

export interface CanvasClip {
  id: string;
  trackId: string;
  startTime: number;
  duration: number;
  name: string;
  inPoint?: number;
  outPoint?: number;
  reversed?: boolean;
  mediaFileId?: string;
  waveform?: number[];
  waveformChannels?: number[][];
  waveformGenerating?: boolean;
  waveformProgress?: number;
  file?: File;
  audioState?: ClipAudioState;
  fade?: CanvasFadeVisuals;
  source?: {
    type?: string | null;
    mediaFileId?: string;
    naturalDuration?: number;
    vectorAnimationSettings?: VectorAnimationClipSettings;
  } | null;
}

interface TimelineClipCanvasProps {
  clips: readonly CanvasClip[];
  trackId: string;
  /** Row height in CSS px (the clip body area). */
  height: number;
  /** Absolute content width in CSS px (max clip end); used for viewport slicing only. */
  contentWidth: number;
  /** Timeline px-per-second → px mapping, identical to the DOM clip path. */
  timeToPixel: (time: number) => number;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId?: string | null;
  /** Base track color (CSS color string) used for clip fills. */
  trackColor: string;
  /** Current horizontal scroll offset in px (absolute timeline space). */
  scrollX: number;
  /** Visible viewport width in px — thumbnails are only loaded/drawn for clips inside it. */
  viewportWidth: number;
  waveformsEnabled?: boolean;
  audioDisplayMode?: TimelineAudioDisplayMode;
  clipDrag?: ClipDragState | null;
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
  waveformPyramids?: WaveformPyramidMap;
}

// Only decode/draw thumbnails for clips within the visible window (+ overscan).
// Without this, opening a 100-clip comp kicks off 100+ ImageBitmap decodes at
// once and freezes the tab (issue #228).
const THUMBNAIL_VIEWPORT_OVERSCAN_PX = 600;
const CANVAS_RENDER_OVERSCAN_PX = 1200;

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    let r: number, g: number, b: number;
    if (color.length === 4) {
      r = parseInt(color[1] + color[1], 16);
      g = parseInt(color[2] + color[2], 16);
      b = parseInt(color[3] + color[3], 16);
    } else {
      r = parseInt(color.slice(1, 3), 16);
      g = parseInt(color.slice(3, 5), 16);
      b = parseInt(color.slice(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

/** A clip shows a source-cache filmstrip when it is a video clip with a media id
 *  (mirrors the DOM path's `useSourceCache`). Returns the media file id or null. */
function clipShowsThumbnails(clip: CanvasClip): string | null {
  if (clip.source?.type !== 'video') return null;
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

type WaveformPyramidMap = ReadonlyMap<string, TimelineWaveformPyramid | null>;

function isCanvasAudioClip(clip: CanvasClip): boolean {
  return clip.source?.type === 'audio' ||
    hasLegacyWaveformSamples(clip);
}

function getWaveformPyramidForClip(clip: CanvasClip, waveformPyramids: WaveformPyramidMap | undefined): TimelineWaveformPyramid | null {
  const refId = getPreferredWaveformPyramidRef(clip);
  if (!refId) return null;
  return waveformPyramids?.get(refId) ?? getCachedTimelineWaveformArtifact(refId) ?? null;
}

function drawCanvasWaveformCenterLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  alpha = 0.16,
): void {
  const midY = height / 2;
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();
}

function buildCanvasSignedEnvelopePath(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  minFloor = 0,
  scale = 1,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;
  const normalizedScale = Math.max(0, Math.min(1, scale));

  const xAt = (index: number) => {
    if (count <= 1) return width / 2;
    return (index / (count - 1)) * width;
  };
  const topYAt = (index: number) => {
    const column = columns[index];
    return midY - Math.max(column.max, column.peak * minFloor, 0) * normalizedScale * halfHeight;
  };
  const bottomYAt = (index: number) => {
    const column = columns[index];
    return midY + Math.max(-column.min, column.peak * minFloor, 0) * normalizedScale * halfHeight;
  };

  ctx.beginPath();
  ctx.moveTo(0, topYAt(0));

  for (let index = 0; index < count - 1; index += 1) {
    const previousX = xAt(index);
    const currentX = xAt(index + 1);
    const previousY = topYAt(index);
    const currentY = topYAt(index + 1);
    ctx.quadraticCurveTo(previousX, previousY, (previousX + currentX) / 2, (previousY + currentY) / 2);
  }
  ctx.quadraticCurveTo(width, topYAt(count - 1), width, topYAt(count - 1));

  ctx.lineTo(width, bottomYAt(count - 1));

  for (let index = count - 1; index > 0; index -= 1) {
    const nextX = xAt(index);
    const currentX = xAt(index - 1);
    const nextY = bottomYAt(index);
    const currentY = bottomYAt(index - 1);
    ctx.quadraticCurveTo(nextX, nextY, (nextX + currentX) / 2, (nextY + currentY) / 2);
  }
  ctx.quadraticCurveTo(0, bottomYAt(0), 0, bottomYAt(0));
  ctx.closePath();
}

function buildCanvasSmoothEnvelopePath(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  valueForColumn: (column: WaveformColumn) => number,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;

  const xAt = (index: number) => {
    if (count <= 1) return width / 2;
    return (index / (count - 1)) * width;
  };
  const topYAt = (index: number) => midY - valueForColumn(columns[index]) * halfHeight;
  const bottomYAt = (index: number) => midY + valueForColumn(columns[index]) * halfHeight;

  ctx.beginPath();
  ctx.moveTo(0, topYAt(0));
  for (let index = 0; index < count - 1; index += 1) {
    const previousX = xAt(index);
    const currentX = xAt(index + 1);
    const previousY = topYAt(index);
    const currentY = topYAt(index + 1);
    ctx.quadraticCurveTo(previousX, previousY, (previousX + currentX) / 2, (previousY + currentY) / 2);
  }
  ctx.quadraticCurveTo(width, topYAt(count - 1), width, topYAt(count - 1));
  ctx.lineTo(width, bottomYAt(count - 1));
  for (let index = count - 1; index > 0; index -= 1) {
    const nextX = xAt(index);
    const currentX = xAt(index - 1);
    const nextY = bottomYAt(index);
    const currentY = bottomYAt(index - 1);
    ctx.quadraticCurveTo(nextX, nextY, (nextX + currentX) / 2, (nextY + currentY) / 2);
  }
  ctx.quadraticCurveTo(0, bottomYAt(0), 0, bottomYAt(0));
  ctx.closePath();
}

function drawDetailedCanvasWaveform(ctx: CanvasRenderingContext2D, columns: WaveformColumn[], width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(216, 230, 240, 0.10)');
  gradient.addColorStop(0.5, 'rgba(224, 238, 248, 0.22)');
  gradient.addColorStop(1, 'rgba(216, 230, 240, 0.10)');
  buildCanvasSignedEnvelopePath(ctx, columns, width, height, 0.01, 0.82);
  ctx.fillStyle = gradient;
  ctx.fill();

  const rmsGradient = ctx.createLinearGradient(0, 0, 0, height);
  rmsGradient.addColorStop(0, 'rgba(92, 203, 255, 0.18)');
  rmsGradient.addColorStop(0.5, 'rgba(178, 230, 255, 0.44)');
  rmsGradient.addColorStop(1, 'rgba(92, 203, 255, 0.18)');
  buildCanvasSmoothEnvelopePath(ctx, columns, width, height, (column) => Math.min(column.rms * 0.84, column.peak * 0.72));
  ctx.fillStyle = rmsGradient;
  ctx.fill();

  drawCanvasWaveformCenterLine(ctx, width, height);
}

function drawCompactCanvasWaveform(ctx: CanvasRenderingContext2D, columns: WaveformColumn[], width: number, height: number): void {
  buildCanvasSignedEnvelopePath(ctx, columns, width, height, 0.08);
  ctx.fillStyle = 'rgba(235, 241, 248, 0.62)';
  ctx.fill();
  drawCanvasWaveformCenterLine(ctx, width, height, 0.12);
}

function resolveCanvasWaveformChannelIndexes(
  pyramid: TimelineWaveformPyramid | null,
  waveformChannels: readonly (readonly number[])[] | undefined,
  height: number,
): number[] {
  const pyramidIndexes = pyramid?.levels
    .find(level => level.channels.length > 0)
    ?.channels.map(channel => channel.channelIndex) ?? [];
  const legacyIndexes = waveformChannels
    ?.map((channel, index) => (channel.length > 0 ? index : -1))
    .filter(index => index >= 0) ?? [];
  const indexes = pyramidIndexes.length > 0
    ? pyramidIndexes
    : legacyIndexes.length > 0
      ? legacyIndexes
      : [0];
  const maxChannels = height < 42 ? 1 : MAX_RENDERED_WAVEFORM_CHANNELS;
  return indexes.slice(0, maxChannels);
}

function drawAudioWaveform(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  pyramid: TimelineWaveformPyramid | null,
  x: number,
  top: number,
  w: number,
  h: number,
  mode: TimelineAudioDisplayMode,
  pixelsPerSecond: number,
): void {
  const channels = clip.waveformChannels?.filter(channel => channel.length > 0);
  const fallback = clip.waveform && clip.waveform.length > 0 ? [clip.waveform] : [];
  const drawableChannels = channels && channels.length > 0 ? channels : fallback;
  const hasDrawableWaveform = Boolean(pyramid || drawableChannels.length > 0);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, Math.min(4, h / 4));
  ctx.clip();

  ctx.fillStyle = mode === 'spectral' ? 'rgba(8, 14, 24, 0.44)' : 'rgba(4, 10, 18, 0.22)';
  ctx.fillRect(x, top, w, h);

  if (!hasDrawableWaveform || w < 2) {
    ctx.save();
    ctx.translate(x, top);
    drawCanvasWaveformCenterLine(ctx, w, h, clip.waveformGenerating ? 0.34 : 0.18);
    if (clip.waveformGenerating) {
      const progress = Math.max(0.04, Math.min(1, (clip.waveformProgress ?? 30) / 100));
      const progressGradient = ctx.createLinearGradient(0, 0, w, 0);
      progressGradient.addColorStop(0, 'rgba(92, 203, 255, 0.52)');
      progressGradient.addColorStop(1, 'rgba(178, 230, 255, 0.12)');
      ctx.fillStyle = progressGradient;
      ctx.fillRect(0, h - 3, w * progress, 2);
    }
    ctx.restore();
    ctx.restore();
    return;
  }

  const renderChannels = resolveCanvasWaveformChannelIndexes(pyramid, clip.waveformChannels, h);
  const laneGap = renderChannels.length > 1 ? 2 : 0;
  const laneHeight = Math.max(8, (h - laneGap * (renderChannels.length - 1)) / renderChannels.length);
  const naturalDuration = Math.max(0.001, pyramid?.duration ?? clip.source?.naturalDuration ?? clip.outPoint ?? clip.duration);
  const inPoint = Math.max(0, Math.min(naturalDuration, clip.inPoint ?? 0));
  const outPoint = Math.max(inPoint + 0.001, Math.min(naturalDuration, clip.outPoint ?? inPoint + clip.duration));

  ctx.save();
  ctx.translate(x, top);

  renderChannels.forEach((channelIndex, laneIndex) => {
    const laneTop = laneIndex * (laneHeight + laneGap);
    if (laneIndex > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, laneTop - laneGap / 2);
      ctx.lineTo(w, laneTop - laneGap / 2);
      ctx.stroke();
    }

    const lod = buildWaveformLod({
      waveform: clip.waveform ?? [],
      waveformChannels: clip.waveformChannels,
      pyramid,
      width: w,
      inPoint,
      outPoint,
      naturalDuration,
      pixelsPerSecond,
      channelIndex,
    });
    if (!lod || lod.columns.length === 0) {
      ctx.save();
      ctx.translate(0, laneTop);
      drawCanvasWaveformCenterLine(ctx, w, laneHeight, 0.18);
      ctx.restore();
      return;
    }

    const smoothed = smoothWaveformColumns(lod.columns, lod.source === 'pyramid' ? 1 : 2, 0.45);
    const normalized = normalizeWaveformColumnsForDisplay(smoothed, {
      targetPeak: mode === 'compact' ? 0.52 : 0.66,
      minReferencePeak: mode === 'spectral' ? 0.025 : 0.032,
      maxGain: mode === 'spectral' ? 20 : 16,
      referencePeak: resolveWaveformDisplayReferencePeak(smoothed, { minReferencePeak: mode === 'spectral' ? 0.025 : 0.032 }),
      perceptualScale: mode !== 'compact',
      noiseFloorDb: mode === 'spectral' ? -42 : -30,
    });

    ctx.save();
    ctx.translate(0, laneTop);
    if (mode === 'compact') {
      drawCompactCanvasWaveform(ctx, normalized, w, laneHeight);
    } else {
      drawDetailedCanvasWaveform(ctx, normalized, w, laneHeight);
    }
    ctx.restore();
  });

  ctx.restore();
  ctx.restore();
}

function drawCanvasFadeCurve(
  ctx: CanvasRenderingContext2D,
  fade: CanvasFadeVisuals | undefined,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (!fade || fade.keyframes.length < 2 || typeof Path2D === 'undefined') return;
  const path = buildFadeCurvePath({
    keyframes: fade.keyframes,
    clipDuration: fade.clipDuration,
    width: w,
    height: h,
  });
  if (!path) return;

  ctx.save();
  ctx.translate(x, top);
  ctx.fillStyle = fade.isAudioClip ? 'rgba(51, 197, 255, 0.13)' : 'rgba(0, 0, 0, 0.4)';
  ctx.fill(new Path2D(path.fillPath));
  ctx.strokeStyle = fade.isAudioClip ? 'rgba(96, 217, 255, 0.86)' : 'rgba(140, 180, 220, 0.8)';
  ctx.lineWidth = fade.isAudioClip ? 1.6 : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(path.curvePath));
  ctx.fillStyle = fade.isAudioClip ? 'rgba(96, 217, 255, 0.95)' : 'rgba(140, 180, 220, 1)';
  for (const point of path.points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

interface CanvasClipGeometry {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  visible: boolean;
  trimEdge?: 'left' | 'right';
  originalStartTime: number;
  originalEndTime: number;
  sourceDuration: number;
}

function resolveClipGeometry(clip: CanvasClip, props: TimelineClipCanvasProps): CanvasClipGeometry {
  const { clipDrag, clipDragPreview, clipTrim, trackId } = props;
  let startTime = clip.startTime;
  let duration = clip.duration;
  let inPoint = clip.inPoint ?? 0;
  let outPoint = clip.outPoint ?? inPoint + duration;
  let visible = clip.trackId === trackId;
  let trimEdge: 'left' | 'right' | undefined;
  const sourceDuration = getTimelineClipSourceDuration(clip);
  const dragPreviewPatch = clipDragPreview?.patches[clip.id];

  if (clipDrag?.clipId === clip.id) {
    visible = clipDrag.currentTrackId === trackId;
    const previewStartTime = dragPreviewPatch ? Math.max(0, dragPreviewPatch.startTime) : startTime;
    startTime = clipDrag.snappedTime !== null ? clipDrag.snappedTime : previewStartTime;
  } else if (clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined) {
    startTime = Math.max(0, clip.startTime + clipDrag.multiSelectTimeDelta);
  } else if (dragPreviewPatch) {
    startTime = Math.max(0, dragPreviewPatch.startTime);
    visible = (dragPreviewPatch.trackId ?? clip.trackId) === trackId;
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

function drawSourceExtensionGhost(
  ctx: CanvasRenderingContext2D,
  edge: 'left' | 'right',
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top, w, h);
  ctx.clip();

  const fill = ctx.createLinearGradient(0, top, 0, top + h);
  fill.addColorStop(0, 'rgba(251, 191, 36, 0.24)');
  fill.addColorStop(1, 'rgba(251, 191, 36, 0.08)');
  ctx.fillStyle = fill;
  ctx.fillRect(x, top, w, h);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  for (let offset = -h; offset < w + h; offset += 10) {
    ctx.beginPath();
    ctx.moveTo(x + offset, top + h);
    ctx.lineTo(x + offset + h, top);
    ctx.stroke();
  }

  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.46)';
  ctx.strokeRect(x + 0.5, top + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(251, 191, 36, 0.92)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (edge === 'left') {
    ctx.moveTo(x + w - 1, top);
    ctx.lineTo(x + w - 1, top + h);
  } else {
    ctx.moveTo(x + 1, top);
    ctx.lineTo(x + 1, top + h);
  }
  ctx.stroke();

  ctx.restore();
}

function drawSourceExtensionGhosts(
  ctx: CanvasRenderingContext2D,
  props: TimelineClipCanvasProps,
  geometry: CanvasClipGeometry,
  clipTop: number,
  clipHeight: number,
  visibleLeft: number,
  visibleRight: number,
  canvasOffsetX: number,
): void {
  if (!geometry.trimEdge) return;

  const displayEnd = geometry.startTime + geometry.duration;
  let drewPrimaryGhost = false;
  const pushGhost = (edge: 'left' | 'right', startTime: number, endTime: number) => {
    const ghostStartTime = Math.max(0, Math.min(startTime, endTime));
    const ghostEndTime = Math.max(ghostStartTime, Math.max(startTime, endTime));
    if (ghostEndTime - ghostStartTime <= 0.001) return false;

    const rawLeft = props.timeToPixel(ghostStartTime);
    const rawRight = props.timeToPixel(ghostEndTime);
    const clippedLeft = Math.max(rawLeft, visibleLeft);
    const clippedRight = Math.min(rawRight, visibleRight);
    if (clippedRight - clippedLeft < 1) return false;

    drawSourceExtensionGhost(ctx, edge, clippedLeft - canvasOffsetX, clipTop, clippedRight - clippedLeft, clipHeight);
    return true;
  };

  if (geometry.trimEdge === 'left') {
    const availableLeftDuration = Math.min(
      Math.max(0, geometry.inPoint),
      Math.max(0, geometry.startTime),
    );
    if (availableLeftDuration > 0.001) {
      drewPrimaryGhost = pushGhost('left', geometry.startTime - availableLeftDuration, geometry.startTime) || drewPrimaryGhost;
    }
  }

  if (geometry.trimEdge === 'right') {
    const availableRightDuration = Math.max(0, geometry.sourceDuration - geometry.outPoint);
    if (availableRightDuration > 0.001) {
      drewPrimaryGhost = pushGhost('right', displayEnd, displayEnd + availableRightDuration) || drewPrimaryGhost;
    }
  }

  if (
    !drewPrimaryGhost &&
    geometry.trimEdge === 'left' &&
    Math.abs(geometry.startTime - geometry.originalStartTime) > 0.001
  ) {
    pushGhost('left', Math.min(geometry.startTime, geometry.originalStartTime), Math.max(geometry.startTime, geometry.originalStartTime));
  }

  if (
    !drewPrimaryGhost &&
    geometry.trimEdge === 'right' &&
    Math.abs(displayEnd - geometry.originalEndTime) > 0.001
  ) {
    pushGhost('right', Math.min(displayEnd, geometry.originalEndTime), Math.max(displayEnd, geometry.originalEndTime));
  }
}

/** Cover-fit draw of a bitmap into a destination rect, clipped by the caller. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  bmp: ImageBitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const scale = Math.max(dw / bmp.width, dh / bmp.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (bmp.width - sw) / 2;
  const sy = (bmp.height - sh) / 2;
  ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawThumbnails(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  mediaFileId: string,
  x: number,
  top: number,
  w: number,
  h: number,
  requestRedraw: () => void,
): number {
  const count = Math.max(1, Math.min(MAX_THUMB_SLOTS, Math.floor(w / CANVAS_THUMB_SLOT_PX)));
  const urls = thumbnailCacheService.getThumbnailsForRange(
    mediaFileId,
    clip.inPoint ?? 0,
    clip.outPoint ?? (clip.inPoint ?? 0) + clip.duration,
    count,
    clip.reversed,
  );
  const slotW = w / count;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const url = urls[i];
    if (!url) continue;
    const bmp = getThumbnailBitmap(url);
    if (bmp) {
      drawCover(ctx, bmp, x + i * slotW, top, slotW, h);
      drawn += 1;
    } else {
      ensureThumbnailBitmap(url, requestRedraw, mediaFileId);
    }
  }
  return drawn;
}

function drawClips(
  ctx: CanvasRenderingContext2D,
  props: TimelineClipCanvasProps,
  cssWidth: number,
  canvasOffsetX: number,
  requestRedraw: () => void,
): TimelineCanvasDrawDiagnostics {
  const { clips, height, timeToPixel, selectedClipIds, hoveredClipId, trackColor, scrollX, viewportWidth, waveformsEnabled, audioDisplayMode = 'detailed', waveformPyramids } = props;
  ctx.clearRect(0, 0, cssWidth, height);
  const diagnostics: TimelineCanvasDrawDiagnostics = {
    inputClipCount: clips.length,
    visibleClipCount: 0,
    drawnClipCount: 0,
    thumbnailClipCount: 0,
    thumbnailDrawCount: 0,
    waveformClipCount: 0,
    workerMode: false,
  };

  const thumbVisibleLeft = scrollX - THUMBNAIL_VIEWPORT_OVERSCAN_PX;
  const thumbVisibleRight = scrollX + viewportWidth + THUMBNAIL_VIEWPORT_OVERSCAN_PX;
  const renderVisibleLeft = scrollX - CANVAS_RENDER_OVERSCAN_PX;
  const renderVisibleRight = scrollX + viewportWidth + CANVAS_RENDER_OVERSCAN_PX;

  const radius = Math.min(4, height / 4);
  const fill = withAlpha(trackColor, 0.55);
  const fillSelected = withAlpha(trackColor, 0.85);
  const border = withAlpha(trackColor, 0.9);
  const selectedBorder = '#ffffff';

  ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';

  for (const clip of clips) {
    const geometry = resolveClipGeometry(clip, props);
    if (!geometry.visible) continue;
    diagnostics.visibleClipCount += 1;
    const absoluteX = timeToPixel(geometry.startTime);
    const absoluteW = timeToPixel(geometry.duration);
    const absoluteRight = absoluteX + absoluteW;
    const visibleAbsLeft = Math.max(absoluteX, canvasOffsetX, renderVisibleLeft);
    const visibleAbsRight = Math.min(absoluteRight, canvasOffsetX + cssWidth, renderVisibleRight);
    const visibleW = visibleAbsRight - visibleAbsLeft;
    if (visibleW <= 0) continue;
    diagnostics.drawnClipCount += 1;

    const x = absoluteX - canvasOffsetX;
    const visibleX = visibleAbsLeft - canvasOffsetX;
    const w = absoluteW;
    if (w < LOD_BAR_PX) {
      ctx.fillStyle = selectedClipIds.has(clip.id) ? fillSelected : fill;
      ctx.fillRect(x, 1, Math.max(1, w), height - 2);
      continue;
    }

    const selected = selectedClipIds.has(clip.id);
    const hovered = hoveredClipId === clip.id;
    const top = 1;
    const h = height - 2;

    // Rounded clip body fill.
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.fillStyle = selected ? fillSelected : fill;
    ctx.fill();

    if (waveformsEnabled && isCanvasAudioClip(clip)) {
      diagnostics.waveformClipCount += 1;
      const waveformPyramid = getWaveformPyramidForClip(clip, waveformPyramids);
      const visibleStartRatio = Math.max(0, Math.min(1, (visibleAbsLeft - absoluteX) / Math.max(1, absoluteW)));
      const visibleEndRatio = Math.max(visibleStartRatio, Math.min(1, (visibleAbsRight - absoluteX) / Math.max(1, absoluteW)));
      const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
      drawAudioWaveform(
        ctx,
        {
          ...clip,
          inPoint: geometry.inPoint + sourceSpan * visibleStartRatio,
          outPoint: geometry.inPoint + sourceSpan * visibleEndRatio,
        },
        waveformPyramid,
        visibleX,
        top,
        visibleW,
        h,
        audioDisplayMode,
        timeToPixel(1),
      );
    }

    // Filmstrip thumbnails clipped to the body — only for clips in the viewport,
    // so opening a large comp doesn't decode every clip's thumbnails at once.
    const inThumbWindow = absoluteRight > thumbVisibleLeft && absoluteX < thumbVisibleRight;
    const mediaFileId = (visibleW >= LOD_THUMB_PX && inThumbWindow) ? clipShowsThumbnails(clip) : null;
    if (mediaFileId) {
      diagnostics.thumbnailClipCount += 1;
      const visibleStartRatio = Math.max(0, Math.min(1, (visibleAbsLeft - absoluteX) / Math.max(1, absoluteW)));
      const visibleEndRatio = Math.max(visibleStartRatio, Math.min(1, (visibleAbsRight - absoluteX) / Math.max(1, absoluteW)));
      const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
      const visibleClip = {
        ...clip,
        inPoint: geometry.inPoint + sourceSpan * visibleStartRatio,
        outPoint: geometry.inPoint + sourceSpan * visibleEndRatio,
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(visibleX, top, visibleW, h);
      ctx.clip();
      diagnostics.thumbnailDrawCount += drawThumbnails(ctx, visibleClip, mediaFileId, visibleX, top, visibleW, h, requestRedraw);
      // Darken bottom strip so the label stays readable over thumbnails.
      const grad = ctx.createLinearGradient(0, top + h - 16, 0, top + h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(visibleX, top + h - 16, visibleW, 16);
      ctx.restore();
    }

    drawSourceExtensionGhosts(ctx, props, geometry, top, h, renderVisibleLeft, renderVisibleRight, canvasOffsetX);
    drawCanvasFadeCurve(ctx, clip.fade, x, top, w, h);

    // Border.
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.lineWidth = selected ? 2 : hovered ? 1.5 : 1;
    ctx.strokeStyle = selected ? selectedBorder : hovered ? 'rgba(255,255,255,0.58)' : border;
    ctx.stroke();

    // Label, only when there is room.
    if (visibleW >= LOD_LABEL_PX && clip.name) {
      const labelLeft = Math.max(x + 5, visibleX + 5);
      const labelRight = Math.min(x + w - 5, visibleX + visibleW - 5);
      const labelW = labelRight - labelLeft;
      if (labelW <= 4) continue;

      ctx.save();
      ctx.beginPath();
      ctx.rect(labelLeft, top, labelW, h);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillText(clip.name, labelLeft + 1, mediaFileId ? top + h - 8 : top + h / 2);
      ctx.restore();
    }
  }

  return diagnostics;
}

function TimelineClipCanvasComponent(props: TimelineClipCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const thumbnailRedrawRafRef = useRef<number | null>(null);
  const visibleThumbnailMediaIdsRef = useRef<Set<string>>(new Set());
  const [redrawNonce, bumpRedraw] = useReducer((n: number) => n + 1, 0);
  const {
    clips,
    trackId,
    height,
    contentWidth,
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
  // Quantize scroll so we only redraw (to load newly-visible thumbnails) every
  // ~200px scrolled, not every pixel; the THUMBNAIL_VIEWPORT_OVERSCAN_PX covers
  // the gap. The draw still uses the exact scrollX for the window.
  const scrollBucket = Math.round(scrollX / 200);
  const canvasOffsetX = Math.max(0, scrollBucket * 200 - CANVAS_RENDER_OVERSCAN_PX);
  const cssWidth = Math.max(
    1,
    Math.min(
      MAX_CANVAS_WIDTH_PX,
      Math.ceil(viewportWidth + CANVAS_RENDER_OVERSCAN_PX * 2),
    ),
  );
  const visibleWaveformClips = useMemo(() => {
    if (!waveformsEnabled) return [] as readonly CanvasClip[];
    const visibleLeft = scrollX - CANVAS_RENDER_OVERSCAN_PX;
    const visibleRight = scrollX + viewportWidth + CANVAS_RENDER_OVERSCAN_PX;
    return clips.filter((clip) => {
      if (!isCanvasAudioClip(clip)) return false;
      const x = timeToPixel(clip.startTime);
      const w = timeToPixel(clip.duration);
      return x + w >= visibleLeft && x <= visibleRight;
    });
  }, [clips, scrollX, timeToPixel, viewportWidth, waveformsEnabled]);

  const visibleWaveformArtifactRefs = useMemo(
    () => collectTimelineWaveformArtifactRefs(visibleWaveformClips),
    [visibleWaveformClips],
  );
  const visibleSourceWaveformGenerationRequests = useMemo(() => {
    if (!waveformsEnabled || clipDrag || clipDragPreview) return [];
    if (audioDisplayMode !== 'detailed') {
      const shouldUpgradeCompact =
        audioDisplayMode === 'compact' &&
        (timeToPixel(1) >= WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM || cssWidth > WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH);
      if (!shouldUpgradeCompact) return [];
    }

    return collectVisibleTimelineSourceWaveformGenerationRequests({
      clips: visibleWaveformClips,
      scrollX,
      viewportWidth,
      overscanPx: CANVAS_RENDER_OVERSCAN_PX,
      timeToPixel,
      mode: audioDisplayMode,
    });
  }, [
    audioDisplayMode,
    clipDrag,
    clipDragPreview,
    cssWidth,
    scrollX,
    timeToPixel,
    viewportWidth,
    visibleWaveformClips,
    waveformsEnabled,
  ]);
  const visibleSourceWaveformGenerationKey = useMemo(
    () => visibleSourceWaveformGenerationRequests.map((request) => request.requestKey).join('|'),
    [visibleSourceWaveformGenerationRequests],
  );
  const waveformRefKey = useMemo(
    () => visibleWaveformArtifactRefs.join('|'),
    [visibleWaveformArtifactRefs],
  );
  const [waveformPyramids, setWaveformPyramids] = useState<Map<string, TimelineWaveformPyramid | null>>(() => new Map());
  const waveformPyramidsRef = useRef<WaveformPyramidMap>(waveformPyramids);

  useEffect(() => {
    waveformPyramidsRef.current = waveformPyramids;
  }, [waveformPyramids]);

  const hasFadeVisuals = clips.some((clip) => (clip.fade?.keyframes.length ?? 0) >= 2);
  // Phase 4: optionally render in an OffscreenCanvas worker (off main thread).
  const workerMode = flags.timelineCanvasWorker && !hasFadeVisuals && !waveformsEnabled && !clipDrag && !clipDragPreview && !clipTrim;
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);
  const mediaFilesState = useMediaStore((state) => state.files);
  const mediaFiles = useMemo(
    () => (Array.isArray(mediaFilesState) ? mediaFilesState : []),
    [mediaFilesState],
  );
  const mediaFileHashById = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const file of mediaFiles) {
      map.set(file.id, file.fileHash);
    }
    return map;
  }, [mediaFiles]);
  const visibleThumbnailRefs = useMemo<VisibleTimelineThumbnailRef[]>(() => {
    return collectVisibleTimelineThumbnailRefs({
      clips,
      scrollX,
      viewportWidth,
      overscanPx: THUMBNAIL_VIEWPORT_OVERSCAN_PX,
      timeToPixel,
      mediaFileHashById,
    });
  }, [clips, mediaFileHashById, scrollX, timeToPixel, viewportWidth]);

  useEffect(() => {
    visibleThumbnailMediaIdsRef.current = new Set(
      visibleThumbnailRefs.map((ref) => ref.mediaFileId),
    );
  }, [visibleThumbnailRefs]);

  // Redraw when the thumbnail cache gains frames for any of our media files.
  // (Main-thread path only — the worker path does not draw thumbnails yet.)
  useEffect(() => {
    if (workerMode) return;
    const unsubscribe = thumbnailCacheService.subscribe((mediaFileId) => {
      if (!visibleThumbnailMediaIdsRef.current.has(mediaFileId)) return;
      if (thumbnailRedrawRafRef.current !== null) return;
      thumbnailRedrawRafRef.current = requestAnimationFrame(() => {
        thumbnailRedrawRafRef.current = null;
        bumpRedraw();
      });
    });
    return () => {
      unsubscribe();
      if (thumbnailRedrawRafRef.current !== null) {
        cancelAnimationFrame(thumbnailRedrawRafRef.current);
        thumbnailRedrawRafRef.current = null;
      }
    };
  }, [workerMode]);

  useEffect(() => {
    if (workerMode || visibleThumbnailRefs.length === 0) return;
    return scheduleVisibleTimelineThumbnailDbWarmup(visibleThumbnailRefs);
  }, [visibleThumbnailRefs, workerMode]);

  useEffect(() => {
    if (workerMode || visibleThumbnailRefs.length === 0) return;
    return scheduleVisibleTimelineThumbnailGeneration(visibleThumbnailRefs);
  }, [visibleThumbnailRefs, workerMode]);

  useEffect(() => {
    if (!waveformsEnabled || !waveformRefKey) return;
    const controller = new AbortController();
    const refs = waveformRefKey
      .split('|')
      .filter((refId) => refId && !waveformPyramidsRef.current.has(refId));
    if (refs.length === 0) return;

    const publish = (refId: string, pyramid: TimelineWaveformPyramid | null) => {
      if (controller.signal.aborted) return;
      setWaveformPyramids((prev) => {
        if (prev.has(refId) && prev.get(refId) === pyramid) return prev;
        const next = new Map(prev);
        next.set(refId, pyramid);
        return next;
      });
      bumpRedraw();
    };

    void warmTimelineWaveformArtifacts(
      refs,
      {
        signal: controller.signal,
        onResult: ({ refId, pyramid }) => publish(refId, pyramid),
      },
    );

    return () => {
      controller.abort();
    };
  }, [waveformRefKey, waveformsEnabled]);

  useEffect(() => {
    if (!waveformsEnabled || !visibleSourceWaveformGenerationKey) return;
    return scheduleVisibleTimelineSourceWaveformGeneration(
      visibleSourceWaveformGenerationRequests,
      { delayMs: WAVEFORM_GENERATION_DELAY_MS },
    );
  }, [visibleSourceWaveformGenerationKey, visibleSourceWaveformGenerationRequests, waveformsEnabled]);

  // Worker lifecycle: transfer the canvas's drawing surface to the worker once.
  useEffect(() => {
    if (!workerMode) return;
    const canvas = canvasRef.current;
    if (!canvas || workerRef.current) return;
    const worker = new Worker(new URL('./workers/timelineClipCanvas.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
    workerReadyRef.current = true;
    return () => {
      worker.terminate();
      workerRef.current = null;
      workerReadyRef.current = false;
    };
  }, [workerMode]);

  // Worker draw: post plain geometry whenever it changes. CSS size stays on the
  // main-thread element; the worker owns the backing buffer.
  useEffect(() => {
    if (!workerMode) return;
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!canvas || !worker || !workerReadyRef.current) return;
    canvas.style.left = `${canvasOffsetX}px`;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${height}px`;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    worker.postMessage({
      type: 'draw',
      clips: clips.map((c) => ({ id: c.id, startTime: c.startTime, duration: c.duration, name: c.name })),
      height,
      cssWidth,
      canvasOffsetX,
      pxPerSecond: timeToPixel(1),
      dpr,
      selectedIds: Array.from(selectedClipIds),
      excludeIds: [],
      trackColor,
    });
  }, [workerMode, clips, height, cssWidth, canvasOffsetX, timeToPixel, selectedClipIds, trackColor]);

  useEffect(() => {
    if (workerMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const targetWidth = Math.round(cssWidth * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth) {
      canvas.width = targetWidth;
    }
    if (canvas.height !== targetHeight) {
      canvas.height = targetHeight;
    }
    const cssWidthStyle = `${cssWidth}px`;
    const cssHeightStyle = `${height}px`;
    const cssLeftStyle = `${canvasOffsetX}px`;
    if (canvas.style.left !== cssLeftStyle) {
      canvas.style.left = cssLeftStyle;
    }
    if (canvas.style.width !== cssWidthStyle) {
      canvas.style.width = cssWidthStyle;
    }
    if (canvas.style.height !== cssHeightStyle) {
      canvas.style.height = cssHeightStyle;
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const diagnostics = drawClips(
        ctx,
        {
          clips,
          trackId,
          height,
          contentWidth,
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
          waveformPyramids,
        },
        cssWidth,
        canvasOffsetX,
        bumpRedraw,
      );
      reportTimelineCanvasDrawDiagnostics(trackId, {
        ...diagnostics,
        workerMode,
      });
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // scrollX intentionally excluded; scrollBucket drives viewport-thumbnail redraws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerMode, clips, trackId, height, contentWidth, cssWidth, canvasOffsetX, timeToPixel, selectedClipIds, hoveredClipId, trackColor, scrollBucket, viewportWidth, waveformsEnabled, audioDisplayMode, clipDrag, clipDragPreview, clipTrim, waveformPyramids, redrawNonce]);

  return (
    <canvas
      ref={canvasRef}
      className="timeline-clip-canvas"
      style={{ position: 'absolute', left: canvasOffsetX, top: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    />
  );
}

export const TimelineClipCanvas = memo(TimelineClipCanvasComponent);
