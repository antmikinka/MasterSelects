import { WebCodecsPlayer } from '../../engine/WebCodecsPlayer';
import type { WorkerRenderStatusEvent } from '../../engine/render/contracts/workerRenderGraph';
import type {
  WorkerRenderHostRuntimeCommand,
  WorkerRenderHostWebCodecsResult,
  WorkerRenderHostWebCodecsSeekMode,
  WorkerRenderHostWebCodecsStatus,
} from './workerRenderHostRuntimeCommands';
import {
  createWorkerWebCodecsStreamState,
  pauseWorkerWebCodecsStream,
  readWorkerWebCodecsStreamFrame,
  type WorkerWebCodecsStreamState,
} from './workerRenderHostRuntimeWebCodecsStream';

type WorkerWebCodecsCommand = Extract<
  WorkerRenderHostRuntimeCommand,
  { readonly type: 'loadWebCodecsSource' | 'readWebCodecsFrame' | 'disposeWebCodecsSource' }
>;

export interface WorkerRenderHostRuntimeWebCodecsResult {
  readonly statusEvents: readonly WorkerRenderStatusEvent[];
  readonly presentedFrameId: null;
  readonly webCodecs: WorkerRenderHostWebCodecsResult | null;
}

export interface WorkerWebCodecsGpuFrameReadResult {
  readonly status: WorkerRenderHostWebCodecsStatus | null;
  readonly frame: VideoFrame | null;
  readonly width: number;
  readonly height: number;
  readonly timestampSeconds: number | null;
  readonly error: string | null;
}

interface WorkerWebCodecsSource {
  readonly sourceId: string;
  readonly player: WebCodecsPlayer;
  readonly reverseFrameCache: Map<string, ReverseFrameCacheEntry>;
  lastError: string | null;
  reverseCaptureTargetSeconds: number | null;
  decodedFrameCount: number;
  lastDecodedFrameTimestampSeconds: number | null;
  stream: WorkerWebCodecsStreamState;
}

const sources = new Map<string, WorkerWebCodecsSource>();
const REVERSE_FRAME_CACHE_LIMIT = 90;
const REVERSE_FRAME_CACHE_LOOKBACK_SECONDS = 2.25;
const REVERSE_PENDING_DECODE_WAIT_SECONDS = 0.75;

