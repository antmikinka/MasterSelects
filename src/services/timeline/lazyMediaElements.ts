import type { TimelineClip } from '../../types';
import { engine } from '../../engine/WebGPUEngine';
import type { FrameContext } from '../layerBuilder/types';
import { Logger } from '../logger';

type LazyMediaKind = 'video' | 'audio';

interface LazyMediaRecord {
  clipId: string;
  kind: LazyMediaKind;
  element: HTMLVideoElement | HTMLAudioElement;
  mediaFileId?: string;
  objectUrl?: string;
  sourceUrl?: string;
  lastDesiredAt: number;
  createdAt: number;
}

const log = Logger.create('LazyMediaElements');

const VIDEO_LOOKBEHIND_SECONDS = 0.35;
const VIDEO_LOOKAHEAD_SECONDS = 2.0;
const AUDIO_LOOKBEHIND_SECONDS = 0.2;
const AUDIO_LOOKAHEAD_SECONDS = 1.25;
const IDLE_RELEASE_MS = 1800;
const MAX_LAZY_MEDIA_ELEMENTS = 24;
const MAX_DESIRED_CLIPS_PER_TRACK = 3;

const lazyMediaRecords = new Map<string, LazyMediaRecord>();

function getRecordKey(kind: LazyMediaKind, clipId: string): string {
  return `${kind}:${clipId}`;
}

function getUsableFile(file: File | undefined): File | undefined {
  return file && (typeof file.size !== 'number' || file.size > 0) ? file : undefined;
}

function getMediaFileForLazyClip(ctx: FrameContext, clip: TimelineClip) {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (mediaFileId) {
    const mediaFile = ctx.mediaFileById.get(mediaFileId);
    if (mediaFile) return mediaFile;
  }

  return clip.name ? ctx.mediaFileByName.get(clip.name.replace(/ \(Audio\)$/, '')) ?? ctx.mediaFileByName.get(clip.name) : undefined;
}

function getLazySource(ctx: FrameContext, clip: TimelineClip): { url: string; objectUrl?: string } | null {
  const mediaFile = getMediaFileForLazyClip(ctx, clip);
  if (mediaFile?.url) {
    return { url: mediaFile.url };
  }

  const file = getUsableFile(clip.file) ?? getUsableFile(clip.source?.file) ?? getUsableFile(mediaFile?.file);
  if (file) {
    const objectUrl = URL.createObjectURL(file);
    return { url: objectUrl, objectUrl };
  }

  const url = mediaFile?.url;
  return url ? { url } : null;
}

function updateNaturalDuration(
  clip: TimelineClip,
  element: HTMLMediaElement,
  ctx: FrameContext,
): void {
  if (!Number.isFinite(element.duration) || element.duration <= 0) return;
  if (!clip.source) return;

  const mediaFile = getMediaFileForLazyClip(ctx, clip);
  const naturalDuration = element.duration;
  clip.source.naturalDuration = naturalDuration;
  if (!Number.isFinite(mediaFile?.duration) && naturalDuration > 0) {
    // Media store duration updates are handled by project/import code. This keeps
    // the active runtime clip accurate without forcing a broad store write.
    clip.duration = clip.duration || naturalDuration;
    clip.outPoint = clip.outPoint || naturalDuration;
  }
}

function createVideoElement(url: string, preload: HTMLMediaElement['preload']): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = url;
  video.preload = preload;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  return video;
}

function createAudioElement(url: string, preload: HTMLMediaElement['preload']): HTMLAudioElement {
  const audio = document.createElement('audio');
  audio.src = url;
  audio.preload = preload;
  return audio;
}

