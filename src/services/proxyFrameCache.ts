// Proxy frame cache - loads and caches proxy image/video frames for fast playback

import { Logger } from './logger';
import { projectFileService } from './projectFileService';
import {
  getProjectRawPathCandidates,
  getStoredProjectFileHandle,
} from './project/mediaSourceResolver';
import {
  mediaRuntimeObjectUrlLeaseOwner,
  toObjectUrlRuntimeSourceId,
} from './mediaRuntime/objectUrlLeases';
import {
  mediaRuntimeScrubAudioLeaseOwner,
  toScrubAudioRuntimeSourceId,
} from './mediaRuntime/scrubAudioLeases';
import type { RuntimeSourceId } from './mediaRuntime/types';
import type {
  CachedFrame,
  CachedVideoFrame,
  LegacyProxyFrameCacheStats,
  ProxyCachedFrame,
  ProxyCachedVideoFrame,
  ProxyVideoFrameCacheStats,
} from './proxyFrame/frameCacheModels';
import {
  createAudioBufferResource,
  createAudioProxyElementResource,
  createLegacyFrameCacheResource,
  createVideoFrameCacheResource,
  estimateAudioBufferBytes,
  getLegacyFrameCacheStats,
  getVideoFrameCacheStats,
} from './proxyFrame/runtimeResources';
import {
  HUM_NOTCH_MAX_HARMONICS,
  normalizeScrubDynamicsReductionDb,
  reconnectScrubCustomProcessor,
  scrubProcessorSignature,
  updateScrubProcessorNode,
  type ScrubProcessorNode,
} from './proxyFrame/scrubAudioProcessing';
import { attachScrubSampleProcessor } from './proxyFrame/scrubAudioSampleProcessors';
import type { ScrubAudioOptions, ScrubGrain } from './proxyFrame/scrubAudioModels';
import {
  decodeProxyVideoFrameFromSource,
  parseProxyVideoFile,
  type ProxyVideoSourceState,
} from './proxyFrame/proxyVideoParser';
export type { ProxyCachedFrame, ProxyCachedVideoFrame } from './proxyFrame/frameCacheModels';

const log = Logger.create('ProxyFrameCache');
import { fileSystemService } from './fileSystemService';
import { useMediaStore } from '../stores/mediaStore';
import { clampAudioPan } from '../engine/audio/audioMath';
import { timelineRuntimeCoordinator } from './timeline/timelineRuntimeCoordinator';
import type { TimelineRuntimeAdmissionDecision } from './timeline/runtimeCoordinatorTypes';
import type { LiveAudioRouteProcessor } from './audio/audioGraphRouteSettings';
import type { AudioDynamicsReductionSnapshot, AudioMeterSnapshot } from '../types';
import { calculateAudioMeterSnapshot } from './audio/audioMetering';

// Cache settings - tuned for fast scrubbing
const MAX_CACHE_SIZE = 900; // 30 seconds at 30fps - larger cache for scrubbing
const MAX_VIDEO_FRAME_CACHE_SIZE = 120;
const JPEG_PROXY_FRAMES_ENABLED = true;
const PRELOAD_AHEAD_FRAMES = 60; // 2 seconds ahead for playback
const PRELOAD_BEHIND_FRAMES = 30; // 1 second behind for reverse scrubbing
const PARALLEL_LOAD_COUNT = 16; // More parallel loads for faster preload
const SCRUB_PRELOAD_RANGE = 90; // 3 seconds around scrub position
const SCRUB_TELEPORT_SECONDS = 2; // Large jumps should abandon stale queued scrub preloads
const SCRUB_STATIONARY_EPSILON_SECONDS = 0.003;
const SCRUB_STATIONARY_STOP_MS = 140;
const SCRUB_GRAIN_DURATION_SECONDS = 0.09;
const SCRUB_GRAIN_SPACING_SECONDS = 0.075;
const SCRUB_GRAIN_FADE_SECONDS = 0.008;
const SCRUB_GRAIN_SCHEDULE_AHEAD_SECONDS = 0.075;
const SCRUB_GRAIN_PEAK_GAIN = 0.42;
const SCRUB_RESYNC_POSITION_DELTA_SECONDS = 0.045;
const SCRUB_RESYNC_FADE_OUT_SECONDS = 0.012;
const SCRUB_FAST_VELOCITY_SECONDS_PER_SECOND = 2.5;
const SCRUB_REVERSE_THRESHOLD_SECONDS_PER_SECOND = -0.04;
const MAX_AUDIO_BUFFER_CACHE_BYTES = 192 * 1024 * 1024;
const MAX_AUDIO_BUFFER_CACHE_ENTRIES = 3;
const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];



// Frame cache entry




function hasUsableAudioProxy(mediaFile: { hasProxyAudio?: boolean; audioProxyStatus?: string } | undefined): boolean {
  return mediaFile?.hasProxyAudio === true || mediaFile?.audioProxyStatus === 'ready';
}



class ProxyFrameCache {
  private cache: Map<string, CachedFrame> = new Map();
  private videoFrameCache: Map<string, CachedVideoFrame> = new Map();
  private loadingPromises: Map<string, Promise<HTMLImageElement | null>> = new Map();
  private videoFrameLoadingPromises: Map<string, Promise<VideoFrame | null>> = new Map();
  private proxyVideoSourcePromises: Map<string, Promise<ProxyVideoSourceState | null>> = new Map();
  private preloadQueue: string[] = [];
  private isPreloading = false;
  private objectUrlLeaseSequence = 0;
  private scrubAudioLeaseSequence = 0;

  // Audio proxy cache
  private audioCache: Map<string, HTMLAudioElement> = new Map();
  private audioLoadingPromises: Map<string, Promise<HTMLAudioElement | null>> = new Map();
  private ownedAudioUrlLeaseIds = new Map<string, RuntimeSourceId>();

  // Audio buffer cache for instant scrubbing (Web Audio API)
  private audioBufferCache: Map<string, AudioBuffer> = new Map();
  private audioBufferFailed: Set<string> = new Set(); // Track files with no audio
  private audioContext: AudioContext | null = null;
  private scrubGain: GainNode | null = null;
  private scrubAnalyser: AnalyserNode | null = null;
  private scrubStereoSplitter: ChannelSplitterNode | null = null;
  private scrubLeftAnalyser: AnalyserNode | null = null;
  private scrubRightAnalyser: AnalyserNode | null = null;
  private scrubMeterBuffer: Float32Array<ArrayBuffer> | null = null;
  private scrubLeftMeterBuffer: Float32Array<ArrayBuffer> | null = null;
  private scrubRightMeterBuffer: Float32Array<ArrayBuffer> | null = null;
  private scrubFrequencyBuffer: Float32Array<ArrayBuffer> | null = null;

  // Get cache key
  private getKey(mediaFileId: string, frameIndex: number): string {
    return `${mediaFileId}_${frameIndex}`;
  }

  private getLegacyProxyFrameResourceId(mediaFileId: string): string {
    return `proxy-frame-cache:${mediaFileId}:legacy-images`;
  }

  private getAudioBufferResourceId(mediaFileId: string): string {
    return `proxy-frame-cache:${mediaFileId}:audio-buffer`;
  }

  private getAudioProxyElementResourceId(mediaFileId: string): string {
    return `proxy-frame-cache:${mediaFileId}:audio-proxy-element`;
  }

  private getVideoFrameResourceId(mediaFileId: string): string {
    return `proxy-frame-cache:${mediaFileId}:video-frames`;
  }

  private nextObjectUrlRuntimeSourceId(ownerId: string, type: string): RuntimeSourceId {
    this.objectUrlLeaseSequence += 1;
    return toObjectUrlRuntimeSourceId(`${ownerId}:${this.objectUrlLeaseSequence}`, type);
  }

  private nextScrubAudioRuntimeSourceId(ownerId: string, type: string): RuntimeSourceId {
    this.scrubAudioLeaseSequence += 1;
    return toScrubAudioRuntimeSourceId(`${ownerId}:${this.scrubAudioLeaseSequence}`, type);
  }

  private acquireObjectUrl(
    runtimeSourceId: RuntimeSourceId,
    ownerId: string,
    blob: Blob
  ): string {
    const lease = mediaRuntimeObjectUrlLeaseOwner.acquire({
      runtimeSourceId,
      ownerId,
      blob,
      policy: 'interactive',
    });
    const url = lease.getRuntimeHandles()?.url;
    if (!url) {
      throw new Error('Object URL lease did not acquire a URL');
    }
    return url;
  }

  private releaseObjectUrl(runtimeSourceId: RuntimeSourceId, reason: string): void {
    mediaRuntimeObjectUrlLeaseOwner.release(runtimeSourceId, reason);
  }

  private acquireLegacyFrameObjectUrl(
    mediaFileId: string,
    frameIndex: number,
    blob: Blob
  ): { runtimeSourceId: RuntimeSourceId; url: string } {
    const runtimeSourceId = this.nextObjectUrlRuntimeSourceId(
      `proxy-frame-cache:${mediaFileId}:${frameIndex}`,
      'legacy-frame-image'
    );
    return {
      runtimeSourceId,
      url: this.acquireObjectUrl(
        runtimeSourceId,
        `proxy-frame-cache:${mediaFileId}:legacy-frame:${frameIndex}`,
        blob
      ),
    };
  }

  private acquireAudioProxyObjectUrl(mediaFileId: string, audioFile: Blob): string {
    const runtimeSourceId = this.nextObjectUrlRuntimeSourceId(
      `proxy-frame-cache:${mediaFileId}`,
      'audio-proxy'
    );
    const url = this.acquireObjectUrl(
      runtimeSourceId,
      `proxy-frame-cache:${mediaFileId}:audio-proxy`,
      audioFile
    );
    this.ownedAudioUrlLeaseIds.set(url, runtimeSourceId);
    return url;
  }

  private releaseOwnedAudioObjectUrl(src: string, reason: string): void {
    const runtimeSourceId = this.ownedAudioUrlLeaseIds.get(src);
    if (!runtimeSourceId) return;
    this.releaseObjectUrl(runtimeSourceId, reason);
    this.ownedAudioUrlLeaseIds.delete(src);
  }

  private getScrubAudioContextRuntimeSourceId(): RuntimeSourceId {
    return toScrubAudioRuntimeSourceId('proxy-frame-cache', 'audio-context');
  }

  private getScrubAudioBufferRuntimeSourceId(mediaFileId: string): RuntimeSourceId {
    return toScrubAudioRuntimeSourceId(`proxy-frame-cache:${mediaFileId}`, 'audio-buffer');
  }

