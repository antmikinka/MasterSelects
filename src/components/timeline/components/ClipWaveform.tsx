// Render waveform for audio clips using canvas for better performance
// Supports trimming: only displays the portion of waveform between inPoint and outPoint

import { memo, useCallback, useRef, useEffect, useState } from 'react';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { AnimatableProperty, ClipAudioEditOperation, ClipAudioRegionGainPreview, EasingType, Keyframe } from '../../../types';
import {
  doesRegionGainPreviewMatchOperation,
  getAudioEditOperationPreviewVolumeMultiplier,
  getRegionGainPreviewVolumeMultiplier,
} from '../../../services/audio/clipAudioEditPreview';
import { interpolateKeyframeProgress } from '../../../utils/keyframeInterpolation';
import {
  buildWaveformLod,
  normalizeWaveformColumnsForDisplay,
  resolveWaveformDisplayReferencePeak,
  smoothWaveformColumns,
  type TimelineWaveformPyramid,
  type WaveformColumn,
  type WaveformLodResult,
} from '../utils/waveformLod';

const MAX_RENDERED_WAVEFORM_CHANNELS = 8;
const WAVEFORM_AUTOMATION_PROPERTY = 'opacity' as AnimatableProperty;
const DOCK_LAYOUT_TRANSITION_EVENT_NAME = 'masterselects:dock-layout-transition';

type WaveformAutomationKeyframe = {
  id?: string;
  time: number;
  value: number;
  easing?: string;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
};

function drawCenterLine(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const midY = height / 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();
}

function drawChannelSeparator(ctx: CanvasRenderingContext2D, width: number, y: number): void {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
}

function getChannelLabel(channelIndex: number, channelCount: number): string {
  if (channelCount === 1) return '';
  if (channelCount === 2) return channelIndex === 0 ? 'L' : 'R';
  return `Ch ${channelIndex + 1}`;
}

function drawChannelLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  laneTop: number,
  laneHeight: number,
): void {
  if (!label || laneHeight < 20) return;

  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = 'rgba(222, 232, 240, 0.62)';
  ctx.fillText(label, 5, laneTop + 11);
}