function attachVideoElement(ctx: FrameContext, clip: TimelineClip, now: number): void {
  if (!clip.source || clip.source.type !== 'video' || clip.source.videoElement || clip.source.nativeDecoder) return;

  const source = getLazySource(ctx, clip);
  if (!source) return;

  const video = createVideoElement(source.url, ctx.isPlaying ? 'auto' : 'metadata');
  const key = getRecordKey('video', clip.id);
  const mediaFile = getMediaFileForLazyClip(ctx, clip);
  lazyMediaRecords.set(key, {
    clipId: clip.id,
    kind: 'video',
    element: video,
    mediaFileId: clip.source.mediaFileId ?? clip.mediaFileId ?? mediaFile?.id,
    objectUrl: source.objectUrl,
    sourceUrl: source.url,
    lastDesiredAt: now,
    createdAt: now,
  });

  clip.source = {
    ...clip.source,
    videoElement: video,
    mediaFileId: clip.source.mediaFileId ?? clip.mediaFileId ?? mediaFile?.id,
    naturalDuration: clip.source.naturalDuration ?? mediaFile?.duration ?? clip.duration,
  };
  clip.isLoading = false;
  clip.needsReload = false;

  video.addEventListener('loadedmetadata', () => {
    updateNaturalDuration(clip, video, ctx);
  }, { once: true });
  video.load();
}

function attachAudioElement(ctx: FrameContext, clip: TimelineClip, now: number): void {
  if (!clip.source || clip.source.type !== 'audio' || clip.source.audioElement) return;

  const source = getLazySource(ctx, clip);
  if (!source) return;

  const audio = createAudioElement(source.url, ctx.isPlaying ? 'auto' : 'metadata');
  const key = getRecordKey('audio', clip.id);
  const mediaFile = getMediaFileForLazyClip(ctx, clip);
  lazyMediaRecords.set(key, {
    clipId: clip.id,
    kind: 'audio',
    element: audio,
    mediaFileId: clip.source.mediaFileId ?? clip.mediaFileId ?? mediaFile?.id,
    objectUrl: source.objectUrl,
    sourceUrl: source.url,
    lastDesiredAt: now,
    createdAt: now,
  });

  clip.source = {
    ...clip.source,
    audioElement: audio,
    mediaFileId: clip.source.mediaFileId ?? clip.mediaFileId ?? mediaFile?.id,
    naturalDuration: clip.source.naturalDuration ?? mediaFile?.duration ?? clip.duration,
  };
  clip.isLoading = false;
  clip.needsReload = false;

  audio.addEventListener('loadedmetadata', () => updateNaturalDuration(clip, audio, ctx), { once: true });
  audio.load();
}

function detachRecord(record: LazyMediaRecord, ctx: FrameContext): void {
  const clip = ctx.clips.find(candidate => candidate.id === record.clipId);
  const element = record.element;

  element.pause();
  if (record.kind === 'video') {
    engine.cleanupVideo(element as HTMLVideoElement);
  }
  element.removeAttribute('src');
  try {
    element.load();
  } catch {
    // Some browsers throw if load() runs during teardown; src removal is enough.
  }

  if (record.objectUrl) {
    URL.revokeObjectURL(record.objectUrl);
  }

  if (clip?.source) {
    if (record.kind === 'video' && clip.source.videoElement === element) {
      const nextSource = { ...clip.source };
      delete nextSource.videoElement;
      clip.source = nextSource;
    } else if (record.kind === 'audio' && clip.source.audioElement === element) {
      const nextSource = { ...clip.source };
      delete nextSource.audioElement;
      clip.source = nextSource;
    }
  }
}

function isClipInWindow(clip: TimelineClip, start: number, end: number): boolean {
  return clip.startTime < end && clip.startTime + clip.duration > start;
}

function markDesired(desired: Set<string>, kind: LazyMediaKind, clip: TimelineClip, now: number): void {
  const key = getRecordKey(kind, clip.id);
  desired.add(key);
  const record = lazyMediaRecords.get(key);
  if (record) {
    record.lastDesiredAt = now;
  }
}