  private createAudioProxyElement(mediaFileId: string): HTMLAudioElement {
    const lease = mediaRuntimeScrubAudioLeaseOwner.acquireAudioElement({
      runtimeSourceId: this.nextScrubAudioRuntimeSourceId(
        `proxy-frame-cache:${mediaFileId}`,
        'audio-proxy-element'
      ),
      ownerId: `proxy-frame-cache:${mediaFileId}:audio-proxy-element`,
      policy: 'interactive',
    });
    const audio = lease.getRuntimeHandles()?.element;
    if (!audio) {
      throw new Error('Scrub audio element lease did not acquire an element');
    }
    return audio;
  }


  private getLegacyFrameCacheStats(
    mediaFileId: string,
    override?: { key: string; entry: CachedFrame | null }
  ): LegacyProxyFrameCacheStats {
    return getLegacyFrameCacheStats(this.cache, mediaFileId, override);
  }

  private createLegacyFrameCacheResource(
    mediaFileId: string,
    stats: LegacyProxyFrameCacheStats
  ) {
    return createLegacyFrameCacheResource(mediaFileId, stats);
  }

  private canRetainLegacyFrame(
    mediaFileId: string,
    key: string,
    entry: CachedFrame
  ): TimelineRuntimeAdmissionDecision {
    const stats = this.getLegacyFrameCacheStats(mediaFileId, { key, entry });
    return timelineRuntimeCoordinator.canRetainResource(
      this.createLegacyFrameCacheResource(mediaFileId, stats)
    );
  }

  private refreshLegacyFrameCacheResource(mediaFileId: string): void {
    const stats = this.getLegacyFrameCacheStats(mediaFileId);
    const resourceId = this.getLegacyProxyFrameResourceId(mediaFileId);
    if (stats.frameCount === 0) {
      timelineRuntimeCoordinator.releaseResource(resourceId);
      return;
    }
    timelineRuntimeCoordinator.retainResource(this.createLegacyFrameCacheResource(mediaFileId, stats));
  }

  private releaseLegacyFrameCacheResource(mediaFileId: string): void {
    timelineRuntimeCoordinator.releaseResource(this.getLegacyProxyFrameResourceId(mediaFileId));
  }

  private createAudioBufferResource(mediaFileId: string, buffer: AudioBuffer) {
    return createAudioBufferResource(mediaFileId, buffer);
  }

  private cacheDecodedAudioBuffer(mediaFileId: string, buffer: AudioBuffer): boolean {
    const resource = this.createAudioBufferResource(mediaFileId, buffer);
    const admission = timelineRuntimeCoordinator.canRetainResource(resource);
    if (!admission.admitted) {
      log.debug('Skipped decoded audio buffer cache retention due to runtime budget', {
        mediaFileId,
        policyId: admission.policyId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits,
      });
      return false;
    }

    mediaRuntimeScrubAudioLeaseOwner.trackAudioBuffer({
      runtimeSourceId: this.getScrubAudioBufferRuntimeSourceId(mediaFileId),
      ownerId: `proxy-frame-cache:${mediaFileId}:audio-buffer`,
      buffer,
      mediaFileId,
      policy: 'interactive',
    });
    this.touchAudioBufferCacheEntry(mediaFileId, buffer);
    timelineRuntimeCoordinator.retainResource(resource);
    this.enforceAudioBufferCacheLimit();
    return true;
  }

  private releaseAudioBufferResource(mediaFileId: string): void {
    timelineRuntimeCoordinator.releaseResource(this.getAudioBufferResourceId(mediaFileId));
    mediaRuntimeScrubAudioLeaseOwner.releaseAudioBuffer(
      this.getScrubAudioBufferRuntimeSourceId(mediaFileId),
      `proxy-frame-cache:${mediaFileId}:release-audio-buffer`
    );
  }

  private createAudioProxyElementResource(
    mediaFileId: string,
    audioSrc: string,
    audio?: HTMLAudioElement,
  ) {
    return createAudioProxyElementResource(mediaFileId, audioSrc, audio);
  }

  private canRetainAudioProxyElement(mediaFileId: string, audioSrc: string): TimelineRuntimeAdmissionDecision {
    return timelineRuntimeCoordinator.canRetainResource(
      this.createAudioProxyElementResource(mediaFileId, audioSrc)
    );
  }

  private reportAudioProxyElement(mediaFileId: string, audio: HTMLAudioElement): void {
    timelineRuntimeCoordinator.retainResource(
      this.createAudioProxyElementResource(mediaFileId, audio.currentSrc || audio.src, audio)
    );
  }

  private releaseAudioProxyElementResource(mediaFileId: string): void {
    timelineRuntimeCoordinator.releaseResource(this.getAudioProxyElementResourceId(mediaFileId));
  }

  private getVideoFrameCacheStats(
    mediaFileId: string,
    override?: { key: string; entry: CachedVideoFrame | null }
  ): ProxyVideoFrameCacheStats {
    return getVideoFrameCacheStats(this.videoFrameCache, mediaFileId, override);
  }

  private createVideoFrameCacheResource(
    mediaFileId: string,
    stats: ProxyVideoFrameCacheStats
  ) {
    return createVideoFrameCacheResource(mediaFileId, stats);
  }

  private canRetainVideoFrame(
    mediaFileId: string,
    key: string,
    entry: CachedVideoFrame
  ): TimelineRuntimeAdmissionDecision {
    const stats = this.getVideoFrameCacheStats(mediaFileId, { key, entry });
    return timelineRuntimeCoordinator.canRetainResource(
      this.createVideoFrameCacheResource(mediaFileId, stats)
    );
  }

  private refreshVideoFrameCacheResource(mediaFileId: string): void {
    const stats = this.getVideoFrameCacheStats(mediaFileId);
    const resourceId = this.getVideoFrameResourceId(mediaFileId);
    if (stats.frameCount === 0) {
      timelineRuntimeCoordinator.releaseResource(resourceId);
      return;
    }
    timelineRuntimeCoordinator.retainResource(this.createVideoFrameCacheResource(mediaFileId, stats));
  }

  private releaseVideoFrameCacheResource(mediaFileId: string): void {
    timelineRuntimeCoordinator.releaseResource(this.getVideoFrameResourceId(mediaFileId));
  }
  private disposeAudioProxyElement(mediaFileId: string, audio: HTMLAudioElement): void {
    const src = mediaRuntimeScrubAudioLeaseOwner.releaseAudioElement(
      audio,
      `proxy-frame-cache:${mediaFileId}:dispose-audio-proxy`
    );
    if (src) {
      this.releaseOwnedAudioObjectUrl(src, `proxy-frame-cache:${mediaFileId}:dispose-audio-proxy`);
    }
    this.audioCache.delete(mediaFileId);
    this.releaseAudioProxyElementResource(mediaFileId);
  }

  private touchAudioBufferCacheEntry(mediaFileId: string, buffer: AudioBuffer): void {
    this.audioBufferCache.delete(mediaFileId);
    this.audioBufferCache.set(mediaFileId, buffer);
  }

  private enforceAudioBufferCacheLimit(): void {
    let totalBytes = 0;
    for (const buffer of this.audioBufferCache.values()) {
      totalBytes += estimateAudioBufferBytes(buffer);
    }

    while (
      this.audioBufferCache.size > 1 &&
      (this.audioBufferCache.size > MAX_AUDIO_BUFFER_CACHE_ENTRIES || totalBytes > MAX_AUDIO_BUFFER_CACHE_BYTES)
    ) {
      const oldest = this.audioBufferCache.entries().next().value as [string, AudioBuffer] | undefined;
      if (!oldest) break;
      this.audioBufferCache.delete(oldest[0]);
      this.releaseAudioBufferResource(oldest[0]);
      totalBytes -= estimateAudioBufferBytes(oldest[1]);
      log.debug(`Evicted decoded audio buffer from cache: ${oldest[0]}`);
    }
  }

  // Synchronously get a frame if it's already in memory cache
  // Also triggers preloading of upcoming frames (even if current frame not cached)
  getCachedFrame(mediaFileId: string, frameIndex: number, fps: number = 30): HTMLImageElement | null {
    return JPEG_PROXY_FRAMES_ENABLED
      ? this.getCachedLegacyImageFrame(mediaFileId, frameIndex, fps)
      : null;
  }

  private getCachedLegacyImageFrame(mediaFileId: string, frameIndex: number, fps: number = 30): HTMLImageElement | null {
    const key = this.getKey(mediaFileId, frameIndex);
    const cached = this.cache.get(key);

    // ALWAYS trigger preloading, even if current frame isn't cached
    // This ensures nested composition frames get preloaded when playhead enters them
    this.schedulePreload(mediaFileId, frameIndex, fps);

    if (cached) {
      cached.timestamp = Date.now(); // Update for LRU
      this.cacheHits++;
      return cached.image;
    }
    this.cacheMisses++;
    return null;
  }

  // Get nearest cached frame for scrubbing fallback
  // Returns the closest frame within maxDistance frames
  // Searches in scrub direction first for smoother scrubbing
  getNearestCachedFrame(mediaFileId: string, frameIndex: number, maxDistance: number = 30): HTMLImageElement | null {
    return this.getNearestCachedFrameEntry(mediaFileId, frameIndex, maxDistance)?.image ?? null;
  }

  getNearestCachedFrameEntry(
    mediaFileId: string,
    frameIndex: number,
    maxDistance: number = 30
  ): ProxyCachedFrame | null {
    return JPEG_PROXY_FRAMES_ENABLED
      ? this.getNearestCachedLegacyImageFrameEntry(mediaFileId, frameIndex, maxDistance)
      : null;
  }

  private getNearestCachedLegacyImageFrameEntry(
    mediaFileId: string,
    frameIndex: number,
    maxDistance: number = 30
  ): ProxyCachedFrame | null {
    // Check exact frame first
    const exactKey = this.getKey(mediaFileId, frameIndex);
    const exact = this.cache.get(exactKey);
    if (exact) {
      exact.timestamp = Date.now();
      return { frameIndex: exact.frameIndex, image: exact.image };
    }

    // Search in scrub direction first for visual continuity
    const searchForward = this.scrubDirection >= 0;

    for (let d = 1; d <= maxDistance; d++) {
      // Search primary direction first
      const primaryOffset = searchForward ? d : -d;
      const primaryFrame = frameIndex + primaryOffset;
      if (primaryFrame >= 0) {
        const primaryKey = this.getKey(mediaFileId, primaryFrame);
        const primary = this.cache.get(primaryKey);
        if (primary) {
          primary.timestamp = Date.now();
          return { frameIndex: primary.frameIndex, image: primary.image };
        }
      }

      // Then search opposite direction
      const secondaryOffset = searchForward ? -d : d;
      const secondaryFrame = frameIndex + secondaryOffset;
      if (secondaryFrame >= 0) {
        const secondaryKey = this.getKey(mediaFileId, secondaryFrame);
        const secondary = this.cache.get(secondaryKey);
        if (secondary) {
          secondary.timestamp = Date.now();
          return { frameIndex: secondary.frameIndex, image: secondary.image };
        }
      }
    }

    return null;
  }

