import { useTimelineStore } from '../../../../../stores/timeline';
import { useMediaStore } from '../../../../../stores/mediaStore';
import { useSettingsStore } from '../../../../../stores/settingsStore';
import { projectFileService } from '../../../../projectFileService';
import { getRuntimeDiagnostics } from '../../../../runtimeDiagnostics';
import { proxyFrameCache } from '../../../../proxyFrameCache';

export function summarizeNumberList(values: number[]): { count: number; avg: number; max: number; min: number } {
  if (values.length === 0) return { count: 0, avg: 0, max: 0, min: 0 };
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    avg: Math.round((sum / values.length) * 100) / 100,
    max: Math.round(Math.max(...values) * 100) / 100,
    min: Math.round(Math.min(...values) * 100) / 100,
  };
}

function roundTiming(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null;
}

export function summarizeLongAnimationFrameEntry(entry: PerformanceEntry, startedAt: number): Record<string, unknown> {
  const detail = entry as PerformanceEntry & {
    blockingDuration?: number;
    renderStart?: number;
    styleAndLayoutStart?: number;
    scripts?: Array<{
      duration?: number;
      executionStart?: number;
      forcedStyleAndLayoutDuration?: number;
      pauseDuration?: number;
      sourceURL?: string;
      sourceFunctionName?: string;
      invoker?: string;
      invokerType?: string;
    }>;
  };
  const scripts = Array.isArray(detail.scripts)
    ? detail.scripts
      .map(script => ({
        durationMs: roundTiming(script.duration),
        executionStartMs: roundTiming(typeof script.executionStart === 'number' ? script.executionStart - startedAt : undefined),
        forcedStyleAndLayoutMs: roundTiming(script.forcedStyleAndLayoutDuration),
        pauseMs: roundTiming(script.pauseDuration),
        sourceURL: typeof script.sourceURL === 'string' ? script.sourceURL.slice(-160) : null,
        sourceFunctionName: script.sourceFunctionName ?? null,
        invoker: script.invoker ?? null,
        invokerType: script.invokerType ?? null,
      }))
      .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
      .slice(0, 8)
    : [];

  return {
    name: entry.name,
    startTime: roundTiming(entry.startTime - startedAt),
    durationMs: roundTiming(entry.duration),
    blockingDurationMs: roundTiming(detail.blockingDuration),
    renderStartMs: roundTiming(typeof detail.renderStart === 'number' ? detail.renderStart - startedAt : undefined),
    styleAndLayoutStartMs: roundTiming(typeof detail.styleAndLayoutStart === 'number' ? detail.styleAndLayoutStart - startedAt : undefined),
    entryType: entry.entryType,
    scriptCount: Array.isArray(detail.scripts) ? detail.scripts.length : 0,
    scripts,
  };
}

function estimateByteLength(value: string): number {
  return new Blob([value]).size;
}

export function summarizeMediaWaveformPayloads() {
  return useMediaStore.getState().files
    .map((file) => {
      const aggregateLength = file.waveform?.length ?? 0;
      const channelLengths = file.waveformChannels?.map(channel => channel.length) ?? [];
      const totalLength = aggregateLength + channelLengths.reduce((sum, length) => sum + length, 0);
      return {
        id: file.id,
        name: file.name,
        type: file.type,
        waveformStatus: file.waveformStatus ?? null,
        aggregateLength,
        channelLengths,
        totalLength,
        hasAudioProxy: file.hasProxyAudio === true || file.audioProxyStatus === 'ready',
        audioAnalysisRefs: file.audioAnalysisRefs ?? null,
      };
    })
    .filter((entry) => entry.totalLength > 0 || entry.audioAnalysisRefs);
}

export function summarizeProxyAudioCache() {
  const cache = proxyFrameCache as unknown as {
    audioCache?: Map<string, HTMLAudioElement>;
    audioLoadingPromises?: Map<string, Promise<HTMLAudioElement | null>>;
    audioBufferCache?: Map<string, AudioBuffer>;
    audioBufferFailed?: Set<string>;
  };
  const mediaFileById = new Map(useMediaStore.getState().files.map((file) => [file.id, file]));
  const audioBuffers = Array.from(cache.audioBufferCache?.entries() ?? []).map(([mediaFileId, buffer]) => {
    const mediaFile = mediaFileById.get(mediaFileId);
    const approximateBytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    return {
      mediaFileId,
      name: mediaFile?.name ?? mediaFileId,
      duration: Math.round(buffer.duration * 100) / 100,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      frames: buffer.length,
      approximateBytes,
      approximateMb: Math.round((approximateBytes / 1024 / 1024) * 100) / 100,
    };
  });
  const totalAudioBufferBytes = audioBuffers.reduce((sum, entry) => sum + entry.approximateBytes, 0);
  return {
    audioElementCount: cache.audioCache?.size ?? 0,
    audioLoadingCount: cache.audioLoadingPromises?.size ?? 0,
    audioBufferCount: cache.audioBufferCache?.size ?? 0,
    audioBufferFailedCount: cache.audioBufferFailed?.size ?? 0,
    totalAudioBufferApproximateBytes: totalAudioBufferBytes,
    totalAudioBufferApproximateMb: Math.round((totalAudioBufferBytes / 1024 / 1024) * 100) / 100,
    audioBuffers,
  };
}