function pruneLazyRecords(ctx: FrameContext, desired: Set<string>): void {
  const now = ctx.now;

  for (const [key, record] of lazyMediaRecords) {
    if (desired.has(key)) continue;
    if (now - record.lastDesiredAt < IDLE_RELEASE_MS) continue;
    detachRecord(record, ctx);
    lazyMediaRecords.delete(key);
  }

  if (lazyMediaRecords.size <= MAX_LAZY_MEDIA_ELEMENTS) return;

  const releasable = Array.from(lazyMediaRecords.entries())
    .filter(([key]) => !desired.has(key))
    .sort(([, a], [, b]) => a.lastDesiredAt - b.lastDesiredAt);

  for (const [key, record] of releasable) {
    if (lazyMediaRecords.size <= MAX_LAZY_MEDIA_ELEMENTS) break;
    detachRecord(record, ctx);
    lazyMediaRecords.delete(key);
  }
}

function getClipWindowRank(clip: TimelineClip, playheadPosition: number): number {
  const clipEnd = clip.startTime + clip.duration;
  if (clip.startTime <= playheadPosition && clipEnd > playheadPosition) {
    return Math.abs((clip.startTime + clipEnd) / 2 - playheadPosition) * 0.001;
  }
  if (clip.startTime > playheadPosition) {
    return 1 + clip.startTime - playheadPosition;
  }
  return 2 + playheadPosition - clipEnd;
}

function collectDesiredClips(
  ctx: FrameContext,
  kind: LazyMediaKind,
  trackIds: Set<string>,
  start: number,
  end: number,
): TimelineClip[] {
  const byTrack = new Map<string, TimelineClip[]>();

  for (const clip of ctx.clips) {
    if (!clip.source || clip.source.type !== kind) continue;
    if (!trackIds.has(clip.trackId)) continue;
    if (!isClipInWindow(clip, start, end)) continue;

    const trackClips = byTrack.get(clip.trackId);
    if (trackClips) {
      trackClips.push(clip);
    } else {
      byTrack.set(clip.trackId, [clip]);
    }
  }

  const selected: TimelineClip[] = [];
  for (const trackClips of byTrack.values()) {
    trackClips.sort((left, right) => {
      const rankDiff = getClipWindowRank(left, ctx.playheadPosition) - getClipWindowRank(right, ctx.playheadPosition);
      if (rankDiff !== 0) return rankDiff;
      return left.startTime - right.startTime;
    });
    selected.push(...trackClips.slice(0, MAX_DESIRED_CLIPS_PER_TRACK));
  }

  return selected;
}

export function hydrateTimelineMediaWindow(ctx: FrameContext): void {
  if (typeof document === 'undefined') return;

  const now = ctx.now;
  const desired = new Set<string>();
  const videoStart = ctx.playheadPosition - VIDEO_LOOKBEHIND_SECONDS;
  const videoEnd = ctx.playheadPosition + (ctx.isPlaying ? VIDEO_LOOKAHEAD_SECONDS : 0.8);
  const audioStart = ctx.playheadPosition - AUDIO_LOOKBEHIND_SECONDS;
  const audioEnd = ctx.playheadPosition + (ctx.isPlaying ? AUDIO_LOOKAHEAD_SECONDS : 0.4);

  for (const clip of collectDesiredClips(ctx, 'video', ctx.visibleVideoTrackIds, videoStart, videoEnd)) {
    markDesired(desired, 'video', clip, now);
    attachVideoElement(ctx, clip, now);
  }

  for (const clip of collectDesiredClips(ctx, 'audio', ctx.unmutedAudioTrackIds, audioStart, audioEnd)) {
    markDesired(desired, 'audio', clip, now);
    attachAudioElement(ctx, clip, now);
  }

  pruneLazyRecords(ctx, desired);
}

export function getLazyTimelineMediaElementCount(): number {
  return lazyMediaRecords.size;
}

export function releaseAllLazyTimelineMediaElements(): void {
  const fakeCtx = { clips: [], now: performance.now() } as unknown as FrameContext;
  for (const record of lazyMediaRecords.values()) {
    try {
      detachRecord(record, fakeCtx);
    } catch (error) {
      log.warn('Failed to detach lazy media element', error);
    }
  }
  lazyMediaRecords.clear();
}