interface ReverseFrameCacheEntry {
  readonly frame: VideoFrame;
  readonly timestampSeconds: number;
  readonly width: number;
  readonly height: number;
  lastAccessedAt: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function commandAccepted(command: WorkerWebCodecsCommand): WorkerRenderStatusEvent {
  return {
    type: 'command-accepted',
    commandType: command.type,
    requestId: command.requestId,
    presentation: 'not-presenting',
  };
}

function statusForSource(source: WorkerWebCodecsSource): WorkerRenderHostWebCodecsStatus {
  const player = source.player;
  const debugInfo = player.getDebugInfo?.() ?? null;
  const reverseBounds = reverseFrameCacheBounds(source);
  return {
    sourceId: source.sourceId,
    ready: player.ready,
    width: player.width,
    height: player.height,
    frameRate: player.getFrameRate?.() ?? 0,
    currentTime: player.currentTime,
    hasFrame: player.hasFrame(),
    pendingSeekTime: player.getPendingSeekTime?.() ?? null,
    decodePending: player.isDecodePending?.() ?? false,
    decodeQueueSize: debugInfo?.decodeQueueSize,
    samplesLoaded: debugInfo?.samplesLoaded,
    sampleIndex: debugInfo?.sampleIndex,
    feedIndex: debugInfo?.feedIndex,
    frameBufferSize: debugInfo?.frameBufferSize,
    decoderState: debugInfo?.decoderState,
    currentFrameTimestampSeconds: debugInfo?.currentFrameTimestampSeconds,
    pendingSeekKind: debugInfo?.pendingSeekKind,
    pendingSeekTargetSeconds: debugInfo?.pendingSeekTargetSeconds,
    pendingSeekFeedEndIndex: debugInfo?.pendingSeekFeedEndIndex,
    decodeErrorCount: debugInfo?.decodeErrorCount,
    lastDecodeError: debugInfo?.lastDecodeError,
    lastError: source.lastError,
    decodedFrameCount: source.decodedFrameCount,
    lastDecodedFrameTimestampSeconds: source.lastDecodedFrameTimestampSeconds,
    reverseFrameCacheSize: source.reverseFrameCache.size,
    reverseCaptureTargetSeconds: source.reverseCaptureTargetSeconds,
    reverseFrameCacheMinTimestampSeconds: reverseBounds?.minTimestampSeconds ?? null,
    reverseFrameCacheMaxTimestampSeconds: reverseBounds?.maxTimestampSeconds ?? null,
    lastSeekPlan: debugInfo?.lastSeekPlan,
  };
}

async function waitForReady(player: WebCodecsPlayer, timeoutMs: number): Promise<void> {
  const startedAt = performance.now();
  while (!player.ready && performance.now() - startedAt < timeoutMs) {
    await sleep(8);
  }
}

async function waitForFrame(player: WebCodecsPlayer, timeoutMs: number): Promise<VideoFrame | null> {
  const startedAt = performance.now();
  let frame = player.getCurrentFrame();
  while (!frame && performance.now() - startedAt < timeoutMs) {
    await sleep(4);
    frame = player.getCurrentFrame();
  }
  return frame;
}

function frameTimestampSeconds(frame: VideoFrame | null): number | null {
  return frame ? frame.timestamp / 1_000_000 : null;
}

function frameRateForPlayer(player: WebCodecsPlayer): number {
  return Math.max(player.getFrameRate?.() ?? 0, 1);
}

function shouldClearStreamPresentedTimestampForSeek(
  source: WorkerWebCodecsSource,
  timeSeconds: number,
): boolean {
  const lastPresented = source.stream.lastPresentedTimestampSeconds;
  if (lastPresented === null) {
    return false;
  }
  const frameInterval = 1 / frameRateForPlayer(source.player);
  return Math.abs(lastPresented - timeSeconds) > Math.max(0.08, frameInterval * 3);
}

function isTimestampNearTarget(
  timestampSeconds: number,
  targetTimeSeconds: number,
  frameIntervalSeconds: number,
  toleranceFrames: number,
): boolean {
  return Math.abs(timestampSeconds - targetTimeSeconds) <= frameIntervalSeconds * toleranceFrames;
}

function isTimestampAdvanced(
  timestampSeconds: number,
  previousTimestampSeconds: number | null,
  frameIntervalSeconds: number,
): boolean {
  return previousTimestampSeconds !== null &&
    timestampSeconds > previousTimestampSeconds + frameIntervalSeconds * 0.5;
}

function closeReverseFrameCache(source: WorkerWebCodecsSource): void {
  for (const entry of source.reverseFrameCache.values()) {
    try {
      entry.frame.close();
    } catch {
      // Ignore already-closed cached frames.
    }
  }
  source.reverseFrameCache.clear();
}

function reverseFrameCacheKey(timestampSeconds: number): string {
  return String(Math.round(timestampSeconds * 1_000_000));
}

function reverseCacheFrameDimensions(frame: VideoFrame): { width: number; height: number } | null {
  const width = frame.displayWidth || frame.codedWidth;
  const height = frame.displayHeight || frame.codedHeight;
  return width > 0 && height > 0 ? { width, height } : null;
}

function pruneReverseFrameCache(source: WorkerWebCodecsSource): void {
  const captureTarget = source.reverseCaptureTargetSeconds;
  const frameRate = frameRateForPlayer(source.player);
  const frameIntervalSeconds = 1 / frameRate;
  const keepWindowSeconds = Math.max(frameIntervalSeconds, (REVERSE_FRAME_CACHE_LIMIT - 1) / frameRate);
  while (source.reverseFrameCache.size > REVERSE_FRAME_CACHE_LIMIT) {
    let evictKey: string | null = null;
    let evictScore = Number.NEGATIVE_INFINITY;
    for (const [key, entry] of source.reverseFrameCache) {
      let score: number;
      if (captureTarget !== null) {
        const keepMin = captureTarget - keepWindowSeconds;
        const keepMax = captureTarget + frameIntervalSeconds * 2;
        if (entry.timestampSeconds > keepMax) {
          score = 1_000 + (entry.timestampSeconds - keepMax);
        } else if (entry.timestampSeconds < keepMin) {
          score = 500 + (keepMin - entry.timestampSeconds);
        } else {
          score = Math.max(0, entry.timestampSeconds - captureTarget);
        }
      } else {
        score = -entry.lastAccessedAt;
      }
      if (score > evictScore) {
        evictKey = key;
        evictScore = score;
      }
    }
    if (!evictKey) return;
    const evicted = source.reverseFrameCache.get(evictKey);
    source.reverseFrameCache.delete(evictKey);
    try {
      evicted?.frame.close();
    } catch {
      // Ignore already-closed cached frames.
    }
  }
}

function rememberReverseDecodedFrame(source: WorkerWebCodecsSource, frame: VideoFrame): void {
  const captureTarget = source.reverseCaptureTargetSeconds;
  if (captureTarget === null) return;

  const timestampSeconds = frameTimestampSeconds(frame);
  const dimensions = reverseCacheFrameDimensions(frame);
  if (timestampSeconds === null || !dimensions) return;
  if (timestampSeconds > captureTarget + 0.08) return;
  if (timestampSeconds < captureTarget - REVERSE_FRAME_CACHE_LOOKBACK_SECONDS) return;

  let clone: VideoFrame | null = null;
  try {
    clone = typeof frame.clone === 'function'
      ? frame.clone()
      : null;
  } catch (error) {
    source.lastError = error instanceof Error ? error.message : String(error);
    return;
  }
  if (!clone) return;

  const key = reverseFrameCacheKey(timestampSeconds);
  const existing = source.reverseFrameCache.get(key);
  if (existing?.frame !== clone) {
    try {
      existing?.frame.close();
    } catch {
      // Ignore already-closed cached frames.
    }
  }
  source.reverseFrameCache.set(key, {
    frame: clone,
    timestampSeconds,
    width: dimensions.width,
    height: dimensions.height,
    lastAccessedAt: performance.now(),
  });
  pruneReverseFrameCache(source);
}

function findReverseCacheEntry(
  source: WorkerWebCodecsSource,
  timeSeconds: number,
  options: {
    readonly maxTimestampSeconds?: number | null;
  } = {},
): ReverseFrameCacheEntry | null {
  const frameRate = frameRateForPlayer(source.player);
  const toleranceSeconds = Math.max(0.045, Math.min(0.08, 1.5 / frameRate));
  const maxTimestampSeconds =
    typeof options.maxTimestampSeconds === 'number' && Number.isFinite(options.maxTimestampSeconds)
      ? options.maxTimestampSeconds
      : null;
  let best: ReverseFrameCacheEntry | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const entry of source.reverseFrameCache.values()) {
    if (maxTimestampSeconds !== null && entry.timestampSeconds > maxTimestampSeconds + 0.5 / frameRate) {
      continue;
    }
    const delta = Math.abs(entry.timestampSeconds - timeSeconds);
    if (delta < bestDelta) {
      best = entry;
      bestDelta = delta;
    }
  }
  if (!best || bestDelta > toleranceSeconds) {
    return null;
  }
  best.lastAccessedAt = performance.now();
  return best;
}