  getCachedVideoFrame(mediaFileId: string, frameIndex: number): VideoFrame | null {
    this.updateScrubDirection(frameIndex);
    const key = this.getKey(mediaFileId, frameIndex);
    const cached = this.videoFrameCache.get(key);
    if (cached) {
      cached.timestamp = Date.now();
      this.cacheHits++;
      return cached.frame;
    }
    this.cacheMisses++;
    return null;
  }

  getNearestCachedVideoFrameEntry(
    mediaFileId: string,
    frameIndex: number,
    maxDistance: number = 30
  ): ProxyCachedVideoFrame | null {
    const exact = this.videoFrameCache.get(this.getKey(mediaFileId, frameIndex));
    if (exact) {
      exact.timestamp = Date.now();
      return { frameIndex: exact.frameIndex, frame: exact.frame };
    }

    const searchForward = this.scrubDirection >= 0;
    for (let d = 1; d <= maxDistance; d++) {
      const primaryFrame = frameIndex + (searchForward ? d : -d);
      if (primaryFrame >= 0) {
        const primary = this.videoFrameCache.get(this.getKey(mediaFileId, primaryFrame));
        if (primary) {
          primary.timestamp = Date.now();
          return { frameIndex: primary.frameIndex, frame: primary.frame };
        }
      }

      const secondaryFrame = frameIndex + (searchForward ? -d : d);
      if (secondaryFrame >= 0) {
        const secondary = this.videoFrameCache.get(this.getKey(mediaFileId, secondaryFrame));
        if (secondary) {
          secondary.timestamp = Date.now();
          return { frameIndex: secondary.frameIndex, frame: secondary.frame };
        }
      }
    }

    return null;
  }

  async getVideoFrame(mediaFileId: string, time: number, fps: number = 30): Promise<VideoFrame | null> {
    const frameIndex = Math.floor(time * fps);
    this.updateScrubDirection(frameIndex);
    const key = this.getKey(mediaFileId, frameIndex);

    const cached = this.videoFrameCache.get(key);
    if (cached) {
      cached.timestamp = Date.now();
      return cached.frame;
    }

    const loadingPromise = this.videoFrameLoadingPromises.get(key);
    if (loadingPromise) return loadingPromise;

    const promise = this.decodeProxyVideoFrame(mediaFileId, frameIndex);
    this.videoFrameLoadingPromises.set(key, promise);

    try {
      const frame = await promise;
      if (frame) {
        if (!this.addVideoFrameToCache(mediaFileId, frameIndex, frame)) {
          return null;
        }
      }
      return frame;
    } finally {
      this.videoFrameLoadingPromises.delete(key);
    }
  }

  private async getProxyVideoSource(mediaFileId: string): Promise<ProxyVideoSourceState | null> {
    const existing = this.proxyVideoSourcePromises.get(mediaFileId);
    if (existing) return existing;

    const promise = (async () => {
      const mediaFile = useMediaStore.getState().files.find(f => f.id === mediaFileId);
      const storageKey = mediaFile?.fileHash || mediaFileId;
      if (!projectFileService.isProjectOpen()) return null;

      const proxyVideo = await projectFileService.getProxyVideo(storageKey);
      if (!proxyVideo) return null;

      return parseProxyVideoFile(mediaFileId, storageKey, proxyVideo, log);
    })();

    this.proxyVideoSourcePromises.set(mediaFileId, promise);
    return promise;
  }

  private async decodeProxyVideoFrame(mediaFileId: string, frameIndex: number): Promise<VideoFrame | null> {
    const source = await this.getProxyVideoSource(mediaFileId);
    if (!source || source.samples.length === 0) return null;
    return decodeProxyVideoFrameFromSource(source, frameIndex, log);
  }
  private addVideoFrameToCache(mediaFileId: string, frameIndex: number, frame: VideoFrame): boolean {
    const key = this.getKey(mediaFileId, frameIndex);
    const entry: CachedVideoFrame = {
      mediaFileId,
      frameIndex,
      frame,
      timestamp: Date.now(),
    };

    while (!this.videoFrameCache.has(key) && this.videoFrameCache.size >= MAX_VIDEO_FRAME_CACHE_SIZE) {
      this.evictOldestVideoFrame();
    }

    const admission = this.canRetainVideoFrame(mediaFileId, key, entry);
    if (!admission.admitted) {
      log.debug('Skipped proxy video frame cache retention due to runtime budget', {
        mediaFileId,
        frameIndex,
        policyId: admission.policyId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits,
      });
      frame.close();
      return false;
    }

    const existing = this.videoFrameCache.get(key);
    if (existing && existing.frame !== frame) {
      existing.frame.close();
    }

    this.videoFrameCache.set(key, entry);
    this.refreshVideoFrameCacheResource(mediaFileId);
    return true;
  }

  private evictOldestVideoFrame(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.videoFrameCache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (!oldestKey) return;
    const oldest = this.videoFrameCache.get(oldestKey);
    oldest?.frame.close();
    this.videoFrameCache.delete(oldestKey);
    if (oldest) {
      this.refreshVideoFrameCacheResource(oldest.mediaFileId);
    }
  }

  // Get a frame from cache or load it
  async getFrame(mediaFileId: string, time: number, fps: number = 30): Promise<HTMLImageElement | null> {
    return JPEG_PROXY_FRAMES_ENABLED
      ? this.getLegacyImageFrame(mediaFileId, time, fps)
      : null;
  }

  private async getLegacyImageFrame(mediaFileId: string, time: number, fps: number = 30): Promise<HTMLImageElement | null> {
    const frameIndex = Math.floor(time * fps);
    const key = this.getKey(mediaFileId, frameIndex);

    // Check cache first
    const cached = this.cache.get(key);
    if (cached) {
      cached.timestamp = Date.now(); // Update for LRU
      return cached.image;
    }

    // Check if already loading
    const loadingPromise = this.loadingPromises.get(key);
    if (loadingPromise) {
      return loadingPromise;
    }

    // Load from IndexedDB
    const promise = this.loadFrame(mediaFileId, frameIndex);
    this.loadingPromises.set(key, promise);

    try {
      const image = await promise;
      if (image) {
        this.addToCache(mediaFileId, frameIndex, image);
        // Trigger preload of upcoming frames
        this.schedulePreload(mediaFileId, frameIndex, fps);
      }
      return image;
    } finally {
      this.loadingPromises.delete(key);
    }
  }

  // Load a single frame - ONLY from project folder (no browser cache)
  private async loadFrame(mediaFileId: string, frameIndex: number): Promise<HTMLImageElement | null> {
    try {
      let blob: Blob | null = null;

      // Get the media file to find its fileHash (used for proxy folder naming)
      const mediaFile = useMediaStore.getState().files.find(f => f.id === mediaFileId);
      const storageKey = mediaFile?.fileHash || mediaFileId;

      // Debug logging
      if (frameIndex === 0) {
        log.debug(`Loading frame 0 for: ${mediaFile?.name}`);
        log.debug(`storageKey: ${storageKey}, projectOpen: ${projectFileService.isProjectOpen()}, proxyStatus: ${mediaFile?.proxyStatus}`);
      }

      // Load from project folder ONLY (no IndexedDB fallback)
      if (projectFileService.isProjectOpen()) {
        blob = await projectFileService.getProxyFrame(storageKey, frameIndex);
        if (frameIndex === 0) {
          log.debug(`Frame 0 blob: ${blob ? `${blob.size} bytes` : 'null'}`);
        }
      }

      if (!blob) return null;

      // Create image from blob
      const { runtimeSourceId, url } = this.acquireLegacyFrameObjectUrl(
        mediaFileId,
        frameIndex,
        blob
      );
      const image = new Image();

      return new Promise((resolve) => {
        image.onload = () => {
          this.releaseObjectUrl(runtimeSourceId, `proxy-frame-cache:${mediaFileId}:legacy-frame-loaded`);
          resolve(image);
        };
        image.onerror = () => {
          this.releaseObjectUrl(runtimeSourceId, `proxy-frame-cache:${mediaFileId}:legacy-frame-error`);
          resolve(null);
        };
        image.src = url;
      });
    } catch (e) {
      log.warn('Failed to load frame', e);
      return null;
    }
  }

  // Add frame to cache
  private addToCache(mediaFileId: string, frameIndex: number, image: HTMLImageElement): boolean {
    const key = this.getKey(mediaFileId, frameIndex);
    const entry: CachedFrame = {
      mediaFileId,
      frameIndex,
      image,
      timestamp: Date.now(),
    };

    // Evict old frames if cache is full
    if (!this.cache.has(key) && this.cache.size >= MAX_CACHE_SIZE) {
      this.evictOldest();
    }

    const admission = this.canRetainLegacyFrame(mediaFileId, key, entry);
    if (!admission.admitted) {
      log.debug('Skipped proxy frame cache retention due to runtime budget', {
        mediaFileId,
        frameIndex,
        policyId: admission.policyId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits,
      });
      return false;
    }

    this.cache.set(key, entry);
    this.refreshLegacyFrameCacheResource(mediaFileId);
    return true;
  }

  // Evict oldest frame from cache (LRU)
  private evictOldest() {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (!oldestKey) return;
    const oldest = this.cache.get(oldestKey);
    this.cache.delete(oldestKey);
    if (oldest) {
      this.refreshLegacyFrameCacheResource(oldest.mediaFileId);
    }
  }

  // Scrub tracking for smart preloading
  private lastScrubFrame = -1;
  private scrubDirection = 0; // -1 = backward, 0 = stopped, 1 = forward
  private isScrubbing = false;
  private scrubPreloadQueueDrops = 0;

  private removeQueuedPreloadsForMedia(mediaFileId: string): number {
    const prefix = `${mediaFileId}_`;
    const before = this.preloadQueue.length;
    this.preloadQueue = this.preloadQueue.filter((key) => !key.startsWith(prefix));
    return before - this.preloadQueue.length;
  }

  private parsePreloadKey(key: string): { mediaFileId: string; frameIndex: number } | null {
    const separatorIndex = key.lastIndexOf('_');
    if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
      return null;
    }

    const frameIndex = Number.parseInt(key.slice(separatorIndex + 1), 10);
    if (!Number.isFinite(frameIndex)) {
      return null;
    }