export function summarizePerformanceMemory() {
  const memory = (performance as unknown as {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }).memory;
  if (!memory) return null;
  return {
    usedJSHeapMb: Math.round((memory.usedJSHeapSize / 1024 / 1024) * 100) / 100,
    totalJSHeapMb: Math.round((memory.totalJSHeapSize / 1024 / 1024) * 100) / 100,
    jsHeapLimitMb: Math.round((memory.jsHeapSizeLimit / 1024 / 1024) * 100) / 100,
  };
}

export async function measureUiFrameLoop(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 5000;
  const expectedFrameMs = 1000 / 60;
  const startedAt = performance.now();
  const frames: Array<{ elapsedMs: number; deltaMs: number }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  const longAnimationFrames: Array<Record<string, unknown>> = [];
  const beforeCache = summarizeProxyAudioCache();
  const beforeMemory = summarizePerformanceMemory();
  let observer: PerformanceObserver | null = null;
  let animationFrameObserver: PerformanceObserver | null = null;
  let frameId: number | null = null;
  let previousFrameAt: number | null = null;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }

    try {
      animationFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longAnimationFrames.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      animationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      animationFrameObserver = null;
    }
  }

  try {
    await new Promise<void>((resolve) => {
      const tick = (timestamp: number) => {
        if (previousFrameAt !== null) {
          frames.push({
            elapsedMs: Math.round(timestamp - startedAt),
            deltaMs: Math.round((timestamp - previousFrameAt) * 100) / 100,
          });
        }
        previousFrameAt = timestamp;
        if (timestamp - startedAt >= durationMs) {
          resolve();
          return;
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
    });
  } finally {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    observer?.disconnect();
    animationFrameObserver?.disconnect();
  }

  const deltas = frames.map(frame => frame.deltaMs);
  const droppedFrameEstimate = deltas.reduce((sum, delta) => (
    sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
  ), 0);
  const slowFrames = frames.filter(frame => frame.deltaMs > expectedFrameMs * 1.75);
  const timelineState = useTimelineStore.getState();
  return {
    success: true,
    data: {
      durationMs,
      frameCount: frames.length,
      estimatedFps: Math.round((frames.length / Math.max(1, durationMs / 1000)) * 100) / 100,
      frameDeltaMs: summarizeNumberList(deltas),
      slowFrameCount: slowFrames.length,
      droppedFrameEstimate,
      longTaskCount: longTasks.length,
      longAnimationFrameCount: longAnimationFrames.length,
      longTasks,
      longAnimationFrames,
      beforeMemory,
      afterMemory: summarizePerformanceMemory(),
      beforeCache,
      afterCache: summarizeProxyAudioCache(),
      page: {
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
      },
      stemClipCount: timelineState.clips.filter((clip) => clip.audioState?.stemSeparation?.stems.length).length,
      selectedClipIds: Array.from(timelineState.selectedClipIds),
      frames: frames.slice(-240),
    },
  };
}

export async function measureIdleMainThread(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 10000;
  const sampleIntervalMs = typeof args.sampleIntervalMs === 'number' && Number.isFinite(args.sampleIntervalMs)
    ? Math.max(16, Math.min(1000, Math.round(args.sampleIntervalMs)))
    : 50;
  const timelineState = useTimelineStore.getState();
  const settingsState = useSettingsStore.getState();
  const projectData = projectFileService.getProjectData();
  const stemClips = timelineState.clips.filter((clip) => clip.audioState?.stemSeparation?.stems.length);
  const stemWaveformLengths = stemClips.flatMap((clip) =>
    clip.audioState?.stemSeparation?.stems.map((stem) => ({
      clipId: clip.id,
      label: stem.label,
      waveformLength: stem.waveform?.length ?? 0,
      mediaFileId: stem.mediaFileId ?? null,
    })) ?? []
  );
  const samples: Array<{ elapsedMs: number; gapMs: number }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  let observer: PerformanceObserver | null = null;
  let timerId: number | null = null;
  const startedAt = performance.now();
  let last = startedAt;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }
  }

  try {
    timerId = window.setInterval(() => {
      const now = performance.now();
      samples.push({
        elapsedMs: Math.round(now - startedAt),
        gapMs: Math.round((now - last) * 100) / 100,
      });
      last = now;
    }, sampleIntervalMs);

    await new Promise((resolve) => window.setTimeout(resolve, durationMs));
  } finally {
    if (timerId !== null) window.clearInterval(timerId);
    observer?.disconnect();
  }

  let stringifyMs = 0;
  let projectJsonBytes = 0;
  if (projectData) {
    const stringifyStartedAt = performance.now();
    const json = JSON.stringify(projectData);
    stringifyMs = performance.now() - stringifyStartedAt;
    projectJsonBytes = estimateByteLength(json);
  }

  const gapValues = samples.map((sample) => sample.gapMs);
  return {
    success: true,
    data: {
      durationMs,
      sampleIntervalMs,
      saveMode: settingsState.saveMode,
      autosaveEnabled: settingsState.autosaveEnabled,
      autosaveInterval: settingsState.autosaveInterval,
      projectOpen: projectFileService.isProjectOpen(),
      projectDirty: projectFileService.hasUnsavedChanges(),
      projectJsonBytes,
      projectStringifyMs: Math.round(stringifyMs * 100) / 100,
      stemClipCount: stemClips.length,
      stemWaveformLengths,
      mediaWaveforms: summarizeMediaWaveformPayloads(),
      sampleGapMs: summarizeNumberList(gapValues),
      overBudgetCount: gapValues.filter((gap) => gap > sampleIntervalMs * 1.75).length,
      longTasks,
      samples: samples.slice(-120),
      runtimeWarnings: getRuntimeDiagnostics({ limit: 40, level: 'WARN' }),
    },
  };
}