function reverseCaptureCoversTarget(
  source: WorkerWebCodecsSource,
  timeSeconds: number,
): boolean {
  const captureTarget = source.reverseCaptureTargetSeconds;
  if (captureTarget === null) {
    return false;
  }
  const frameRate = frameRateForPlayer(source.player);
  const forwardToleranceSeconds = Math.max(0.045, 2 / frameRate);
  const bounds = reverseFrameCacheBounds(source);
  if (bounds) {
    return timeSeconds >= bounds.minTimestampSeconds - forwardToleranceSeconds &&
      timeSeconds <= Math.max(bounds.maxTimestampSeconds, captureTarget) + forwardToleranceSeconds;
  }
  return timeSeconds <= captureTarget + forwardToleranceSeconds &&
    timeSeconds >= captureTarget - Math.max(REVERSE_PENDING_DECODE_WAIT_SECONDS, 24 / frameRate);
}

function reverseFrameCacheBounds(
  source: WorkerWebCodecsSource,
): { readonly minTimestampSeconds: number; readonly maxTimestampSeconds: number } | null {
  let minTimestampSeconds = Number.POSITIVE_INFINITY;
  let maxTimestampSeconds = Number.NEGATIVE_INFINITY;
  for (const entry of source.reverseFrameCache.values()) {
    minTimestampSeconds = Math.min(minTimestampSeconds, entry.timestampSeconds);
    maxTimestampSeconds = Math.max(maxTimestampSeconds, entry.timestampSeconds);
  }
  return Number.isFinite(minTimestampSeconds) && Number.isFinite(maxTimestampSeconds)
    ? { minTimestampSeconds, maxTimestampSeconds }
    : null;
}

async function waitForReverseVideoFrameCache(
  source: WorkerWebCodecsSource,
  timeSeconds: number,
  timeoutMs: number,
  maxTimestampSeconds?: number | null,
): Promise<WorkerWebCodecsGpuFrameReadResult | null> {
  const startedAt = performance.now();
  do {
    const cached = videoFrameResultFromReverseCache(source, timeSeconds, maxTimestampSeconds);
    if (cached) {
      return cached;
    }
    await sleep(2);
  } while (performance.now() - startedAt < timeoutMs);
  return videoFrameResultFromReverseCache(source, timeSeconds, maxTimestampSeconds);
}