function buildSmoothEnvelopePath(
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

function buildSignedEnvelopePath(
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

function percentileFromSorted(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const index = Math.max(0, Math.min(
    values.length - 1,
    Math.round((values.length - 1) * ratio),
  ));
  return values[index] ?? 0;
}

function drawTransientPeakSpikes(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;
  const peakValues = columns
    .map(column => column.peak)
    .filter(peak => peak > 0.0001)
    .toSorted((a, b) => a - b);
  if (peakValues.length === 0) return;

  const transientThreshold = Math.max(
    0.52,
    percentileFromSorted(peakValues, width < 420 ? 0.94 : 0.955),
  );
  const minGapPx = width < 420 ? 11 : 8;
  let lastSpikeX = -Infinity;

  ctx.save();
  ctx.lineWidth = width < 320 ? 0.9 : 1.1;

  for (let index = 0; index < count; index += 1) {
    const column = columns[index];
    const previousPeak = columns[Math.max(0, index - 1)]?.peak ?? 0;
    const nextPeak = columns[Math.min(count - 1, index + 1)]?.peak ?? 0;
    const localPeak = column.peak >= previousPeak && column.peak >= nextPeak;
    const transientLift = column.peak - Math.max(column.rms, Math.min(previousPeak, nextPeak) * 0.82);
    if (!localPeak || column.peak < transientThreshold || transientLift < 0.16) continue;

    const x = count <= 1 ? width / 2 : (index / (count - 1)) * width;
    if (x - lastSpikeX < minGapPx) continue;

    const alpha = Math.max(0.18, Math.min(0.48, 0.18 + transientLift * 0.62));
    const top = midY - Math.max(column.max, column.peak * 0.92, 0) * halfHeight;
    const bottom = midY + Math.max(-column.min, column.peak * 0.92, 0) * halfHeight;
    const inner = Math.max(column.rms, column.peak * 0.22) * halfHeight;
    ctx.strokeStyle = `rgba(244, 250, 255, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, midY - inner);
    ctx.moveTo(x, midY + inner);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    lastSpikeX = x;
  }

  ctx.restore();
}

function drawCompactWaveform(ctx: CanvasRenderingContext2D, columns: WaveformColumn[], width: number, height: number): void {
  buildSignedEnvelopePath(ctx, columns, width, height, 0.08);
  ctx.fillStyle = 'rgba(235, 241, 248, 0.62)';
  ctx.fill();
}

function drawDetailedWaveform(ctx: CanvasRenderingContext2D, columns: WaveformColumn[], width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(216, 230, 240, 0.10)');
  gradient.addColorStop(0.5, 'rgba(224, 238, 248, 0.22)');
  gradient.addColorStop(1, 'rgba(216, 230, 240, 0.10)');
  buildSignedEnvelopePath(ctx, columns, width, height, 0.01, 0.82);
  ctx.fillStyle = gradient;
  ctx.fill();

  const rmsGradient = ctx.createLinearGradient(0, 0, 0, height);
  rmsGradient.addColorStop(0, 'rgba(92, 203, 255, 0.18)');
  rmsGradient.addColorStop(0.5, 'rgba(178, 230, 255, 0.44)');
  rmsGradient.addColorStop(1, 'rgba(92, 203, 255, 0.18)');
  buildSmoothEnvelopePath(ctx, columns, width, height, (column) => Math.min(column.rms * 0.84, column.peak * 0.72));
  ctx.fillStyle = rmsGradient;
  ctx.fill();

  drawCenterLine(ctx, width, height);
  drawTransientPeakSpikes(ctx, columns, width, height);
}

function drawSpectralWaveform(ctx: CanvasRenderingContext2D, columns: WaveformColumn[], width: number, height: number): void {
  const bandHeight = height / 3;
  const barWidth = Math.max(1, width / columns.length);

  columns.forEach((column, index) => {
    const x = index * barWidth;
    const transient = Math.max(0, column.max - column.min);
    const lowAlpha = 0.08 + column.rms * 0.32;
    const midAlpha = 0.08 + column.peak * 0.34;
    const highAlpha = 0.06 + transient * 0.42;

    ctx.fillStyle = `rgba(92, 203, 255, ${lowAlpha})`;
    ctx.fillRect(x, bandHeight * 2, Math.max(1, barWidth), bandHeight);
    ctx.fillStyle = `rgba(254, 211, 106, ${midAlpha})`;
    ctx.fillRect(x, bandHeight, Math.max(1, barWidth), bandHeight);
    ctx.fillStyle = `rgba(255, 111, 145, ${highAlpha})`;
    ctx.fillRect(x, 0, Math.max(1, barWidth), bandHeight);
  });

  drawDetailedWaveform(ctx, columns, width, height);
}

function applyDisplayGain(
  columns: readonly WaveformColumn[],
  gain: number | undefined,
): WaveformColumn[] {
  if (!Number.isFinite(gain) || Math.abs((gain ?? 1) - 1) < 0.001) {
    return columns as WaveformColumn[];
  }

  const clampedGain = Math.max(0, Math.min(8, gain ?? 1));
  return columns.map(column => {
    const min = Math.max(-1, Math.min(1, column.min * clampedGain));
    const max = Math.max(-1, Math.min(1, column.max * clampedGain));
    const rms = Math.max(0, Math.min(1, column.rms * clampedGain));
    const peak = Math.max(
      Math.max(0, Math.min(1, column.peak * clampedGain)),
      Math.abs(min),
      Math.abs(max),
    );
    return { min, max, rms, peak };
  });
}

function applyMultiplierToColumn(column: WaveformColumn, multiplier: number): WaveformColumn {
  if (Math.abs(multiplier - 1) < 0.001) return column;
  const gain = Math.max(0, Math.min(4, multiplier));
  const min = Math.max(-1, Math.min(1, column.min * gain));
  const max = Math.max(-1, Math.min(1, column.max * gain));
  const rms = Math.max(0, Math.min(1, column.rms * gain));
  const peak = Math.max(
    Math.max(0, Math.min(1, column.peak * gain)),
    Math.abs(min),
    Math.abs(max),
  );
  return { min, max, rms, peak };
}

function applyAudioEditPreviewToColumns(
  columns: readonly WaveformColumn[],
  options: {
    clipId?: string;
    channelIndex?: number;
    sourceStart: number;
    sourceEnd: number;
    editStack?: readonly ClipAudioEditOperation[];
    regionGainPreview?: ClipAudioRegionGainPreview | null;
  },
): WaveformColumn[] {
  const clipId = options.clipId;
  const previewApplies = Boolean(clipId && options.regionGainPreview?.clipId === clipId);
  const editStack = options.editStack ?? [];
  if (!clipId || (!previewApplies && editStack.length === 0)) {
    return columns as WaveformColumn[];
  }

  const sourceDuration = Math.max(0.001, options.sourceEnd - options.sourceStart);
  const count = Math.max(1, columns.length);

  return columns.map((column, index) => {
    const ratio = (index + 0.5) / count;
    const sourceTime = options.sourceStart + ratio * sourceDuration;
    let multiplier = 1;

    for (const operation of editStack) {
      if (doesRegionGainPreviewMatchOperation(options.regionGainPreview, operation)) continue;
      multiplier *= getAudioEditOperationPreviewVolumeMultiplier(operation, sourceTime, options.channelIndex);
      if (multiplier <= 0) break;
    }

    if (multiplier > 0) {
      multiplier *= getRegionGainPreviewVolumeMultiplier(options.regionGainPreview, clipId, sourceTime);
    }

    return applyMultiplierToColumn(column, multiplier);
  });
}

function toInterpolationKeyframe(keyframe: WaveformAutomationKeyframe, fallbackId: string): Keyframe {
  return {
    id: keyframe.id ?? fallbackId,
    clipId: '',
    time: keyframe.time,
    property: WAVEFORM_AUTOMATION_PROPERTY,
    value: Math.max(0, Math.min(4, keyframe.value)),
    easing: (keyframe.easing ?? 'linear') as EasingType,
    handleIn: keyframe.handleIn,
    handleOut: keyframe.handleOut,
  };
}

function sampleAutomationMultiplier(
  keyframes: readonly WaveformAutomationKeyframe[],
  clipLocalTime: number,
): number {
  if (keyframes.length === 0) return 1;

  if (keyframes.length === 1 || clipLocalTime <= keyframes[0].time) {
    return Math.max(0, Math.min(4, keyframes[0].value));
  }

  const last = keyframes[keyframes.length - 1];
  if (clipLocalTime >= last.time) {
    return Math.max(0, Math.min(4, last.value));
  }

  let previous = keyframes[0];
  let next = keyframes[1];
  for (let index = 1; index < keyframes.length; index += 1) {
    if (keyframes[index].time >= clipLocalTime) {
      previous = keyframes[index - 1];
      next = keyframes[index];
      break;
    }
  }

  const duration = Math.max(0.0001, next.time - previous.time);
  const progress = Math.max(0, Math.min(1, (clipLocalTime - previous.time) / duration));
  const easedProgress = interpolateKeyframeProgress(
    toInterpolationKeyframe(previous, 'automation-prev'),
    toInterpolationKeyframe(next, 'automation-next'),
    progress,
  );

  return Math.max(0, Math.min(4, previous.value + (next.value - previous.value) * easedProgress));
}

function applyVolumeAutomationToColumns(
  columns: readonly WaveformColumn[],
  options: {
    clipStart: number;
    clipEnd: number;
    keyframes?: readonly WaveformAutomationKeyframe[];
  },
): WaveformColumn[] {
  const keyframes = options.keyframes ?? [];
  if (keyframes.length === 0) {
    return columns as WaveformColumn[];
  }
  const sortedKeyframes = keyframes
    .filter(keyframe => Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value))
    .toSorted((a, b) => a.time - b.time);
  if (sortedKeyframes.length === 0) {
    return columns as WaveformColumn[];
  }

  const clipDuration = Math.max(0.001, options.clipEnd - options.clipStart);
  const count = Math.max(1, columns.length);
  return columns.map((column, index) => {
    const ratio = (index + 0.5) / count;
    const clipLocalTime = options.clipStart + ratio * clipDuration;
    return applyMultiplierToColumn(column, sampleAutomationMultiplier(sortedKeyframes, clipLocalTime));
  });
}

function getLegacySmoothingRadius(
  pixelsPerSecond: number,
  sourceSamplesPerSecond: number | undefined,
): number {
  if (!sourceSamplesPerSecond || sourceSamplesPerSecond <= 0) return 2;
  const pixelsPerLegacySample = pixelsPerSecond / sourceSamplesPerSecond;
  return Math.max(1, Math.min(14, Math.round(pixelsPerLegacySample * 0.55)));
}

function resolveWaveformChannelIndexes(
  pyramid: TimelineWaveformPyramid | null | undefined,
  waveformChannels: readonly (readonly number[])[] | undefined,
  height: number,
): number[] {
  const sourceChannels = pyramid?.levels.find(level => level.channels.length > 0)?.channels ?? [];
  const channelIndexes = sourceChannels.length > 0
    ? [...new Set(sourceChannels
        .map(channel => channel.channelIndex)
        .filter(channelIndex => Number.isInteger(channelIndex) && channelIndex >= 0))]
        .toSorted((a, b) => a - b)
    : (waveformChannels ?? [])
        .map((channel, channelIndex) => (channel?.length ? channelIndex : -1))
        .filter(channelIndex => channelIndex >= 0);

  if (channelIndexes.length === 0) return [0];

  const maxByHeight = height < 42 ? 2 : MAX_RENDERED_WAVEFORM_CHANNELS;
  return channelIndexes.slice(0, Math.max(1, Math.min(MAX_RENDERED_WAVEFORM_CHANNELS, maxByHeight)));
}

function drawWaveformColumns(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  displayMode: TimelineAudioDisplayMode,
): void {
  if (displayMode === 'compact') {
    drawCompactWaveform(ctx, columns, width, height);
  } else if (displayMode === 'spectral') {
    drawSpectralWaveform(ctx, columns, width, height);
  } else {
    drawDetailedWaveform(ctx, columns, width, height);
  }
}

function smoothColumnsForDisplay(
  lod: WaveformLodResult,
  channelCount: number,
): WaveformColumn[] {
  return lod.source === 'pyramid'
    ? smoothWaveformColumns(lod.columns, channelCount > 1 ? 0 : 1, 0.35)
    : smoothWaveformColumns(
        lod.columns,
        getLegacySmoothingRadius(lod.pixelsPerSecond, lod.sourceSamplesPerSecond),
        0.78,
      );
}

export const ClipWaveform = memo(function ClipWaveform({
  clipId,
  waveform,
  waveformChannels,
  width,
  height,
  inPoint,
  outPoint,
  naturalDuration,
  clipDuration,
  displayMode = 'detailed',
  pixelsPerSecond,
  pyramid,
  waveformVariant = 'legacy',
  displayGain = 1,
  volumeAutomationKeyframes,
  audioEditStack,
  audioRegionGainPreview,
  renderStartPx = 0,
  renderWidth,
  contentOffsetPx = 0,
  normalizationInPoint,
  normalizationOutPoint,
  normalizationWidth,
}: {
  clipId?: string;
  waveform: number[];
  waveformChannels?: number[][];
  width: number;
  height: number;
  inPoint: number;
  outPoint: number;
  naturalDuration: number;
  clipDuration?: number;
  displayMode?: TimelineAudioDisplayMode;
  pixelsPerSecond?: number;
  pyramid?: TimelineWaveformPyramid | null;
  waveformVariant?: 'legacy' | 'source' | 'processed';
  displayGain?: number;
  volumeAutomationKeyframes?: readonly WaveformAutomationKeyframe[];
  audioEditStack?: readonly ClipAudioEditOperation[];
  audioRegionGainPreview?: ClipAudioRegionGainPreview | null;
  renderStartPx?: number;
  renderWidth?: number;
  contentOffsetPx?: number;
  normalizationInPoint?: number;
  normalizationOutPoint?: number;
  normalizationWidth?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    setCanvasElement(node);
  }, []);
  const hasLegacyWaveform = Boolean(waveform?.length || waveformChannels?.some(channel => channel.length > 0));
  const hasDrawableWaveform = Boolean(pyramid || hasLegacyWaveform);
  const renderChannelIndexes = resolveWaveformChannelIndexes(pyramid, waveformChannels, height);
  const renderChannelCount = renderChannelIndexes.length;
  const normalizationReferencePeaks = (() => {
    if (
      normalizationInPoint === undefined ||
      normalizationOutPoint === undefined ||
      normalizationOutPoint <= normalizationInPoint ||
      naturalDuration <= 0
    ) {
      return null;
    }

    const minReferencePeak = displayMode === 'spectral' ? 0.025 : 0.032;
    const resolvedWidth = Math.max(1, Math.min(
      16384,
      Math.floor(normalizationWidth ?? Math.max(1, normalizationOutPoint - normalizationInPoint) * Math.max(1, pixelsPerSecond ?? 1)),
    ));
    const peaks = new Map<number, number>();
    for (const channelIndex of renderChannelIndexes) {
      const lod = buildWaveformLod({
        waveform: waveform ?? [],
        waveformChannels,
        pyramid,
        width: resolvedWidth,
        inPoint: normalizationInPoint,
        outPoint: normalizationOutPoint,
        naturalDuration,
        pixelsPerSecond,
        channelIndex,
      });
      if (!lod || lod.columns.length === 0) continue;
      peaks.set(channelIndex, resolveWaveformDisplayReferencePeak(
        smoothColumnsForDisplay(lod, renderChannelIndexes.length),
        { minReferencePeak },
      ));
    }

    return peaks.size > 0 ? peaks : null;
  })();

  useEffect(() => {
    if (!canvasElement || typeof window === 'undefined') return;

    let frameId: number | null = null;
    const timeoutIds: number[] = [];
    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16);
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window);
    const bumpLayoutRevision = () => {
      if (frameId !== null) return;
      frameId = scheduleFrame(() => {
        frameId = null;
        setLayoutRevision((revision) => (revision + 1) % 1000000);
      });
    };
    const bumpAcrossLayoutTransition = () => {
      bumpLayoutRevision();
      [80, 180, 360, 620].forEach((delayMs) => {
        timeoutIds.push(window.setTimeout(bumpLayoutRevision, delayMs));
      });
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(bumpLayoutRevision);

    resizeObserver?.observe(canvasElement);
    if (canvasElement.parentElement) {
      resizeObserver?.observe(canvasElement.parentElement);
    }

    window.addEventListener('resize', bumpLayoutRevision);
    window.addEventListener(DOCK_LAYOUT_TRANSITION_EVENT_NAME, bumpAcrossLayoutTransition);
    document.addEventListener('visibilitychange', bumpLayoutRevision);
    bumpLayoutRevision();

    return () => {
      if (frameId !== null) {
        cancelFrame(frameId);
      }
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      resizeObserver?.disconnect();
      window.removeEventListener('resize', bumpLayoutRevision);
      window.removeEventListener(DOCK_LAYOUT_TRANSITION_EVENT_NAME, bumpAcrossLayoutTransition);
      document.removeEventListener('visibilitychange', bumpLayoutRevision);
    };
  }, [canvasElement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawableWaveform || width <= 0 || naturalDuration <= 0) return;

    let cancelled = false;
    const scheduleFrame = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16);
    const cancelFrame = typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window);

    const frameId = scheduleFrame(() => {
      if (cancelled) return;

      // willReadFrequently forces Chromium onto the CPU raster path for this canvas.
      // This avoids a Linux GPU-accelerated 2D canvas present bug where the waveform
      // can render blank after the per-zoom backing-store resize (#171).
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

    const clipWidth = Math.max(1, width);
    const startPx = Math.max(0, Math.min(clipWidth, renderStartPx));
    const targetWidth = Math.max(1, Math.min(
      clipWidth - startPx,
      renderWidth ?? clipWidth,
    ));
    const MAX_CANVAS_WIDTH = 16384;
    const canvasWidth = Math.min(targetWidth, MAX_CANVAS_WIDTH);
    const sourceSpan = Math.max(0, outPoint - inPoint);
    const visibleInPoint = inPoint + sourceSpan * (startPx / clipWidth);
    const visibleOutPoint = inPoint + sourceSpan * ((startPx + canvasWidth) / clipWidth);
    const resolvedClipDuration = Math.max(
      0.001,
      Number.isFinite(clipDuration)
        ? clipDuration ?? 0
        : pixelsPerSecond && pixelsPerSecond > 0
          ? width / pixelsPerSecond
          : sourceSpan,
    );
    const visibleClipStart = resolvedClipDuration * (startPx / clipWidth);
    const visibleClipEnd = resolvedClipDuration * ((startPx + canvasWidth) / clipWidth);

    // Set canvas size (account for device pixel ratio for sharpness)
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    // Also limit by dpr to avoid exceeding canvas limits.
    const effectiveDpr = Math.min(dpr, MAX_CANVAS_WIDTH / canvasWidth);

    canvas.width = Math.max(1, Math.floor(canvasWidth * effectiveDpr));
    canvas.height = Math.max(1, Math.floor(height * effectiveDpr));
    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

    ctx.clearRect(0, 0, canvasWidth, height);
    ctx.fillStyle = displayMode === 'spectral'
      ? 'rgba(6, 10, 18, 0.24)'
      : 'rgba(6, 10, 18, 0.12)';
    ctx.fillRect(0, 0, canvasWidth, height);

    const channelIndexes = resolveWaveformChannelIndexes(pyramid, waveformChannels, height);
    const laneGap = channelIndexes.length > 1 ? 2 : 0;
    const laneHeight = Math.max(8, (height - laneGap * (channelIndexes.length - 1)) / channelIndexes.length);

    for (let laneIndex = 0; laneIndex < channelIndexes.length; laneIndex += 1) {
      const channelIndex = channelIndexes[laneIndex];
      const laneTop = laneIndex * (laneHeight + laneGap);
      if (laneIndex > 0) {
        drawChannelSeparator(ctx, canvasWidth, laneTop - laneGap / 2);
      }

      const lod = buildWaveformLod({
        waveform: waveform ?? [],
        waveformChannels,
        pyramid,
        width: canvasWidth,
        inPoint: visibleInPoint,
        outPoint: visibleOutPoint,
        naturalDuration,
        pixelsPerSecond,
        channelIndex,
      });
      if (!lod || lod.columns.length === 0) continue;

      const smoothedColumns = smoothColumnsForDisplay(lod, channelIndexes.length);
      const normalizedColumns = normalizeWaveformColumnsForDisplay(smoothedColumns, {
        targetPeak: displayMode === 'compact' ? 0.52 : 0.66,
        minReferencePeak: displayMode === 'spectral' ? 0.025 : 0.032,
        maxGain: displayMode === 'spectral' ? 20 : 16,
        referencePeak: normalizationReferencePeaks?.get(channelIndex),
        perceptualScale: displayMode !== 'compact',
        noiseFloorDb: displayMode === 'spectral' ? -42 : -30,
      });
      const automatedColumns = applyVolumeAutomationToColumns(normalizedColumns, {
        clipStart: visibleClipStart,
        clipEnd: visibleClipEnd,
        keyframes: volumeAutomationKeyframes,
      });
      const editedColumns = applyAudioEditPreviewToColumns(automatedColumns, {
        clipId,
        channelIndex,
        sourceStart: visibleInPoint,
        sourceEnd: visibleOutPoint,
        editStack: audioEditStack,
        regionGainPreview: audioRegionGainPreview,
      });
      const columns = applyDisplayGain(editedColumns, displayGain);

      ctx.save();
      ctx.translate(0, laneTop);
      drawWaveformColumns(ctx, columns, canvasWidth, laneHeight, displayMode);
      ctx.restore();
      drawChannelLabel(ctx, getChannelLabel(channelIndex, channelIndexes.length), laneTop, laneHeight);
    }
    });

    return () => {
      cancelled = true;
      cancelFrame(frameId);
    };
  }, [waveform, waveformChannels, width, height, inPoint, outPoint, naturalDuration, clipDuration, displayMode, pixelsPerSecond, pyramid, waveformVariant, displayGain, volumeAutomationKeyframes, audioEditStack, audioRegionGainPreview, clipId, renderStartPx, renderWidth, hasDrawableWaveform, layoutRevision, normalizationReferencePeaks]);

  if (!hasDrawableWaveform || width <= 0) return null;

  const clipWidth = Math.max(1, width);
  const canvasLeft = Math.max(0, Math.min(clipWidth, renderStartPx));
  const canvasWidth = Math.max(1, Math.min(
    clipWidth - canvasLeft,
    renderWidth ?? clipWidth,
  ));

  return (
    <canvas
      ref={setCanvasRef}
      className={`waveform-canvas waveform-canvas-${displayMode} waveform-canvas-${waveformVariant} ${renderChannelCount > 1 ? 'waveform-canvas-multichannel' : ''}`}
      data-waveform-variant={waveformVariant}
      data-waveform-channels={renderChannelCount}
      style={{ left: contentOffsetPx + canvasLeft, width: canvasWidth, height }}
    />
  );
});
