import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClipDragPreview } from '../../stores/timeline/types';
import {
  thumbnailCacheService,
  type ThumbnailStatus,
} from '../thumbnailCacheService';
import {
  createThumbnailGenerationCoalescingKey,
  formatTimelineCacheCoalescingKey,
} from './cacheSchedulerContracts';
import type { VisibleTimelineThumbnailRef } from './timelineThumbnailDbWarmup';
import {
  clearTimelineWarmupTimers,
  getTimelineWarmupTimerDeps,
} from './timelineWarmupTimers';

const DEFAULT_VISIBLE_THUMBNAIL_GENERATION_DELAY_MS = 250;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface TimelineThumbnailGenerationClipRef {
  id: string;
  duration?: number;
  inPoint?: number;
  outPoint?: number;
  mediaFileId?: string;
  source?: {
    type?: string | null;
    mediaFileId?: string;
    videoElement?: HTMLVideoElement;
    naturalDuration?: number;
  } | null;
}

export interface TimelineThumbnailGenerationMediaFileRef {
  id: string;
  duration?: number;
  fileHash?: string;
}

export interface TimelineThumbnailGenerationState {
  clips: readonly TimelineThumbnailGenerationClipRef[];
  mediaFiles: readonly TimelineThumbnailGenerationMediaFileRef[];
  isPlaying?: boolean;
  clipDragPreview?: TimelineClipDragPreview | null;
}