function maybePrimeNextReverseCacheWindow(
  source: WorkerWebCodecsSource,
  timeSeconds: number,
): void {
  const bounds = reverseFrameCacheBounds(source);
  if (!bounds) {
    return;
  }
  const frameRate = frameRateForPlayer(source.player);
  const prefetchDistanceSeconds = Math.max(0.45, 24 / frameRate);
  const decodePending = source.player.isDecodePending?.() === true;
  const captureTarget = source.reverseCaptureTargetSeconds;
  if (
    decodePending &&
    (
      captureTarget === null ||
      timeSeconds >= captureTarget - prefetchDistanceSeconds * 1.5
    )
  ) {
    return;
  }
  if (bounds.maxTimestampSeconds - bounds.minTimestampSeconds < prefetchDistanceSeconds) {
    return;
  }
  if (timeSeconds > bounds.minTimestampSeconds + prefetchDistanceSeconds) {
    return;
  }
  if (
    captureTarget !== null &&
    Math.abs(captureTarget - timeSeconds) <= prefetchDistanceSeconds * 0.5
  ) {
    return;
  }

  const captureTargetSeconds = reverseCaptureTargetForRead(source, timeSeconds, bounds.maxTimestampSeconds);
  source.reverseCaptureTargetSeconds = captureTargetSeconds;
  void applySeek(source.player, 'reverse', captureTargetSeconds)
    .then(() => {
      source.lastError = null;
    })
    .catch((error: unknown) => {
      source.lastError = error instanceof Error ? error.message : String(error);
    });
}

function reverseCaptureTargetForRead(
  source: WorkerWebCodecsSource,
  timeSeconds: number,
  previousTimestampSeconds: number | null | undefined,
): number {
  if (
    typeof previousTimestampSeconds !== 'number' ||
    !Number.isFinite(previousTimestampSeconds) ||
    previousTimestampSeconds <= timeSeconds
  ) {
    return timeSeconds;
  }
  const frameRate = frameRateForPlayer(source.player);
  return timeSeconds + Math.max(0.45, 24 / frameRate);
}

async function bitmapResultFromReverseCache(
  source: WorkerWebCodecsSource,
  timeSeconds: number,
): Promise<WorkerRenderHostWebCodecsResult | null> {
  const entry = findReverseCacheEntry(source, timeSeconds);
  if (!entry || typeof createImageBitmap !== 'function') {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(entry.frame);
    source.lastError = null;
  } catch (error) {
    source.lastError = error instanceof Error ? error.message : String(error);
    return null;
  }
  return {
    status: statusForSource(source),
    frame: {
      sourceId: source.sourceId,
      bitmap,
      width: bitmap.width || entry.width,
      height: bitmap.height || entry.height,
      timestampSeconds: entry.timestampSeconds,
    },
  };
}

function videoFrameResultFromReverseCache(
  source: WorkerWebCodecsSource,
  timeSeconds: number,
  maxTimestampSeconds?: number | null,
): WorkerWebCodecsGpuFrameReadResult | null {
  const entry = findReverseCacheEntry(source, timeSeconds, { maxTimestampSeconds });
  if (!entry) {
    return null;
  }
  return {
    status: statusForSource(source),
    frame: entry.frame,
    width: entry.width,
    height: entry.height,
    timestampSeconds: entry.timestampSeconds,
    error: null,
  };
}

function heldVideoFrameResultForSource(
  source: WorkerWebCodecsSource,
): WorkerWebCodecsGpuFrameReadResult | null {
  const frame = source.player.getCurrentFrame();
  const dimensions = frame ? reverseCacheFrameDimensions(frame) : null;
  if (!frame || !dimensions) {
    return null;
  }
  return {
    status: statusForSource(source),
    frame,
    width: dimensions.width,
    height: dimensions.height,
    timestampSeconds: frameTimestampSeconds(frame),
    error: null,
  };
}

function heldStreamVideoFrameResultForSource(
  source: WorkerWebCodecsSource,
  targetTimeSeconds: number,
): WorkerWebCodecsGpuFrameReadResult | null {
  const held = heldVideoFrameResultForSource(source);
  if (!held || held.timestampSeconds === null) {
    return held;
  }

  const frameIntervalSeconds = 1 / frameRateForPlayer(source.player);
  const maxHoldSeconds = Math.max(0.12, frameIntervalSeconds * 6);
  return Math.abs(held.timestampSeconds - targetTimeSeconds) <= maxHoldSeconds
    ? held
    : null;
}

export function pauseWorkerWebCodecsPlaybackForSource(sourceId: string): void {
  const source = sources.get(sourceId);
  if (!source) return;
  source.player.pause();
  pauseWorkerWebCodecsStream(source.stream, { clearPresentedTimestamp: true });
}

function reverseMonotonicMaxTimestampSeconds(
  source: WorkerWebCodecsSource,
  previousPresentedTimestampSeconds: number | null | undefined,
): number | null {
  if (typeof previousPresentedTimestampSeconds !== 'number' || !Number.isFinite(previousPresentedTimestampSeconds)) {
    return null;
  }
  return previousPresentedTimestampSeconds + 0.5 / frameRateForPlayer(source.player);
}

