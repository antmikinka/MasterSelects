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
  createProxyFramePreloadState,
  enqueueProxyFramesAroundPosition,
  preloadAllProxyFrames,
  processProxyFramePreloadQueue,
  scheduleProxyFramePreload,
  SCRUB_PRELOAD_RANGE,
  updateProxyFrameScrubDirection,
} from './proxyFrame/preloadScheduler';
import { ScrubAudioPlaybackController } from './proxyFrame/scrubAudioPlayback';
import type { ScrubAudioOptions } from './proxyFrame/scrubAudioModels';
import {
  decodeProxyVideoFrameFromSource,
  parseProxyVideoFile,
  type ProxyVideoSourceState,
} from './proxyFrame/proxyVideoParser';
export type { ProxyCachedFrame, ProxyCachedVideoFrame } from './proxyFrame/frameCacheModels';

const log = Logger.create('ProxyFrameCache');
import { fileSystemService } from './fileSystemService';
import { useMediaStore } from '../stores/mediaStore';
import { timelineRuntimeCoordinator } from './timeline/timelineRuntimeCoordinator';
import type { TimelineRuntimeAdmissionDecision } from './timeline/runtimeCoordinatorTypes';
import type { AudioMeterSnapshot } from '../types';

// Cache settings - tuned for fast scrubbing
const MAX_CACHE_SIZE = 900; // 30 seconds at 30fps - larger cache for scrubbing
const MAX_VIDEO_FRAME_CACHE_SIZE = 120;
const JPEG_PROXY_FRAMES_ENABLED = true;
const MAX_AUDIO_BUFFER_CACHE_BYTES = 192 * 1024 * 1024;
const MAX_AUDIO_BUFFER_CACHE_ENTRIES = 3;



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
  private readonly preloadState = createProxyFramePreloadState();
  private readonly scrubPlayback = new ScrubAudioPlaybackController(
    () => this.resetScrubState(),
    (message) => log.debug(message),
  );
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

  get preloadQueue(): string[] {
    return this.preloadState.preloadQueue;
  }

  set preloadQueue(value: string[]) {
    this.preloadState.preloadQueue = value;
  }

  get isPreloading(): boolean {
    return this.preloadState.isPreloading;
  }

  set isPreloading(value: boolean) {
    this.preloadState.isPreloading = value;
  }

  get lastScrubFrame(): number {
    return this.preloadState.lastScrubFrame;
  }

  set lastScrubFrame(value: number) {
    this.preloadState.lastScrubFrame = value;
  }

  get scrubDirection(): number {
    return this.preloadState.scrubDirection;
  }

  set scrubDirection(value: number) {
    this.preloadState.scrubDirection = value;
  }

  get isScrubbing(): boolean {
    return this.preloadState.isScrubbing;
  }

  set isScrubbing(value: boolean) {
    this.preloadState.isScrubbing = value;
  }

  get scrubPreloadQueueDrops(): number {
    return this.preloadState.scrubPreloadQueueDrops;
  }

  set scrubPreloadQueueDrops(value: number) {
    this.preloadState.scrubPreloadQueueDrops = value;
  }

  get scrubIsActive(): boolean {
    return this.scrubPlayback.isActive;
  }

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

  // Schedule preloading of frames around current position (bidirectional)
  private schedulePreload(mediaFileId: string, currentFrameIndex: number, fps: number) {
    scheduleProxyFramePreload({
      state: this.preloadState,
      mediaFileId,
      currentFrameIndex,
      fps,
      getKey: (id, frame) => this.getKey(id, frame),
      hasCachedFrame: (key) => this.cache.has(key),
      startPreloading: () => {
        void this.processPreloadQueue();
      },
    });
  }

  private updateScrubDirection(currentFrameIndex: number): void {
    updateProxyFrameScrubDirection(this.preloadState, currentFrameIndex);
  }

  // Call this when scrubbing stops to reset state
  resetScrubState(): void {
    this.preloadState.isScrubbing = false;
    this.preloadState.scrubDirection = 0;
    this.preloadState.lastScrubFrame = -1;
  }

  // Process preload queue with parallel loading for speed
  private async processPreloadQueue() {
    await processProxyFramePreloadQueue({
      state: this.preloadState,
      hasCachedFrame: (key) => this.cache.has(key),
      loadFrame: (id, frame) => this.loadFrame(id, frame),
      addToCache: (id, frame, image) => {
        this.addToCache(id, frame, image);
      },
    });
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
      this.scrubPlayback.initializeAudioContext(this.audioContext);
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

    this.scrubPlayback.playScrubAudio({
      mediaFileId,
      targetTime,
      buffer,
      getAudioContext: () => this.getAudioContext(),
      options,
    });
  }

  /**
   * Stop scrub audio - call when scrubbing ends
   */
  stopScrubAudio(options: { keepMotionTracking?: boolean } = {}): void {
    this.scrubPlayback.stopScrubAudio(options);
  }

  getScrubMeterSnapshot(updatedAt = performance.now()): AudioMeterSnapshot | null {
    return this.scrubPlayback.getScrubMeterSnapshot(updatedAt);
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
    this.scrubPlayback.disposeAudioContextState();

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
    enqueueProxyFramesAroundPosition({
      state: this.preloadState,
      mediaFileId,
      frameIndex,
      range,
      getKey: (id, frame) => this.getKey(id, frame),
      hasCachedFrame: (key) => this.cache.has(key),
      startPreloading: () => {
        void this.processPreloadQueue();
      },
      logDebug: (message) => log.debug(message),
    });
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
    await preloadAllProxyFrames({
      mediaFileId,
      totalFrames,
      getKey: (id, frame) => this.getKey(id, frame),
      hasCachedFrame: (key) => this.cache.has(key),
      loadFrame: (id, frame) => this.loadFrame(id, frame),
      addToCache: (id, frame, image) => {
        this.addToCache(id, frame, image);
      },
      onProgress,
      logInfo: (message) => log.info(message),
    });
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