    return {
      mediaFileId: key.slice(0, separatorIndex),
      frameIndex,
    };
  }

  // Schedule preloading of frames around current position (bidirectional)
  private schedulePreload(mediaFileId: string, currentFrameIndex: number, fps: number) {
    // Detect scrub direction
    if (this.lastScrubFrame >= 0) {
      const delta = currentFrameIndex - this.lastScrubFrame;
      const teleportThresholdFrames = Math.max(
        SCRUB_PRELOAD_RANGE,
        Math.floor(Math.max(1, fps) * SCRUB_TELEPORT_SECONDS)
      );
      if (Math.abs(delta) >= teleportThresholdFrames) {
        const dropped = this.removeQueuedPreloadsForMedia(mediaFileId);
        if (dropped > 0) {
          this.scrubPreloadQueueDrops += dropped;
        }
        this.scrubDirection = delta > 0 ? 1 : -1;
        this.isScrubbing = true;
      } else if (Math.abs(delta) > 0) {
        this.scrubDirection = delta > 0 ? 1 : -1;
        this.isScrubbing = true;
      }
    }
    this.lastScrubFrame = currentFrameIndex;

    // Calculate preload range based on scrubbing state
    const preloadAhead = this.isScrubbing ? SCRUB_PRELOAD_RANGE : PRELOAD_AHEAD_FRAMES;
    const preloadBehind = this.isScrubbing ? SCRUB_PRELOAD_RANGE : PRELOAD_BEHIND_FRAMES;

    // Priority queue: current frame first, then direction-based loading
    const framesToPreload: number[] = [currentFrameIndex];

    // Add frames in scrub direction first (higher priority)
    if (this.scrubDirection >= 0) {
      // Forward or stopped: prioritize ahead
      for (let i = 1; i <= preloadAhead; i++) {
        framesToPreload.push(currentFrameIndex + i);
      }
      for (let i = 1; i <= preloadBehind; i++) {
        if (currentFrameIndex - i >= 0) {
          framesToPreload.push(currentFrameIndex - i);
        }
      }
    } else {
      // Backward scrubbing: prioritize behind
      for (let i = 1; i <= preloadBehind; i++) {
        if (currentFrameIndex - i >= 0) {
          framesToPreload.push(currentFrameIndex - i);
        }
      }
      for (let i = 1; i <= preloadAhead; i++) {
        framesToPreload.push(currentFrameIndex + i);
      }
    }

    // Add to preload queue
    for (let i = 0; i < framesToPreload.length; i++) {
      const frameIndex = framesToPreload[i];
      if (frameIndex < 0) continue;

      const key = this.getKey(mediaFileId, frameIndex);

      // Skip if already cached or in queue
      if (!this.cache.has(key) && !this.preloadQueue.includes(key)) {
        // Insert current frame at front of queue for priority loading
        if (i === 0) {
          this.preloadQueue.unshift(key);
        } else {
          this.preloadQueue.push(key);
        }
      }
    }

    // Start preloading if not already
    if (!this.isPreloading) {
      this.processPreloadQueue();
    }
  }

  private updateScrubDirection(currentFrameIndex: number): void {
    if (this.lastScrubFrame >= 0) {
      const delta = currentFrameIndex - this.lastScrubFrame;
      if (Math.abs(delta) > 0) {
        this.scrubDirection = delta > 0 ? 1 : -1;
        this.isScrubbing = true;
      }
    }
    this.lastScrubFrame = currentFrameIndex;
  }

  // Call this when scrubbing stops to reset state
  resetScrubState(): void {
    this.isScrubbing = false;
    this.scrubDirection = 0;
    this.lastScrubFrame = -1;
  }

  // Process preload queue with parallel loading for speed
  private async processPreloadQueue() {
    this.isPreloading = true;

    while (this.preloadQueue.length > 0) {
      // Load multiple frames in parallel for faster preloading
      const batch: string[] = [];
      while (batch.length < PARALLEL_LOAD_COUNT && this.preloadQueue.length > 0) {
        const key = this.preloadQueue.shift();
        if (key && !this.cache.has(key)) {
          batch.push(key);
        }
      }

      if (batch.length === 0) continue;

      // Load batch in parallel
      const loadPromises = batch.map(async (key) => {
        const parsed = this.parsePreloadKey(key);
        if (!parsed) {
          return { key, success: false };
        }

        const image = await this.loadFrame(parsed.mediaFileId, parsed.frameIndex);
        if (image) {
          this.addToCache(parsed.mediaFileId, parsed.frameIndex, image);
        }
        return { key, success: !!image };
      });

      await Promise.all(loadPromises);

      // Brief yield to main thread between batches
      await new Promise((r) => setTimeout(r, 0));
    }

    this.isPreloading = false;
  }

  // ============================================
  // AUDIO PROXY METHODS
  // ============================================

  /**
   * Get cached audio proxy element, or load it if not cached
   * Returns null if no audio proxy exists
   */
  async getAudioProxy(mediaFileId: string): Promise<HTMLAudioElement | null> {
    // Check cache first
    const cached = this.audioCache.get(mediaFileId);
    if (cached) {
      return cached;
    }

    // Check if already loading
    const existingPromise = this.audioLoadingPromises.get(mediaFileId);
    if (existingPromise) {
      return existingPromise;
    }

    // Start loading
    const loadPromise = this.loadAudioProxy(mediaFileId);
    this.audioLoadingPromises.set(mediaFileId, loadPromise);

    try {
      const audio = await loadPromise;
      if (audio) {
        this.audioCache.set(mediaFileId, audio);
      }
      return audio;
    } finally {
      this.audioLoadingPromises.delete(mediaFileId);
    }
  }

  /**
   * Get cached audio proxy synchronously (returns null if not yet loaded)
   */
  getCachedAudioProxy(mediaFileId: string): HTMLAudioElement | null {
    return this.audioCache.get(mediaFileId) || null;
  }

  releaseAudioProxy(mediaFileId: string): void {
    const audio = this.audioCache.get(mediaFileId);
    if (audio) {
      this.disposeAudioProxyElement(mediaFileId, audio);
    }
  }

  /**
   * Preload audio proxy for a media file
   */
  async preloadAudioProxy(mediaFileId: string): Promise<void> {
    // Just call getAudioProxy which handles caching
    await this.getAudioProxy(mediaFileId);
  }

  /**
   * Load audio proxy from project folder
   */
  private async loadAudioProxy(mediaFileId: string): Promise<HTMLAudioElement | null> {
    let audioSrc: string | undefined;
    try {
      // Get storage key (prefer fileHash for deduplication)
      const mediaStore = useMediaStore.getState();
      const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);
      const storageKey = mediaFile?.audioProxyStorageKey || mediaFile?.fileHash || mediaFileId;

      // Load audio file from project folder
      audioSrc = mediaFile?.audioProxyUrl;
      if (!audioSrc) {
        const audioFile = await projectFileService.getProxyAudio(storageKey);
        if (!audioFile) {
          return null;
        }
        audioSrc = this.acquireAudioProxyObjectUrl(mediaFileId, audioFile);
      }

      const admission = this.canRetainAudioProxyElement(mediaFileId, audioSrc);
      if (!admission.admitted) {
        log.debug('Skipped audio proxy element retention due to runtime budget', {
          mediaFileId,
          policyId: admission.policyId,
          reason: admission.reason,
          rejectedUnits: admission.rejectedUnits,
        });
        this.releaseOwnedAudioObjectUrl(audioSrc, `proxy-frame-cache:${mediaFileId}:audio-proxy-rejected`);
        return null;
      }

      // Create audio element with object URL
      const audio = this.createAudioProxyElement(mediaFileId);
      audio.src = audioSrc;
      audio.preload = 'auto';

      // Wait for audio to be ready
      await new Promise<void>((resolve, reject) => {
        const onCanPlay = () => {
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('error', onError);
          reject(new Error('Failed to load audio proxy'));
        };
        audio.addEventListener('canplaythrough', onCanPlay);
        audio.addEventListener('error', onError);
        // Start loading
        audio.load();
      });

      this.reportAudioProxyElement(mediaFileId, audio);
      log.info(`Audio proxy loaded for ${mediaFileId}`);
      return audio;
    } catch (e) {
      log.warn(`Failed to load audio proxy for ${mediaFileId}`, e);
      if (audioSrc) {
        this.releaseOwnedAudioObjectUrl(audioSrc, `proxy-frame-cache:${mediaFileId}:audio-proxy-error`);
      }
      this.releaseAudioProxyElementResource(mediaFileId);
      return null;
    }
  }

  // ============================================
  // GRANULAR AUDIO SCRUBBING (Web Audio API)
  // Overlapping short grains with fades for smoother timeline scrub feedback
  // ============================================

  // Granular scrub audio state
  private scrubSource: AudioBufferSourceNode | null = null;
  private scrubGrains = new Set<ScrubGrain>();
  private scrubSourceGain: GainNode | null = null;
  private scrubPanNode: StereoPannerNode | null = null;
  private scrubEqFilters: BiquadFilterNode[] = [];
  private scrubProcessorNodes: ScrubProcessorNode[] = [];
  private scrubProcessorSignature = '';
  private scrubCurrentMediaId: string | null = null;
  private scrubLastPosition = 0;
  private scrubLastTime = 0;
  private scrubLastMovementTime = 0;
  private scrubNextGrainTime = 0;
  private scrubSmoothedVelocity = 0;
  private scrubLastDirection: 1 | -1 = 1;
  private scrubPausedMediaId: string | null = null;
  private scrubPausedPosition: number | null = null;
  private scrubStationaryTimer: ReturnType<typeof setTimeout> | null = null;
  private scrubIsActive = false;

  /**
   * Get or create AudioContext for scrubbing
   */
  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      const lease = mediaRuntimeScrubAudioLeaseOwner.acquireAudioContext({
        runtimeSourceId: this.getScrubAudioContextRuntimeSourceId(),
        ownerId: 'proxy-frame-cache:scrub-audio-context',
        policy: 'interactive',
      });
      const audioContext = lease.getRuntimeHandles()?.context;
      if (!audioContext) {
        throw new Error('Scrub audio context lease did not acquire a context');
      }
      this.audioContext = audioContext;
      this.scrubGain = this.audioContext.createGain();
      this.scrubAnalyser = this.audioContext.createAnalyser();
      this.scrubAnalyser.fftSize = 1024;
      this.scrubAnalyser.smoothingTimeConstant = 0.2;
      this.scrubMeterBuffer = new Float32Array(this.scrubAnalyser.fftSize);
      this.scrubAnalyser.connect(this.scrubGain);
      this.scrubGain.connect(this.audioContext.destination);
      this.scrubGain.gain.value = 1;
      log.debug(`AudioContext created, state: ${this.audioContext.state}`);
    }
    return this.audioContext;
  }

  /**
   * Ensure AudioContext is running - MUST be called from a user gesture (mousedown/click).
   * Chrome's autoplay policy requires resume() from a user gesture to unlock audio.
   * IMPORTANT: Do NOT close/replace the AudioContext here - that kills pending decodeAudioData()
   * calls which permanently blacklists audio files. Just resume() - Chrome honors it from gestures.
   */
  ensureAudioContextResumed(): void {
    if (!this.audioContext) {
      // Create fresh context in user gesture → starts "running" automatically
      this.getAudioContext();
      log.debug(`AudioContext created in user gesture, state: ${this.audioContext!.state}`);
      return;
    }

    if (this.audioContext.state === 'suspended') {
      // resume() from a user gesture is always honored by Chrome
      // Don't check synchronously after - resume() is async but Chrome will process it
      this.audioContext.resume().then(() => {
        log.debug(`AudioContext resumed: ${this.audioContext?.state}`);
      }).catch(() => {
        log.warn('AudioContext resume failed');
      });
    }
  }

  /**
   * Get AudioBuffer for a media file (decode on first request)
   * Works with BOTH proxy audio AND original video files
   */
  async getAudioBuffer(mediaFileId: string, videoElementSrc?: string): Promise<AudioBuffer | null> {
    // Check cache
    const cached = this.audioBufferCache.get(mediaFileId);
    if (cached) {
      this.touchAudioBufferCacheEntry(mediaFileId, cached);
      return cached;
    }

    const mediaStore = useMediaStore.getState();
    const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);

    // Skip files that have no audio (failed decoding = audio doesn't exist)
    if (this.audioBufferFailed.has(mediaFileId) && !hasUsableAudioProxy(mediaFile)) {
      return null;
    }

    // Check if already loading
    if (this.audioBufferLoading.has(mediaFileId)) {
      return null; // Loading in progress
    }

    // Cooldown for "source not found" - retry after 3 seconds (source may become available)
    const lastAttempt = this.audioBufferRetryTime.get(mediaFileId);
    if (lastAttempt && performance.now() - lastAttempt < 3000) {
      return null;
    }

    this.audioBufferLoading.add(mediaFileId);

    try {
      const storageKey = mediaFile?.audioProxyStorageKey || mediaFile?.fileHash || mediaFileId;

      let arrayBuffer: ArrayBuffer | null = null;

      // Try 1: Session audio proxy URL (used before a project exists)
      if (mediaFile?.audioProxyUrl) {
        log.debug(`Loading from session audio proxy: ${mediaFileId}`);
        try {
          const response = await fetch(mediaFile.audioProxyUrl);
          arrayBuffer = await response.arrayBuffer();
        } catch (e) {
          log.warn('Failed to fetch session audio proxy URL', e);
        }
      }

      // Try 2: Project audio proxy file (PCM WAV for predictable scrubbing)
      if (!arrayBuffer) {
        const audioFile = await projectFileService.getProxyAudio(storageKey);
        if (audioFile) {
          log.debug(`Loading from proxy audio: ${mediaFileId}`);
          arrayBuffer = await audioFile.arrayBuffer();
        }
      }

      // Try 3: Project-local RAW media file
      if (!arrayBuffer) {
        const projectHandle = await getStoredProjectFileHandle(mediaFileId);
        if (projectHandle) {
          log.debug(`Loading from project RAW handle: ${mediaFileId}`);
          try {
            const file = await projectHandle.getFile();
            arrayBuffer = await file.arrayBuffer();
          } catch (e) {
            log.warn('Failed to read project RAW handle', e);
          }
        }
      }

      if (!arrayBuffer && projectFileService.isProjectOpen()) {
        for (const candidatePath of getProjectRawPathCandidates({
          mediaFileId,
          projectPath: mediaFile?.projectPath,
          filePath: mediaFile?.filePath,
          name: mediaFile?.name,
        })) {
          log.debug(`Loading from project RAW path: ${mediaFileId} (${candidatePath})`);
          try {
            const result = await projectFileService.getFileFromRaw(candidatePath);
            if (result) {
              arrayBuffer = await result.file.arrayBuffer();
              break;
            }
          } catch (e) {
            log.warn('Failed to read project RAW path', e);
          }
        }
      }

      // Try 4: Original video file URL (extract audio from video)
      if (!arrayBuffer && mediaFile?.url) {
        log.debug(`Loading from video URL: ${mediaFileId}`);
        try {
          const response = await fetch(mediaFile.url);
          arrayBuffer = await response.arrayBuffer();
        } catch (e) {
          log.warn('Failed to fetch video URL', e);
        }
      }

      // Try 5: File handle (if available)
      if (!arrayBuffer) {
        const fileHandle = fileSystemService.getFileHandle(mediaFileId);
        if (fileHandle) {
          log.debug(`Loading from file handle: ${mediaFileId}`);
          try {
            const file = await fileHandle.getFile();
            arrayBuffer = await file.arrayBuffer();
          } catch (e) {
            log.warn('Failed to read file handle', e);
          }
        }
      }

      // Try 6: Direct File object from media store (e.g. YouTube downloads)
      if (!arrayBuffer && mediaFile?.file) {
        log.debug(`Loading from File object: ${mediaFileId}`);
        try {
          arrayBuffer = await mediaFile.file.arrayBuffer();
        } catch (e) {
          log.warn('Failed to read File object', e);
        }
      }

      // Try 7: Video element's current source URL (guaranteed valid if video is playing)
      if (!arrayBuffer && videoElementSrc) {
        log.debug(`Loading from video element src: ${mediaFileId}`);
        try {
          const response = await fetch(videoElementSrc);
          arrayBuffer = await response.arrayBuffer();
        } catch (e) {
          log.warn('Failed to fetch video element src', e);
        }
      }

      if (!arrayBuffer) {
        log.warn(`No audio source found for ${mediaFileId}`);
        // Use cooldown instead of permanent failure - source may become available later
        this.audioBufferRetryTime.set(mediaFileId, performance.now());
        this.audioBufferLoading.delete(mediaFileId);
        return null;
      }

      // Decode to AudioBuffer
      const audioContext = this.getAudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0)); // Clone to avoid detached buffer

      const retained = this.cacheDecodedAudioBuffer(mediaFileId, audioBuffer);
      this.audioBufferFailed.delete(mediaFileId);
      this.audioBufferLoading.delete(mediaFileId);
      this.audioBufferRetryTime.delete(mediaFileId);
      log.debug(
        `Decoded ${mediaFileId}: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.numberOfChannels}ch${retained ? '' : ' (not cached)'}`
      );

      return audioBuffer;
    } catch (e) {
      this.audioBufferLoading.delete(mediaFileId);
      const errorName = e instanceof Error ? e.name : undefined;
      const errorMessage = e instanceof Error ? e.message : String(e);
      // Only permanently blacklist for actual "no audio track" decode errors (EncodingError).
      // Context-related errors (InvalidStateError from closed context) should use retry cooldown
      // so the buffer can be decoded on a new/resumed context.
      if (errorName === 'EncodingError') {
        this.audioBufferFailed.add(mediaFileId);
        log.debug(`No audio track in ${mediaFileId}`);
      } else {
        this.audioBufferRetryTime.set(mediaFileId, performance.now());
        log.debug(`Audio decode error for ${mediaFileId} (will retry): ${errorMessage}`);
      }
      return null;
    }
  }

  // Track loading state to prevent duplicate loads
  private audioBufferLoading = new Set<string>();
  // Cooldown for "source not found" retries (not permanent failure like audioBufferFailed)
  private audioBufferRetryTime = new Map<string, number>();


  /**
   * Granular scrub audio - call continuously while dragging the playhead.
   * Short overlapping, pitch-stable grains avoid the gated/stalled sound of
   * one long buffer source and allow backward scrub feedback.
   */
  playScrubAudio(
    mediaFileId: string,
    targetTime: number,
    _duration: number = 0.15,
    videoElementSrc?: string,
    options?: ScrubAudioOptions
  ): void {
    const buffer = this.audioBufferCache.get(mediaFileId);
    if (!buffer) {
      log.debug(`No AudioBuffer for ${mediaFileId} - loading...`);
      this.getAudioBuffer(mediaFileId, videoElementSrc);
      return;
    }

    if (!this.scrubIsActive) {
      log.debug(`Granular scrub starting at ${targetTime.toFixed(2)}s`);
    }

    const ctx = this.getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const scrubVolume = Math.max(0, Math.min(4, options?.volume ?? 1));
    const scrubMasterVolume = Math.max(0, Math.min(4, options?.masterRoute?.volume ?? 1));
    const scrubEqGains = options?.eqGains ?? [];
    const scrubPan = clampAudioPan(options?.pan);
    const scrubProcessors = options?.processors ?? [];
    const processorSignature = scrubProcessorSignature(scrubProcessors);
    const now = performance.now();
    const maxTargetTime = Math.max(0, buffer.duration - SCRUB_GRAIN_DURATION_SECONDS);
    const clampedTarget = Math.max(0, Math.min(targetTime, maxTargetTime));

    const hasPreviousScrubSample = this.scrubLastTime > 0 && Number.isFinite(this.scrubLastPosition);
    const timeDelta = hasPreviousScrubSample ? (now - this.scrubLastTime) / 1000 : 0;
    const posDelta = hasPreviousScrubSample ? clampedTarget - this.scrubLastPosition : 0;
    const sameScrubMedia = this.scrubCurrentMediaId === mediaFileId || this.scrubPausedMediaId === mediaFileId;
    const targetMoved = !hasPreviousScrubSample ||
      !sameScrubMedia ||
      Math.abs(posDelta) > SCRUB_STATIONARY_EPSILON_SECONDS;

    if (targetMoved) {
      this.scrubLastMovementTime = now;
      this.scrubPausedMediaId = null;
      this.scrubPausedPosition = null;
    } else if (
      this.scrubPausedMediaId === mediaFileId &&
      this.scrubPausedPosition !== null &&
      Math.abs(clampedTarget - this.scrubPausedPosition) <= SCRUB_STATIONARY_EPSILON_SECONDS
    ) {
      this.scrubLastPosition = clampedTarget;
      this.scrubLastTime = now;
      return;
    } else if (
      this.scrubLastMovementTime > 0 &&
      now - this.scrubLastMovementTime >= SCRUB_STATIONARY_STOP_MS
    ) {
      this.scrubLastPosition = clampedTarget;
      this.scrubLastTime = now;
      this.pauseStationaryScrubAudio(mediaFileId, clampedTarget);
      return;
    }

    this.scrubLastPosition = clampedTarget;
    this.scrubLastTime = now;

    const needsNewEffectChain =
      !this.scrubSourceGain ||
      this.scrubCurrentMediaId !== mediaFileId ||
      this.scrubProcessorSignature !== processorSignature;

    if (needsNewEffectChain) {
      this.stopScrubAudio({ keepMotionTracking: true });
      this.attachScrubEffectChain(ctx, scrubVolume, scrubEqGains, scrubPan, scrubProcessors);
      this.scrubCurrentMediaId = mediaFileId;
      this.scrubNextGrainTime = ctx.currentTime;
      this.scrubSmoothedVelocity = 0;
    } else {
      this.updateScrubEffects(scrubVolume, scrubEqGains, scrubPan, scrubProcessors);
    }

    if (this.scrubGain && Math.abs(this.scrubGain.gain.value - scrubMasterVolume) > 0.001) {
      this.scrubGain.gain.value = scrubMasterVolume;
    }

    if (targetMoved) {
      const rawVelocity = timeDelta > 0.001 ? posDelta / timeDelta : 0;
      const previousVelocity = this.scrubSmoothedVelocity;
      this.scrubSmoothedVelocity =
        this.scrubSmoothedVelocity === 0
          ? rawVelocity
          : this.scrubSmoothedVelocity + (rawVelocity - this.scrubSmoothedVelocity) * 0.35;
      if (this.scrubSmoothedVelocity < SCRUB_REVERSE_THRESHOLD_SECONDS_PER_SECOND) {
        this.scrubLastDirection = -1;
      } else if (this.scrubSmoothedVelocity > Math.abs(SCRUB_REVERSE_THRESHOLD_SECONDS_PER_SECOND)) {
        this.scrubLastDirection = 1;
      }
      if (this.shouldResyncScrubSchedule(posDelta, rawVelocity, previousVelocity)) {
        this.resyncScrubGrainSchedule(ctx.currentTime);
      }
      this.scheduleScrubGrains(ctx, buffer, clampedTarget, this.scrubSmoothedVelocity);
      this.scheduleStationaryScrubStop(mediaFileId, clampedTarget);
    }
  }

  private shouldResyncScrubSchedule(
    positionDelta: number,
    rawVelocity: number,
    previousVelocity: number,
  ): boolean {
    if (Math.abs(positionDelta) >= SCRUB_RESYNC_POSITION_DELTA_SECONDS) return true;
    if (Math.abs(rawVelocity) >= SCRUB_FAST_VELOCITY_SECONDS_PER_SECOND) return true;
    if (Math.abs(previousVelocity) < 0.001 || Math.abs(rawVelocity) < 0.001) return false;
    return Math.sign(previousVelocity) !== Math.sign(rawVelocity);
  }

  private resyncScrubGrainSchedule(currentTime: number): void {
    this.stopScrubGrainsForResync(currentTime);
    this.scrubNextGrainTime = currentTime;
  }

  private stopScrubGrainsForResync(currentTime: number): void {
    for (const grain of Array.from(this.scrubGrains)) {
      if (grain.startTime <= currentTime) {
        this.fadeOutScrubGrain(grain, currentTime);
        continue;
      }
      try {
        grain.source.onended = null;
        grain.source.stop();
      } catch { /* ignore */ }
      this.cleanupScrubGrain(grain);
    }
  }

  private fadeOutScrubGrain(grain: ScrubGrain, currentTime: number): void {
    const stopTime = currentTime + SCRUB_RESYNC_FADE_OUT_SECONDS;
    try {
      grain.gain.gain.cancelScheduledValues(currentTime);
      grain.gain.gain.setValueAtTime(Math.max(0, grain.gain.gain.value), currentTime);
      grain.gain.gain.linearRampToValueAtTime(0, stopTime);
      grain.source.stop(stopTime);
    } catch {
      try {
        grain.source.onended = null;
        grain.source.stop();
      } catch { /* ignore */ }
      this.cleanupScrubGrain(grain);
    }
  }

  private scheduleScrubGrains(
    ctx: AudioContext,
    buffer: AudioBuffer,
    targetPosition: number,
    velocity: number,
  ): void {
    if (!this.scrubSourceGain) return;

    const scheduleUntil = ctx.currentTime + SCRUB_GRAIN_SCHEDULE_AHEAD_SECONDS;
    if (this.scrubNextGrainTime < ctx.currentTime) {
      this.scrubNextGrainTime = ctx.currentTime;
    }

    let scheduledCount = 0;
    while (this.scrubNextGrainTime < scheduleUntil) {
      const leadSeconds = Math.max(0, this.scrubNextGrainTime - ctx.currentTime);
      const grainPosition = targetPosition + velocity * leadSeconds;
      this.scheduleScrubGrain(ctx, buffer, grainPosition, velocity, this.scrubNextGrainTime);
      this.scrubNextGrainTime += SCRUB_GRAIN_SPACING_SECONDS;
      scheduledCount += 1;
    }

    if (scheduledCount === 0 && Math.abs(velocity) >= SCRUB_FAST_VELOCITY_SECONDS_PER_SECOND) {
      this.resyncScrubGrainSchedule(ctx.currentTime);
      this.scheduleScrubGrain(ctx, buffer, targetPosition, velocity, this.scrubNextGrainTime);
      this.scrubNextGrainTime += SCRUB_GRAIN_SPACING_SECONDS;
    }
  }

  private scheduleScrubGrain(
    ctx: AudioContext,
    buffer: AudioBuffer,
    position: number,
    velocity: number,
    startTime: number,
  ): void {
    const direction: 1 | -1 =
      velocity < SCRUB_REVERSE_THRESHOLD_SECONDS_PER_SECOND ? -1 : this.scrubLastDirection;
    const grainDuration = Math.min(
      SCRUB_GRAIN_DURATION_SECONDS,
      Math.max(0.01, buffer.duration || SCRUB_GRAIN_DURATION_SECONDS),
    );
    const sourceBuffer = direction < 0
      ? this.createReverseScrubGrainBuffer(ctx, buffer, position, grainDuration)
      : buffer;
    const offset = direction < 0
      ? 0
      : this.getScrubGrainOffset(buffer, position, grainDuration);
    const playbackDuration = Math.min(grainDuration, sourceBuffer.duration);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();

    source.buffer = sourceBuffer;
    source.playbackRate.value = 1;
    this.shapeScrubGrainGain(gain.gain, startTime, playbackDuration);

    source.connect(gain);
    gain.connect(this.scrubSourceGain!);

    const grain: ScrubGrain = { source, gain, startTime };
    this.scrubGrains.add(grain);
    this.scrubSource = source;
    this.scrubIsActive = true;

    source.onended = () => {
      this.cleanupScrubGrain(grain);
      if (this.scrubSource === source) {
        this.scrubSource = null;
      }
      if (this.scrubGrains.size === 0 && this.scrubPausedMediaId !== null) {
        this.scrubIsActive = false;
      }
    };

    source.start(startTime, offset, playbackDuration);
  }

  private getScrubGrainOffset(
    buffer: AudioBuffer,
    position: number,
    duration: number,
  ): number {
    const maxOffset = Math.max(0, buffer.duration - duration);
    return Math.max(0, Math.min(position, maxOffset));
  }

  private shapeScrubGrainGain(gain: AudioParam, startTime: number, duration: number): void {
    const fadeSeconds = Math.min(SCRUB_GRAIN_FADE_SECONDS, duration / 3);
    const peakStart = startTime + fadeSeconds;
    const peakEnd = Math.max(peakStart, startTime + duration - fadeSeconds);
    gain.cancelScheduledValues(startTime);
    gain.setValueAtTime(0, startTime);
    gain.linearRampToValueAtTime(SCRUB_GRAIN_PEAK_GAIN, peakStart);
    gain.setValueAtTime(SCRUB_GRAIN_PEAK_GAIN, peakEnd);
    gain.linearRampToValueAtTime(0, startTime + duration);
  }

  private createReverseScrubGrainBuffer(
    ctx: AudioContext,
    buffer: AudioBuffer,
    position: number,
    duration: number,
  ): AudioBuffer {
    const sampleCount = Math.max(
      1,
      Math.min(buffer.length, Math.ceil(duration * buffer.sampleRate)),
    );
    const reversed = ctx.createBuffer(buffer.numberOfChannels, sampleCount, buffer.sampleRate);
    const endSample = Math.max(
      sampleCount,
      Math.min(buffer.length, Math.round(position * buffer.sampleRate)),
    );
    const startSample = endSample - sampleCount;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const source = buffer.getChannelData(channel);
      const target = reversed.getChannelData(channel);
      for (let i = 0; i < sampleCount; i += 1) {
        target[i] = source[startSample + sampleCount - 1 - i] ?? 0;
      }
    }

    return reversed;
  }

  private scheduleStationaryScrubStop(mediaFileId: string, position: number): void {
    this.clearScrubStationaryTimer();
    this.scrubStationaryTimer = setTimeout(() => {
      this.scrubStationaryTimer = null;
      const now = performance.now();
      const sameMedia = this.scrubCurrentMediaId === mediaFileId || this.scrubPausedMediaId === mediaFileId;
      const samePosition = Math.abs(this.scrubLastPosition - position) <= SCRUB_STATIONARY_EPSILON_SECONDS;

      if (
        sameMedia &&
        samePosition &&
        this.scrubLastMovementTime > 0 &&
        now - this.scrubLastMovementTime >= SCRUB_STATIONARY_STOP_MS
      ) {
        this.scrubLastTime = now;
        this.pauseStationaryScrubAudio(mediaFileId, position);
      }
    }, SCRUB_STATIONARY_STOP_MS);
  }

  private pauseStationaryScrubAudio(mediaFileId: string, position: number): void {
    this.clearScrubStationaryTimer();
    this.scrubPausedMediaId = mediaFileId;
    this.scrubPausedPosition = position;
    this.scrubLastPosition = position;
  }

  private clearScrubStationaryTimer(): void {
    if (this.scrubStationaryTimer !== null) {
      clearTimeout(this.scrubStationaryTimer);
      this.scrubStationaryTimer = null;
    }
  }

  /**
   * Stop scrub audio - call when scrubbing ends
   */
  stopScrubAudio(options: { keepMotionTracking?: boolean } = {}): void {
    this.clearScrubStationaryTimer();

    for (const grain of Array.from(this.scrubGrains)) {
      try {
        grain.source.onended = null;
        grain.source.stop();
      } catch { /* ignore */ }
      this.cleanupScrubGrain(grain);
    }
    this.scrubSource = null;
    if (this.scrubSourceGain) {
      try {
        this.scrubSourceGain.disconnect();
      } catch { /* ignore */ }
      this.scrubSourceGain = null;
    }
    if (this.scrubPanNode) {
      try {
        this.scrubPanNode.disconnect();
      } catch { /* ignore */ }
      this.scrubPanNode = null;
    }
    if (this.scrubStereoSplitter) {
      try {
        this.scrubStereoSplitter.disconnect();
      } catch { /* ignore */ }
      this.scrubStereoSplitter = null;
    }
    if (this.scrubLeftAnalyser) {
      try {
        this.scrubLeftAnalyser.disconnect();
      } catch { /* ignore */ }
      this.scrubLeftAnalyser = null;
    }
    if (this.scrubRightAnalyser) {
      try {
        this.scrubRightAnalyser.disconnect();
      } catch { /* ignore */ }
      this.scrubRightAnalyser = null;
    }
    this.scrubLeftMeterBuffer = null;
    this.scrubRightMeterBuffer = null;
    this.scrubFrequencyBuffer = null;
    for (const processor of this.scrubProcessorNodes) {
      for (const node of processor.nodes) {
        try {
          node.disconnect();
        } catch { /* ignore */ }
      }
    }
    for (const filter of this.scrubEqFilters) {
      try {
        filter.disconnect();
      } catch { /* ignore */ }
    }
    this.scrubProcessorNodes = [];
    this.scrubProcessorSignature = '';
    this.scrubEqFilters = [];
    this.scrubIsActive = false;
    this.scrubCurrentMediaId = null;

    // Also reset frame scrub tracking state
    this.resetScrubState();

    if (!options.keepMotionTracking) {
      this.scrubLastPosition = 0;
      this.scrubLastTime = 0;
      this.scrubLastMovementTime = 0;
      this.scrubNextGrainTime = 0;
      this.scrubSmoothedVelocity = 0;
      this.scrubLastDirection = 1;
      this.scrubPausedMediaId = null;
      this.scrubPausedPosition = null;
      this.scrubStationaryTimer = null;
    }
  }

  private cleanupScrubGrain(grain: ScrubGrain): void {
    this.scrubGrains.delete(grain);
    try {
      grain.source.disconnect();
    } catch { /* ignore */ }
    try {
      grain.gain.disconnect();
    } catch { /* ignore */ }
  }

  getScrubMeterSnapshot(updatedAt = performance.now()): AudioMeterSnapshot | null {
    if (!this.scrubAnalyser || !this.scrubMeterBuffer || !this.scrubIsActive) return null;
    this.scrubAnalyser.getFloatTimeDomainData(this.scrubMeterBuffer);
    if (!this.scrubFrequencyBuffer || this.scrubFrequencyBuffer.length !== this.scrubAnalyser.frequencyBinCount) {
      this.scrubFrequencyBuffer = new Float32Array(this.scrubAnalyser.frequencyBinCount);
    }
    this.scrubAnalyser.getFloatFrequencyData(this.scrubFrequencyBuffer);
    const leftAnalyser = this.scrubLeftAnalyser;
    const rightAnalyser = this.scrubRightAnalyser;
    const leftMeterBuffer = this.scrubLeftMeterBuffer;
    const rightMeterBuffer = this.scrubRightMeterBuffer;
    let stereoSamples;

    if (leftAnalyser && rightAnalyser && leftMeterBuffer && rightMeterBuffer) {
      leftAnalyser.getFloatTimeDomainData(leftMeterBuffer);
      rightAnalyser.getFloatTimeDomainData(rightMeterBuffer);
      stereoSamples = { left: leftMeterBuffer, right: rightMeterBuffer };
    }

    return calculateAudioMeterSnapshot(
      this.scrubMeterBuffer,
      updatedAt,
      this.getScrubDynamicsSnapshot(updatedAt),
      stereoSamples,
      new Float32Array(this.scrubFrequencyBuffer),
    );
  }

  /**
   * Check if audio buffer is ready for instant scrubbing
   */
  hasAudioBuffer(mediaFileId: string): boolean {
    return this.audioBufferCache.has(mediaFileId);
  }

  getCachedAudioBuffer(mediaFileId: string): AudioBuffer | null {
    const cached = this.audioBufferCache.get(mediaFileId);
    if (!cached) return null;
    this.touchAudioBufferCacheEntry(mediaFileId, cached);
    return cached;
  }

  private attachScrubEffectChain(
    ctx: AudioContext,
    volume: number,
    eqGains: number[],
    pan: number,
    processors: readonly LiveAudioRouteProcessor[]
  ): void {
    this.scrubSourceGain = ctx.createGain();
    this.scrubSourceGain.gain.value = volume;
    this.scrubPanNode = ctx.createStereoPanner();
    this.scrubPanNode.pan.value = pan;
    this.scrubStereoSplitter = ctx.createChannelSplitter(2);
    this.scrubLeftAnalyser = ctx.createAnalyser();
    this.scrubRightAnalyser = ctx.createAnalyser();
    this.scrubLeftAnalyser.fftSize = this.scrubAnalyser?.fftSize ?? 1024;
    this.scrubRightAnalyser.fftSize = this.scrubAnalyser?.fftSize ?? 1024;
    this.scrubLeftAnalyser.smoothingTimeConstant = this.scrubAnalyser?.smoothingTimeConstant ?? 0.2;
    this.scrubRightAnalyser.smoothingTimeConstant = this.scrubAnalyser?.smoothingTimeConstant ?? 0.2;
    this.scrubLeftMeterBuffer = new Float32Array(this.scrubLeftAnalyser.fftSize);
    this.scrubRightMeterBuffer = new Float32Array(this.scrubRightAnalyser.fftSize);
    this.scrubFrequencyBuffer = new Float32Array(this.scrubAnalyser?.frequencyBinCount ?? 512);
    this.scrubProcessorNodes = processors.map(processor => this.createScrubProcessorNode(ctx, processor));

    this.scrubEqFilters = EQ_FREQUENCIES.map((frequency, index) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.4;
      filter.gain.value = eqGains[index] ?? 0;
      return filter;
    });

    let tail: AudioNode = this.scrubSourceGain;
    for (const processor of this.scrubProcessorNodes) {
      if (processor.inputNode && processor.outputNode) {
        reconnectScrubCustomProcessor(processor);
        tail.connect(processor.inputNode);
        tail = processor.outputNode;
      } else {
        for (const node of processor.nodes) {
          tail.connect(node);
          tail = node;
        }
      }
    }
    tail.connect(this.scrubEqFilters[0]);
    for (let i = 0; i < this.scrubEqFilters.length - 1; i++) {
      this.scrubEqFilters[i].connect(this.scrubEqFilters[i + 1]);
    }
    this.scrubEqFilters[this.scrubEqFilters.length - 1].connect(this.scrubPanNode);
    this.scrubPanNode.connect(this.scrubStereoSplitter);
    this.scrubStereoSplitter.connect(this.scrubLeftAnalyser, 0);
    this.scrubStereoSplitter.connect(this.scrubRightAnalyser, 1);
    this.scrubPanNode.connect(this.scrubAnalyser!);
  }

  private updateScrubEffects(
    volume: number,
    eqGains: number[],
    pan: number,
    processors: readonly LiveAudioRouteProcessor[],
  ): void {
    if (this.scrubSourceGain) {
      this.scrubSourceGain.gain.value = Math.max(0, Math.min(4, volume));
    }
    if (this.scrubPanNode) {
      this.scrubPanNode.pan.value = clampAudioPan(pan);
    }

    for (let i = 0; i < this.scrubEqFilters.length; i++) {
      this.scrubEqFilters[i].gain.value = eqGains[i] ?? 0;
    }

    const ctx = this.audioContext;
    if (!ctx) return;
    processors.forEach((processor, index) => {
      const node = this.scrubProcessorNodes[index];
      if (node) updateScrubProcessorNode(ctx, node, processor);
    });
  }

  private createScrubProcessorNode(
    ctx: BaseAudioContext,
    processor: LiveAudioRouteProcessor,
  ): ScrubProcessorNode {
    if (processor.type === 'pan') {
      const panner = ctx.createStereoPanner();
      const node: ScrubProcessorNode = {
        id: processor.id,
        type: 'pan',
        nodes: [panner],
        panner,
      };
      updateScrubProcessorNode(ctx, node, processor);
      return node;
    }

    if (
      processor.type === 'high-pass' ||
      processor.type === 'low-pass' ||
      processor.type === 'parametric-eq' ||
      processor.type === 'biquad-filter'
    ) {
      const filter = ctx.createBiquadFilter();
      const node: ScrubProcessorNode = {
        id: processor.id,
        type: processor.type,
        nodes: [filter],
        filter,
      };
      updateScrubProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type === 'hum-notch') {
      const input = ctx.createGain();
      const dryGain = ctx.createGain();
      const filters = Array.from({ length: HUM_NOTCH_MAX_HARMONICS }, () => ctx.createBiquadFilter());
      const wetGain = ctx.createGain();
      const output = ctx.createGain();
      const node: ScrubProcessorNode = {
        id: processor.id,
        type: 'hum-notch',
        nodes: [input, dryGain, ...filters, wetGain, output],
        inputNode: input,
        outputNode: output,
        dryGain,
        wetGain,
        filters,
      };
      updateScrubProcessorNode(ctx, node, processor);
      return node;
    }

    if (
      processor.type === 'limiter' ||
      processor.type === 'noise-gate' ||
      processor.type === 'expander' ||
      processor.type === 'de-click' ||
      processor.type === 'noise-reduction' ||
      processor.type === 'spectral-gate' ||
      processor.type === 'dynamic-eq-band' ||
      processor.type === 'saturation' ||
      processor.type === 'polarity-invert' ||
      processor.type === 'mono-sum' ||
      processor.type === 'channel-swap' ||
      processor.type === 'stereo-split'
    ) {
      const scriptProcessor = ctx.createScriptProcessor(1024, 2, 2);
      const node: ScrubProcessorNode = {
        id: processor.id,
        type: processor.type,
        nodes: [scriptProcessor],
        scriptProcessor,
        sampleProcessor: processor,
      };
      attachScrubSampleProcessor(node);
      updateScrubProcessorNode(ctx, node, processor);
      return node;
    }

    if (processor.type !== 'compressor') {
      const gain = ctx.createGain();
      return {
        id: processor.id,
        type: processor.type,
        nodes: [gain],
      };
    }

    const compressor = ctx.createDynamicsCompressor();
    const makeupGain = ctx.createGain();
    const node: ScrubProcessorNode = {
      id: processor.id,
      type: 'compressor',
      nodes: [compressor, makeupGain],
      compressor,
      makeupGain,
    };
    updateScrubProcessorNode(ctx, node, processor);
    return node;
  }

  private getScrubDynamicsSnapshot(updatedAt: number): Record<string, AudioDynamicsReductionSnapshot> | undefined {
    const dynamics: Record<string, AudioDynamicsReductionSnapshot> = {};

    for (const processor of this.scrubProcessorNodes) {
      if (processor.type === 'compressor' && processor.compressor) {
        dynamics[processor.id] = {
          effectId: processor.id,
          processorType: 'compressor',
          gainReductionDb: normalizeScrubDynamicsReductionDb(processor.compressor.reduction),
          updatedAt,
        };
        continue;
      }

      if ((processor.type === 'limiter' || processor.type === 'noise-gate' || processor.type === 'expander' || processor.type === 'dynamic-eq-band') && processor.scriptProcessor) {
        dynamics[processor.id] = {
          effectId: processor.id,
          processorType: processor.type,
          gainReductionDb: normalizeScrubDynamicsReductionDb(processor.gainReductionDb ?? 0),
          updatedAt,
        };
      }
    }

    return Object.keys(dynamics).length > 0 ? dynamics : undefined;
  }

  // Clear cache for a specific media file
  clearForMedia(mediaFileId: string) {
    for (const [key, entry] of this.cache) {
      if (entry.mediaFileId === mediaFileId) {
        this.cache.delete(key);
      }
    }
    this.releaseLegacyFrameCacheResource(mediaFileId);
    for (const [key, entry] of this.videoFrameCache) {
      if (entry.mediaFileId === mediaFileId) {
        entry.frame.close();
        this.videoFrameCache.delete(key);
      }
    }
    this.releaseVideoFrameCacheResource(mediaFileId);
    this.preloadQueue = this.preloadQueue.filter((k) => !k.startsWith(mediaFileId + '_'));
    this.proxyVideoSourcePromises.delete(mediaFileId);

    // Also clear audio cache
    const audio = this.audioCache.get(mediaFileId);
    if (audio) {
      this.disposeAudioProxyElement(mediaFileId, audio);
    }

    this.audioBufferCache.delete(mediaFileId);
    this.releaseAudioBufferResource(mediaFileId);
    this.audioBufferFailed.delete(mediaFileId);
    this.audioBufferRetryTime.delete(mediaFileId);
  }

  // Clear entire cache
  clearAll() {
    const legacyFrameMediaIds = new Set(Array.from(this.cache.values()).map((entry) => entry.mediaFileId));
    const videoFrameMediaIds = new Set(Array.from(this.videoFrameCache.values()).map((entry) => entry.mediaFileId));
    this.cache.clear();
    for (const mediaFileId of legacyFrameMediaIds) {
      this.releaseLegacyFrameCacheResource(mediaFileId);
    }
    for (const entry of this.videoFrameCache.values()) {
      entry.frame.close();
    }
    this.videoFrameCache.clear();
    for (const mediaFileId of videoFrameMediaIds) {
      this.releaseVideoFrameCacheResource(mediaFileId);
    }
    this.videoFrameLoadingPromises.clear();
    this.proxyVideoSourcePromises.clear();
    this.preloadQueue = [];

    // Clear audio cache
    for (const [mediaFileId, audio] of Array.from(this.audioCache.entries())) {
      this.disposeAudioProxyElement(mediaFileId, audio);
    }
    this.audioCache.clear();
    this.ownedAudioUrlLeaseIds.clear();

    const audioBufferMediaIds = Array.from(this.audioBufferCache.keys());
    this.audioBufferCache.clear();
    for (const mediaFileId of audioBufferMediaIds) {
      this.releaseAudioBufferResource(mediaFileId);
    }

    // Clean up audio context
    this.disposeAudioContext();
  }

  clearAudioBufferCache(): void {
    const audioBufferMediaIds = Array.from(this.audioBufferCache.keys());
    this.audioBufferCache.clear();
    for (const mediaFileId of audioBufferMediaIds) {
      this.releaseAudioBufferResource(mediaFileId);
    }
    this.audioBufferFailed.clear();
    this.audioBufferRetryTime.clear();
    this.audioBufferLoading.clear();
  }

  /**
   * Dispose the AudioContext used for scrub audio.
   * Stops active scrub audio, closes the context, and resets state.
   */
  disposeAudioContext(): void {
    // Stop any active scrub audio first
    this.stopScrubAudio();

    // Close the AudioContext
    if (this.audioContext) {
      mediaRuntimeScrubAudioLeaseOwner.releaseAudioContext(
        this.getScrubAudioContextRuntimeSourceId(),
        'proxy-frame-cache:dispose-audio-context'
      );
    }
    this.audioContext = null;
    this.scrubGain = null;
    this.scrubAnalyser = null;
    this.scrubStereoSplitter = null;
    this.scrubLeftAnalyser = null;
    this.scrubRightAnalyser = null;
    this.scrubMeterBuffer = null;
    this.scrubLeftMeterBuffer = null;
    this.scrubRightMeterBuffer = null;
    this.scrubFrequencyBuffer = null;

    // Clear audio buffer cache (buffers are tied to the old context)
    const audioBufferMediaIds = Array.from(this.audioBufferCache.keys());
    this.audioBufferCache.clear();
    for (const mediaFileId of audioBufferMediaIds) {
      this.releaseAudioBufferResource(mediaFileId);
    }
    this.audioBufferFailed.clear();
    this.audioBufferRetryTime.clear();

    log.info('AudioContext disposed');
  }

  // Bulk preload frames around a position - call when scrubbing starts
  async preloadAroundPosition(mediaFileId: string, frameIndex: number, _fps: number = 30, range: number = SCRUB_PRELOAD_RANGE): Promise<void> {
    const framesToPreload: string[] = [];

    // Generate list of frames to preload (current position +/- range)
    for (let i = -range; i <= range; i++) {
      const frame = frameIndex + i;
      if (frame < 0) continue;

      const key = this.getKey(mediaFileId, frame);
      if (!this.cache.has(key) && !this.preloadQueue.includes(key)) {
        framesToPreload.push(key);
      }
    }

    // Add all to front of queue (highest priority)
    this.preloadQueue = [...framesToPreload, ...this.preloadQueue];

    // Start preloading if not already
    if (!this.isPreloading) {
      this.processPreloadQueue();
    }

    log.debug(`Bulk preload started: ${framesToPreload.length} frames around frame ${frameIndex}`);
  }

  // Preload ALL frames for a media file (for manual cache button)
  // Returns a promise that resolves when preloading is complete
  // onProgress callback receives (loadedFrames, totalFrames)
  async preloadAllFrames(
    mediaFileId: string,
    totalFrames: number,
    _fps: number,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    log.info(`Starting full preload for ${mediaFileId}: ${totalFrames} frames`);

    let loadedCount = 0;
    const batchSize = 32; // Load 32 frames at a time

    for (let startFrame = 0; startFrame < totalFrames; startFrame += batchSize) {
      const endFrame = Math.min(startFrame + batchSize, totalFrames);
      const batch: Promise<void>[] = [];

      for (let frame = startFrame; frame < endFrame; frame++) {
        const key = this.getKey(mediaFileId, frame);

        // Skip if already cached
        if (this.cache.has(key)) {
          loadedCount++;
          continue;
        }

        // Load frame
        batch.push(
          this.loadFrame(mediaFileId, frame).then(image => {
            if (image) {
              this.addToCache(mediaFileId, frame, image);
            }
            loadedCount++;
          })
        );
      }

      // Wait for batch to complete
      await Promise.all(batch);

      // Report progress
      if (onProgress) {
        onProgress(loadedCount, totalFrames);
      }

      // Yield to main thread
      await new Promise(r => setTimeout(r, 0));
    }

    log.info(`Full preload complete for ${mediaFileId}: ${loadedCount}/${totalFrames} frames cached`);
  }

  // Cancel ongoing preload (for when user clicks stop or navigates away)
  cancelPreload(): void {
    this.preloadQueue = [];
    log.debug('Preload cancelled');
  }

  // Get cache stats with more detail
  getStats() {
    return {
      cachedFrames: this.cache.size,
      maxCacheSize: MAX_CACHE_SIZE,
      preloadQueueSize: this.preloadQueue.length,
      isPreloading: this.isPreloading,
      isScrubbing: this.isScrubbing,
      scrubDirection: this.scrubDirection,
      scrubPreloadQueueDrops: this.scrubPreloadQueueDrops,
      hitRate: this.cacheHits / Math.max(1, this.cacheHits + this.cacheMisses),
    };
  }

  // Cache hit/miss tracking
  private cacheHits = 0;
  private cacheMisses = 0;

  // Log cache performance (call periodically for debugging)
  logPerformance(): void {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? (this.cacheHits / total * 100).toFixed(1) : '0';
    log.debug(`Hit rate: ${hitRate}% (${this.cacheHits}/${total}), cached: ${this.cache.size}/${MAX_CACHE_SIZE}, queue: ${this.preloadQueue.length}`);
  }

  // Reset performance counters
  resetPerformanceCounters(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // Get cached frame ranges for a specific media file (for timeline display)
  // Returns ranges in seconds relative to media file start
  getCachedRanges(mediaFileId: string, fps: number = 30): Array<{ start: number; end: number }> {
    // Collect all cached frame indices for this media file
    const cachedFrames: number[] = [];
    for (const [, entry] of this.cache) {
      if (entry.mediaFileId === mediaFileId) {
        cachedFrames.push(entry.frameIndex);
      }
    }
    for (const [, entry] of this.videoFrameCache) {
      if (entry.mediaFileId === mediaFileId) {
        cachedFrames.push(entry.frameIndex);
      }
    }

    if (cachedFrames.length === 0) return [];

    // Sort frames
    cachedFrames.sort((a, b) => a - b);

    // Convert to time ranges, merging adjacent frames
    const ranges: Array<{ start: number; end: number }> = [];
    const frameInterval = 1 / fps;
    const maxGap = frameInterval * 3; // Allow gap of 3 frames before starting new range

    let rangeStart = cachedFrames[0] / fps;
    let rangeEnd = rangeStart + frameInterval;

    for (let i = 1; i < cachedFrames.length; i++) {
      const frameTime = cachedFrames[i] / fps;
      if (frameTime - rangeEnd <= maxGap) {
        // Extend current range
        rangeEnd = frameTime + frameInterval;
      } else {
        // Save current range and start new one
        ranges.push({ start: rangeStart, end: rangeEnd });
        rangeStart = frameTime;
        rangeEnd = frameTime + frameInterval;
      }
    }

    // Add final range
    ranges.push({ start: rangeStart, end: rangeEnd });

    return ranges;
  }

  // Get all cached media file IDs
  getCachedMediaIds(): string[] {
    const ids = new Set<string>();
    for (const entry of this.cache.values()) {
      ids.add(entry.mediaFileId);
    }
    return Array.from(ids);
  }
}

// Singleton instance
export const proxyFrameCache = new ProxyFrameCache();

// Global user interaction listener to unlock AudioContext as early as possible.
// Chrome requires a user gesture to start/resume AudioContext.
// This fires on the FIRST interaction with the page (any click, key, touch).
if (typeof document !== 'undefined') {
  const unlockAudio = () => {
    proxyFrameCache.ensureAudioContextResumed();
    document.removeEventListener('mousedown', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  };
  document.addEventListener('mousedown', unlockAudio, { capture: true });
  document.addEventListener('keydown', unlockAudio, { capture: true });
  document.addEventListener('touchstart', unlockAudio, { capture: true });
}