function reverseFrameWouldMoveForward(
  source: WorkerWebCodecsSource,
  timestampSeconds: number | null,
  previousPresentedTimestampSeconds: number | null | undefined,
): boolean {
  const maxTimestampSeconds = reverseMonotonicMaxTimestampSeconds(source, previousPresentedTimestampSeconds);
  return maxTimestampSeconds !== null &&
    timestampSeconds !== null &&
    timestampSeconds > maxTimestampSeconds;
}

function isFrameUsefulForInteractiveRead(input: {
  readonly frame: VideoFrame;
  readonly frameRate: number;
  readonly mode: WorkerRenderHostWebCodecsSeekMode;
  readonly previousTimestampSeconds: number | null;
  readonly targetTimeSeconds: number;
}): boolean {
  const timestampSeconds = frameTimestampSeconds(input.frame);
  if (timestampSeconds === null) return false;
  if (input.mode === 'stream') {
    const frameInterval = 1 / input.frameRate;
    const advanced = isTimestampAdvanced(timestampSeconds, input.previousTimestampSeconds, frameInterval);
    if (input.previousTimestampSeconds !== null && !advanced) {
      return isTimestampNearTarget(timestampSeconds, input.targetTimeSeconds, frameInterval, 0.55);
    }
    if (isTimestampNearTarget(timestampSeconds, input.targetTimeSeconds, frameInterval, 2)) {
      return true;
    }
    return timestampSeconds <= input.targetTimeSeconds + frameInterval * 2 &&
      advanced;
  }
  if (input.mode === 'seek') {
    const frameInterval = 1 / input.frameRate;
    return isTimestampNearTarget(timestampSeconds, input.targetTimeSeconds, frameInterval, 0.55);
  }
  if (input.mode === 'reverse') {
    const frameInterval = 1 / input.frameRate;
    return isTimestampNearTarget(timestampSeconds, input.targetTimeSeconds, frameInterval, 1.5);
  }

  const frameInterval = 1 / input.frameRate;
  const targetDistance = Math.abs(timestampSeconds - input.targetTimeSeconds);
  if (targetDistance <= frameInterval * (input.mode === 'fast' ? 15 : 3)) {
    return true;
  }

  if (input.previousTimestampSeconds === null) {
    return input.mode === 'scrub' && targetDistance <= frameInterval * 12;
  }

  const previousDistance = Math.abs(input.previousTimestampSeconds - input.targetTimeSeconds);
  const improvedEnough = targetDistance + frameInterval * 0.25 < previousDistance;
  const changedFrame = Math.abs(timestampSeconds - input.previousTimestampSeconds) >= frameInterval * 0.5;
  return improvedEnough || changedFrame;
}

async function waitForInteractiveFrame(input: {
  readonly player: WebCodecsPlayer;
  readonly mode: WorkerRenderHostWebCodecsSeekMode;
  readonly targetTimeSeconds: number;
  readonly previousTimestampSeconds: number | null;
  readonly timeoutMs: number;
}): Promise<VideoFrame | null> {
  const startedAt = performance.now();
  const frameRate = frameRateForPlayer(input.player);
  while (performance.now() - startedAt < input.timeoutMs) {
    const promotedFrame = input.mode === 'seek' || input.mode === 'scrub'
      ? input.player.promoteBufferedFrameNearTime?.(input.targetTimeSeconds)
      : null;
    if (
      promotedFrame &&
      isFrameUsefulForInteractiveRead({
        frame: promotedFrame,
        frameRate,
        mode: input.mode,
        previousTimestampSeconds: input.previousTimestampSeconds,
        targetTimeSeconds: input.targetTimeSeconds,
      })
    ) {
      return promotedFrame;
    }

    const frame = input.player.getCurrentFrame();
    if (
      frame &&
      isFrameUsefulForInteractiveRead({
        frame,
        frameRate,
        mode: input.mode,
        previousTimestampSeconds: input.previousTimestampSeconds,
        targetTimeSeconds: input.targetTimeSeconds,
      })
    ) {
      return frame;
    }
    await sleep(4);
  }
  const fallbackFrame = input.player.getCurrentFrame();
  return fallbackFrame &&
    isFrameUsefulForInteractiveRead({
      frame: fallbackFrame,
      frameRate,
      mode: input.mode,
      previousTimestampSeconds: input.previousTimestampSeconds,
      targetTimeSeconds: input.targetTimeSeconds,
    })
    ? fallbackFrame
    : null;
}