export interface TimelineThumbnailGenerationWarmupDeps {
  getState: () => TimelineThumbnailGenerationState;
  getStatus: (mediaFileId: string) => ThumbnailStatus;
  generateForSource: (
    mediaFileId: string,
    sourceVideo: HTMLVideoElement,
    duration: number,
    fileHash?: string,
  ) => Promise<void>;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export type TimelineThumbnailGenerationWarmupStatus =
  | 'generated'
  | 'ready'
  | 'generating'
  | 'blocked'
  | 'skipped';

export interface TimelineThumbnailGenerationWarmupResult {
  mediaFileId: string;
  status: TimelineThumbnailGenerationWarmupStatus;
}

interface TimelineThumbnailGenerationRequest {
  mediaFileId: string;
  fileHash?: string;
  sourceVideo: HTMLVideoElement;
  duration: number;
  requestKey: string;
}

const scheduledThumbnailGenerationTimers = new Map<string, TimerHandle>();
const inFlightThumbnailGenerations = new Map<string, Promise<TimelineThumbnailGenerationWarmupResult>>();

function getDefaultDeps(): TimelineThumbnailGenerationWarmupDeps {
  return {
    getState: () => {
      const timelineState = useTimelineStore.getState();
      return {
        clips: timelineState.clips,
        mediaFiles: useMediaStore.getState().files,
        isPlaying: timelineState.isPlaying,
        clipDragPreview: timelineState.clipDragPreview,
      };
    },
    getStatus: (mediaFileId) => thumbnailCacheService.getStatus(mediaFileId),
    generateForSource: (mediaFileId, sourceVideo, duration, fileHash) => (
      thumbnailCacheService.generateForSource(mediaFileId, sourceVideo, duration, fileHash)
    ),
    ...getTimelineWarmupTimerDeps(),
  };
}

function getThumbnailGenerationKey(mediaFileId: string, fileHash?: string): string {
  return formatTimelineCacheCoalescingKey(
    createThumbnailGenerationCoalescingKey(mediaFileId, fileHash),
  );
}

function getClipMediaFileId(clip: TimelineThumbnailGenerationClipRef): string | null {
  if (clip.source?.type !== 'video') return null;
  return clip.source.mediaFileId ?? clip.mediaFileId ?? null;
}

function getFinitePositiveDuration(...values: Array<number | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function normalizeThumbnailGenerationRefs(
  refs: readonly VisibleTimelineThumbnailRef[],
): VisibleTimelineThumbnailRef[] {
  const unique = new Map<string, VisibleTimelineThumbnailRef>();

  for (const ref of refs) {
    if (!ref.mediaFileId) continue;
    const key = getThumbnailGenerationKey(ref.mediaFileId, ref.fileHash);
    if (unique.has(key)) continue;
    unique.set(key, {
      mediaFileId: ref.mediaFileId,
      fileHash: ref.fileHash,
    });
  }

  return Array.from(unique.values());
}

function resolveThumbnailGenerationRequest(
  ref: VisibleTimelineThumbnailRef,
  state: TimelineThumbnailGenerationState,
): TimelineThumbnailGenerationRequest | null {
  const mediaFile = state.mediaFiles.find((file) => file.id === ref.mediaFileId);
  const fileHash = ref.fileHash ?? mediaFile?.fileHash;
  const clip = state.clips.find((candidate) => (
    getClipMediaFileId(candidate) === ref.mediaFileId &&
    Boolean(candidate.source?.videoElement)
  ));
  const video = clip?.source?.videoElement;
  if (!clip || !video) return null;
  if (!(video.currentSrc || video.src)) return null;

  const duration = getFinitePositiveDuration(
    clip.source?.naturalDuration,
    video.duration,
    mediaFile?.duration,
    clip.outPoint,
    clip.duration,
  );
  if (!duration) return null;

  return {
    mediaFileId: ref.mediaFileId,
    fileHash,
    sourceVideo: video,
    duration,
    requestKey: getThumbnailGenerationKey(ref.mediaFileId, fileHash),
  };
}

export async function warmVisibleTimelineThumbnailGeneration(
  refs: readonly VisibleTimelineThumbnailRef[],
  options: { deps?: TimelineThumbnailGenerationWarmupDeps } = {},
): Promise<TimelineThumbnailGenerationWarmupResult[]> {
  const deps = options.deps ?? getDefaultDeps();
  const state = deps.getState();
  const normalizedRefs = normalizeThumbnailGenerationRefs(refs);

  if (state.isPlaying || state.clipDragPreview) {
    return normalizedRefs.map((ref) => ({
      mediaFileId: ref.mediaFileId,
      status: 'blocked' as const,
    }));
  }

  const results: TimelineThumbnailGenerationWarmupResult[] = [];
  for (const ref of normalizedRefs) {
    const currentStatus = deps.getStatus(ref.mediaFileId);
    if (currentStatus === 'ready' || currentStatus === 'generating') {
      results.push({
        mediaFileId: ref.mediaFileId,
        status: currentStatus,
      });
      continue;
    }

    const request = resolveThumbnailGenerationRequest(ref, state);
    if (!request) {
      results.push({
        mediaFileId: ref.mediaFileId,
        status: 'skipped',
      });
      continue;
    }

    let generation = inFlightThumbnailGenerations.get(request.requestKey);
    if (!generation) {
      generation = deps.generateForSource(
        request.mediaFileId,
        request.sourceVideo,
        request.duration,
        request.fileHash,
      )
        .then(() => ({ mediaFileId: request.mediaFileId, status: 'generated' as const }))
        .finally(() => {
          inFlightThumbnailGenerations.delete(request.requestKey);
        });
      inFlightThumbnailGenerations.set(request.requestKey, generation);
    }

    results.push(await generation);
  }

  return results;
}

export function scheduleVisibleTimelineThumbnailGeneration(
  refs: readonly VisibleTimelineThumbnailRef[],
  options: {
    deps?: TimelineThumbnailGenerationWarmupDeps;
    delayMs?: number;
  } = {},
): () => void {
  const deps = options.deps ?? getDefaultDeps();
  const scheduled: Array<{ key: string; timer: TimerHandle }> = [];

  for (const ref of normalizeThumbnailGenerationRefs(refs)) {
    const key = getThumbnailGenerationKey(ref.mediaFileId, ref.fileHash);
    if (scheduledThumbnailGenerationTimers.has(key) || inFlightThumbnailGenerations.has(key)) {
      continue;
    }

    const timer = deps.setTimeout(() => {
      if (scheduledThumbnailGenerationTimers.get(key) !== timer) return;
      scheduledThumbnailGenerationTimers.delete(key);
      void warmVisibleTimelineThumbnailGeneration([ref], { deps });
    }, options.delayMs ?? DEFAULT_VISIBLE_THUMBNAIL_GENERATION_DELAY_MS);

    scheduledThumbnailGenerationTimers.set(key, timer);
    scheduled.push({ key, timer });
  }

  return () => {
    for (const { key, timer } of scheduled) {
      if (scheduledThumbnailGenerationTimers.get(key) !== timer) continue;
      deps.clearTimeout(timer);
      scheduledThumbnailGenerationTimers.delete(key);
    }
  };
}

export function resetTimelineThumbnailGenerationWarmupForTest(): void {
  clearTimelineWarmupTimers(scheduledThumbnailGenerationTimers.values());
  scheduledThumbnailGenerationTimers.clear();
  inFlightThumbnailGenerations.clear();
}