async function applySeek(
  player: WebCodecsPlayer,
  mode: WorkerRenderHostWebCodecsSeekMode,
  timeSeconds: number,
): Promise<void> {
  if (mode === 'advance') {
    player.advanceToTime?.(timeSeconds);
    return;
  }
  if (mode === 'stream') {
    return;
  }
  if (mode === 'reverse') {
    if (player.isPlaying) {
      player.pause();
    }
    player.seek(timeSeconds, { previewMode: 'strict' });
    return;
  }
  if (mode === 'fast') {
    player.fastSeek?.(timeSeconds);
    return;
  }
  if (mode === 'scrub') {
    player.scrubSeek?.(timeSeconds);
    return;
  }
  if (player.isPlaying) {
    player.pause();
  }
  player.seek(timeSeconds, { previewMode: 'interactive-preroll' });
}

function targetTimeSecondsForInteractiveRead(
  source: WorkerWebCodecsSource,
  mode: WorkerRenderHostWebCodecsSeekMode,
  requestedTimeSeconds: number,
): number {
  if (mode !== 'seek' && mode !== 'scrub') {
    return requestedTimeSeconds;
  }

  const pendingSeekTime = source.player.getPendingSeekTime?.();
  if (typeof pendingSeekTime === 'number' && Number.isFinite(pendingSeekTime)) {
    return pendingSeekTime;
  }

  const lastSeekPlan = source.player.getDebugInfo?.()?.lastSeekPlan;
  const targetSampleTimeSeconds = lastSeekPlan?.targetSampleTimeSeconds;
  const targetTimeSeconds = lastSeekPlan?.targetTimeSeconds;
  const frameIntervalSeconds = 1 / frameRateForPlayer(source.player);
  if (
    typeof targetSampleTimeSeconds === 'number' &&
    Number.isFinite(targetSampleTimeSeconds) &&
    typeof targetTimeSeconds === 'number' &&
    Number.isFinite(targetTimeSeconds) &&
    Math.abs(targetTimeSeconds - requestedTimeSeconds) <= Math.max(0.1, frameIntervalSeconds * 3)
  ) {
    return targetSampleTimeSeconds;
  }

  return requestedTimeSeconds;
}

async function bitmapResultForSource(
  source: WorkerWebCodecsSource,
  timeoutMs: number,
  read?: {
    readonly mode: WorkerRenderHostWebCodecsSeekMode;
    readonly targetTimeSeconds: number;
    readonly previousTimestampSeconds: number | null;
  },
): Promise<WorkerRenderHostWebCodecsResult> {
  const frame = read
    ? await waitForInteractiveFrame({
        player: source.player,
        mode: read.mode,
        targetTimeSeconds: read.targetTimeSeconds,
        previousTimestampSeconds: read.previousTimestampSeconds,
        timeoutMs,
      })
    : await waitForFrame(source.player, timeoutMs);
  if (!frame || typeof createImageBitmap !== 'function') {
    return {
      status: statusForSource(source),
      frame: null,
    };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(frame);
    source.lastError = null;
  } catch (error) {
    source.lastError = error instanceof Error ? error.message : String(error);
    return {
      status: statusForSource(source),
      frame: null,
    };
  }
  return {
    status: statusForSource(source),
    frame: {
      sourceId: source.sourceId,
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      timestampSeconds: frame.timestamp / 1_000_000,
    },
  };
}

async function loadSource(command: Extract<WorkerWebCodecsCommand, { readonly type: 'loadWebCodecsSource' }>) {
  sources.get(command.sourceId)?.player.destroy?.();
  const sourceRef: { current: WorkerWebCodecsSource | null } = { current: null };
  const player = new WebCodecsPlayer({
    loop: false,
    hardwareAcceleration: command.hardwareAcceleration ?? 'prefer-software',
    useSimpleMode: false,
    onDecodedFrame: (frame) => {
      const source = sourceRef.current;
      if (!source) return;
      source.decodedFrameCount += 1;
      source.lastDecodedFrameTimestampSeconds = frameTimestampSeconds(frame);
      rememberReverseDecodedFrame(source, frame);
    },
  });
  const source: WorkerWebCodecsSource = {
    sourceId: command.sourceId,
    player,
    reverseFrameCache: new Map(),
    lastError: null,
    reverseCaptureTargetSeconds: null,
    decodedFrameCount: 0,
    lastDecodedFrameTimestampSeconds: null,
    stream: createWorkerWebCodecsStreamState(),
  };
  sourceRef.current = source;
  sources.set(command.sourceId, source);
  await source.player.loadArrayBuffer(command.buffer);
  await waitForReady(source.player, 2000);
  const webCodecs = command.returnBitmap === false
    ? {
        status: statusForSource(source),
        frame: null,
      }
    : await bitmapResultForSource(source, 120);
  return {
    statusEvents: [commandAccepted(command)],
    presentedFrameId: null,
    webCodecs,
  };
}

async function readFrame(command: Extract<WorkerWebCodecsCommand, { readonly type: 'readWebCodecsFrame' }>) {
  const source = sources.get(command.sourceId);
  if (!source) {
    throw new Error(`Worker WebCodecs source not loaded: ${command.sourceId}`);
  }
  const isReverseRead = command.mode === 'reverse';
  if (command.mode !== 'stream') {
    pauseWorkerWebCodecsStream(source.stream, {
      clearPresentedTimestamp: command.mode !== 'seek',
    });
  }
  if (command.mode === 'reverse') {
    const cached = await bitmapResultFromReverseCache(source, command.timeSeconds);
    if (cached?.frame) {
      return {
        statusEvents: [commandAccepted(command)],
        presentedFrameId: null,
        webCodecs: cached,
      };
    }
  }
  const previousTimestampSeconds = frameTimestampSeconds(source.player.getCurrentFrame());
  let result: WorkerRenderHostWebCodecsResult;
  try {
    const reverseCaptureTargetSeconds = isReverseRead
      ? reverseCaptureTargetForRead(source, command.timeSeconds, previousTimestampSeconds)
      : null;
    source.reverseCaptureTargetSeconds = reverseCaptureTargetSeconds;
    await applySeek(source.player, command.mode, reverseCaptureTargetSeconds ?? command.timeSeconds);
    source.lastError = null;
  } catch (error) {
    source.lastError = error instanceof Error ? error.message : String(error);
  }

  try {
    result = await bitmapResultForSource(source, command.timeoutMs ?? 180, {
      mode: command.mode,
      targetTimeSeconds: targetTimeSecondsForInteractiveRead(source, command.mode, command.timeSeconds),
      previousTimestampSeconds,
    });
    if (!result.frame && isReverseRead) {
      result = await bitmapResultFromReverseCache(source, command.timeSeconds) ?? result;
    }
  } finally {
    if (!isReverseRead) {
      source.reverseCaptureTargetSeconds = null;
    }
  }

  return {
    statusEvents: [commandAccepted(command)],
    presentedFrameId: null,
    webCodecs: result,
  };
}

function disposeSource(command: Extract<WorkerWebCodecsCommand, { readonly type: 'disposeWebCodecsSource' }>) {
  const source = sources.get(command.sourceId);
  if (source) {
    source.reverseCaptureTargetSeconds = null;
    closeReverseFrameCache(source);
  }
  source?.player.destroy?.();
  sources.delete(command.sourceId);
  return {
    statusEvents: [commandAccepted(command)],
    presentedFrameId: null,
    webCodecs: null,
  };
}

export function isWorkerWebCodecsCommand(command: WorkerRenderHostRuntimeCommand): command is WorkerWebCodecsCommand {
  return command.type === 'loadWebCodecsSource'
    || command.type === 'readWebCodecsFrame'
    || command.type === 'disposeWebCodecsSource';
}

export async function acceptWorkerWebCodecsCommand(
  command: WorkerWebCodecsCommand,
): Promise<WorkerRenderHostRuntimeWebCodecsResult> {
  if (command.type === 'loadWebCodecsSource') {
    return loadSource(command);
  }
  if (command.type === 'readWebCodecsFrame') {
    return readFrame(command);
  }
  return disposeSource(command);
}

export async function readWorkerWebCodecsVideoFrameForGpuPresentation(input: {
  readonly sourceId: string;
  readonly timeSeconds: number;
  readonly mode: WorkerRenderHostWebCodecsSeekMode;
  readonly timeoutMs?: number;
  readonly allowStreamHold?: boolean;
  readonly previousPresentedTimestampSeconds?: number | null;
  readonly allowStaleReverseHold?: boolean;
}): Promise<WorkerWebCodecsGpuFrameReadResult> {
  const source = sources.get(input.sourceId);
  if (!source) {
    return {
      status: null,
      frame: null,
      width: 0,
      height: 0,
      timestampSeconds: null,
      error: `Worker WebCodecs source not loaded: ${input.sourceId}`,
    };
  }

  const previousTimestampSeconds = frameTimestampSeconds(source.player.getCurrentFrame());
  if (input.mode === 'stream') {
    const streamRead = await readWorkerWebCodecsStreamFrame({
      player: source.player,
      state: source.stream,
      timeSeconds: input.timeSeconds,
      timeoutMs: input.timeoutMs,
    });
    const dimensions = streamRead.frame ? reverseCacheFrameDimensions(streamRead.frame) : null;
    if (!streamRead.frame && input.allowStreamHold === true) {
      const held = heldStreamVideoFrameResultForSource(source, input.timeSeconds);
      if (held) {
        source.stream.lastPresentedTimestampSeconds =
          held.timestampSeconds ?? source.stream.lastPresentedTimestampSeconds;
        return held;
      }
    }
    return {
      status: statusForSource(source),
      frame: streamRead.frame,
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
      timestampSeconds: streamRead.timestampSeconds,
      error: source.lastError,
    };
  }

  const clearStreamPresentedTimestamp =
    input.mode !== 'seek' ||
    shouldClearStreamPresentedTimestampForSeek(source, input.timeSeconds);
  pauseWorkerWebCodecsStream(source.stream, {
    clearPresentedTimestamp: clearStreamPresentedTimestamp,
  });
  if (input.mode === 'reverse') {
    const reverseMaxTimestampSeconds = reverseMonotonicMaxTimestampSeconds(
      source,
      input.previousPresentedTimestampSeconds,
    );
    const cached = videoFrameResultFromReverseCache(source, input.timeSeconds, reverseMaxTimestampSeconds);
    if (cached) {
      maybePrimeNextReverseCacheWindow(source, input.timeSeconds);
      return cached;
    }
    if (
      reverseCaptureCoversTarget(source, input.timeSeconds) &&
      source.player.isDecodePending?.() === true
    ) {
      const pendingCached = await waitForReverseVideoFrameCache(
        source,
        input.timeSeconds,
        Math.min(input.timeoutMs ?? 0, 48),
        reverseMaxTimestampSeconds,
      );
      if (pendingCached) {
        return pendingCached;
      }
      const held = input.allowStaleReverseHold === false
        ? null
        : heldVideoFrameResultForSource(source);
      if (held && reverseFrameWouldMoveForward(source, held.timestampSeconds, input.previousPresentedTimestampSeconds)) {
        return {
          status: statusForSource(source),
          frame: null,
          width: 0,
          height: 0,
          timestampSeconds: null,
          error: null,
        };
      }
      return held ?? {
        status: statusForSource(source),
        frame: null,
        width: 0,
        height: 0,
        timestampSeconds: null,
        error: null,
      };
    }
  }
  const reverseCaptureTargetSeconds = input.mode === 'reverse'
    ? reverseCaptureTargetForRead(source, input.timeSeconds, input.previousPresentedTimestampSeconds)
    : null;
  source.reverseCaptureTargetSeconds = reverseCaptureTargetSeconds;
  try {
    await applySeek(source.player, input.mode, reverseCaptureTargetSeconds ?? input.timeSeconds);
    source.lastError = null;
  } catch (error) {
    source.lastError = error instanceof Error ? error.message : String(error);
  }

  const frame = await waitForInteractiveFrame({
    player: source.player,
    mode: input.mode,
    targetTimeSeconds: targetTimeSecondsForInteractiveRead(source, input.mode, input.timeSeconds),
    previousTimestampSeconds,
    timeoutMs: input.timeoutMs ?? 80,
  });
  if (
    input.mode === 'reverse' &&
    reverseFrameWouldMoveForward(source, frameTimestampSeconds(frame), input.previousPresentedTimestampSeconds)
  ) {
    return {
      status: statusForSource(source),
      frame: null,
      width: 0,
      height: 0,
      timestampSeconds: null,
      error: null,
    };
  }
  if (!frame && input.mode === 'reverse') {
    const cached = videoFrameResultFromReverseCache(
      source,
      input.timeSeconds,
      reverseMonotonicMaxTimestampSeconds(source, input.previousPresentedTimestampSeconds),
    );
    if (cached) {
      return cached;
    }
    const held = input.allowStaleReverseHold === false
      ? null
      : heldVideoFrameResultForSource(source);
    if (held && reverseFrameWouldMoveForward(source, held.timestampSeconds, input.previousPresentedTimestampSeconds)) {
      return {
        status: statusForSource(source),
        frame: null,
        width: 0,
        height: 0,
        timestampSeconds: null,
        error: null,
      };
    }
    if (held) {
      return held;
    }
  }
  const presentableFrame = frame;
  const dimensions = presentableFrame ? reverseCacheFrameDimensions(presentableFrame) : null;
  const timestampSeconds = frameTimestampSeconds(presentableFrame);
  if (input.mode === 'seek') {
    source.stream.lastPresentedTimestampSeconds =
      timestampSeconds ?? (clearStreamPresentedTimestamp ? null : source.stream.lastPresentedTimestampSeconds);
  }
  return {
    status: statusForSource(source),
    frame: presentableFrame,
    width: dimensions?.width ?? 0,
    height: dimensions?.height ?? 0,
    timestampSeconds,
    error: source.lastError,
  };
}

export function resetWorkerWebCodecsRuntime(): void {
  for (const source of sources.values()) {
    closeReverseFrameCache(source);
    source.player.destroy?.();
  }
  sources.clear();
}
