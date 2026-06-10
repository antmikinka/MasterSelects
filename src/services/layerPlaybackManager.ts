// LayerPlaybackManager - Manages background composition playback for Resolume-style multi-layer mode
// Each slot grid layer (A-D) can have an active composition; this service loads their media elements
// and provides layers for rendering. The primary (editor) composition is handled by the timeline store.

import type { TimelineClip, Layer, NestedCompositionData } from '../types';
import { engine } from '../engine/WebGPUEngine';
import { useMediaStore } from '../stores/mediaStore';
import { useTimelineStore } from '../stores/timeline';
import {
  bindSourceRuntimeForOwner,
  planSourceRuntimeBindingForOwner,
} from './mediaRuntime/clipBindings';
import { mediaRuntimeRegistry } from './mediaRuntime/registry';
import { flags } from '../engine/featureFlags';
import { Logger } from './logger';
import { slotDeckManager } from './slotDeckManager';
import { vectorAnimationRuntimeManager } from './vectorAnimation/VectorAnimationRuntimeManager';
import { isVectorAnimationSourceType, type VectorAnimationProvider } from '../types/vectorAnimation';
import {
  releaseReportedClipRuntimeResources,
  reportClipRuntimeResources,
  reservePlannedClipRuntimeResources,
} from './timeline/runtimeResourceReporting';
import {
  startTimelineImageHydration,
  type TimelineImageHydrationHandle,
} from './timeline/imageRuntimeHydrator';
import { createLayerTimelineClip } from './layerPlayback/clipHydration';
import { buildBackgroundInnerLayers } from './layerPlayback/innerLayerBuilder';
import type { LayerCompState, LayerPlaybackInfo, PlaybackWindow } from './layerPlayback/layerPlaybackState';
import {
  getAnchoredLayerTime,
  resolveInitialLayerTime,
  resolveLayerPlaybackDecision,
  resolvePlaybackWindow,
} from './layerPlayback/playbackTiming';
import { syncAudioClipToPlayback, syncVideoClipToPlayback } from './layerPlayback/mediaSync';
import { createActiveLayerState } from './layerPlayback/stateFactory';
import { createBackgroundImageDemand, getRuntimeSrcKind } from './layerPlayback/runtimeDemand';

const log = Logger.create('LayerPlayback');

class LayerPlaybackManager {
  private pendingImageHydrations = new Map<string, TimelineImageHydrationHandle>();
  private pendingVideoDisposers = new Map<string, () => void>();

  private getRuntimeOwnerId(layerIndex: number, clipId: string): string {
    return `background:${layerIndex}:${clipId}`;
  }

  private cleanupVideoElement(video: HTMLVideoElement): void {
    video.pause();
    engine.cleanupVideo(video);
    video.removeAttribute('src');
    video.src = '';
    try {
      video.load();
    } catch {
      // Browser teardown can race media loading; releasing GPU/cache state is the important part.
    }
  }

  private disposePendingVideo(ownerId: string): void {
    const dispose = this.pendingVideoDisposers.get(ownerId);
    if (!dispose) {
      return;
    }
    dispose();
  }

  // Layer index (0=A, 1=B, 2=C, 3=D) → loaded composition state
  private layerStates = new Map<number, LayerCompState>();

  /**
   * Activate a composition on a layer — loads its timelineData and creates media elements
   */
  activateLayer(
    layerIndex: number,
    compositionId: string,
    initialElapsed?: number,
    options?: { slotIndex?: number | null }
  ): void {
    // Deactivate current layer first
    this.deactivateLayer(layerIndex);

    const preparedDeck =
      flags.useWarmSlotDecks && options?.slotIndex !== undefined && options.slotIndex !== null
        ? slotDeckManager.getPreparedDeck(options.slotIndex, compositionId)
        : null;

    if (preparedDeck && options?.slotIndex !== undefined && options.slotIndex !== null) {
      const adopted = slotDeckManager.adoptDeckToLayer(options.slotIndex, layerIndex, initialElapsed);
      if (adopted) {
        const initialTime = this.getInitialLayerTime(compositionId, preparedDeck.duration, initialElapsed);
        this.layerStates.set(layerIndex, createActiveLayerState({
          compositionId,
          composition: preparedDeck.composition,
          clips: preparedDeck.clips,
          tracks: preparedDeck.tracks,
          duration: preparedDeck.duration,
          initialTime,
          nowMs: performance.now(),
          resourceOwnership: 'slot-deck',
          slotIndex: options.slotIndex,
        }));
        log.info(`Adopted warm slot deck ${options.slotIndex} onto layer ${layerIndex}`);
        return;
      }
    }

    const { compositions, files } = useMediaStore.getState();
    const comp = compositions.find(c => c.id === compositionId);
    if (!comp) {
      log.warn(`Composition ${compositionId} not found`);
      return;
    }

    const timelineData = comp.timelineData;
    if (!timelineData || !timelineData.clips || timelineData.clips.length === 0) {
      log.info(`Composition ${comp.name} has no timeline data, activating with empty state`);
      const initialTime = this.getInitialLayerTime(compositionId, comp.duration, initialElapsed);
      this.layerStates.set(layerIndex, createActiveLayerState({
        compositionId,
        composition: comp,
        clips: [],
        tracks: timelineData?.tracks || [],
        duration: comp.duration,
        initialTime,
        nowMs: performance.now(),
        resourceOwnership: 'layer',
        slotIndex: null,
      }));
      return;
    }

    // Hydrate serialized clips into live TimelineClips with media elements
    const hydratedClips: TimelineClip[] = [];

    for (const serializedClip of timelineData.clips) {
      const mediaFile = files.find(f => f.id === serializedClip.mediaFileId);
      const clip = createLayerTimelineClip(serializedClip, mediaFile);

      if (!mediaFile && !serializedClip.isComposition) {
        // Can't load without media file (unless it's a nested comp)
        clip.isLoading = false;
        hydratedClips.push(clip);
        continue;
      }

      const sourceType = serializedClip.sourceType;
      const fileUrl = mediaFile?.url;

      if (sourceType === 'video' && fileUrl) {
        clip.isLoading = true;
        this.loadVideoForClip(clip, layerIndex, fileUrl, serializedClip.mediaFileId);
      } else if (sourceType === 'audio' && fileUrl) {
        clip.isLoading = true;
        this.loadAudioForClip(clip, layerIndex, fileUrl, serializedClip.mediaFileId);
      } else if (sourceType === 'image' && fileUrl) {
        clip.isLoading = true;
        this.loadImageForClip(clip, layerIndex, fileUrl);
      } else if (isVectorAnimationSourceType(sourceType) && mediaFile?.file) {
        clip.isLoading = true;
        clip.source = {
          type: sourceType,
          mediaFileId: serializedClip.mediaFileId,
          naturalDuration: serializedClip.naturalDuration,
          vectorAnimationSettings: serializedClip.vectorAnimationSettings,
        };
        this.loadVectorAnimationForClip(clip, layerIndex, mediaFile.file, sourceType);
      } else {
        clip.isLoading = false;
      }

      hydratedClips.push(clip);
    }

    const initialTime = this.getInitialLayerTime(compositionId, comp.duration, initialElapsed);
    this.layerStates.set(layerIndex, createActiveLayerState({
      compositionId,
      composition: comp,
      clips: hydratedClips,
      tracks: timelineData.tracks,
      duration: comp.duration,
      initialTime,
      nowMs: performance.now(),
      resourceOwnership: 'layer',
      slotIndex: null,
    }));

    log.info(`Activated layer ${layerIndex} with composition "${comp.name}" (${hydratedClips.length} clips, initialElapsed=${initialElapsed ?? 0}s)`);
  }

  /**
   * Deactivate a layer — pause and clean up media elements
   */
  deactivateLayer(layerIndex: number): void {
    const state = this.layerStates.get(layerIndex);
    if (!state) return;

    if (state.resourceOwnership === 'slot-deck' && state.slotIndex !== null) {
      for (const clip of state.clips) {
        clip.source?.videoElement?.pause();
        clip.source?.audioElement?.pause();
      }
      slotDeckManager.releaseLayerPin(state.slotIndex, layerIndex);
      this.layerStates.delete(layerIndex);
      log.info(`Deactivated slot-deck-backed layer ${layerIndex}`);
      return;
    }

    for (const clip of state.clips) {
      const ownerId = this.getRuntimeOwnerId(layerIndex, clip.id);
      this.pendingImageHydrations.get(ownerId)?.cancel();
      this.pendingImageHydrations.delete(ownerId);
      this.disposePendingVideo(ownerId);
      releaseReportedClipRuntimeResources('background', ownerId);
      if (clip.source?.videoElement) {
        this.cleanupVideoElement(clip.source.videoElement);
      }
      if (clip.source?.audioElement) {
        clip.source.audioElement.pause();
        clip.source.audioElement.src = '';
        clip.source.audioElement.load();
      }
      if (clip.source?.imageElement) {
        clip.source.imageElement.removeAttribute('src');
        clip.source.imageElement.src = '';
      }
      if (isVectorAnimationSourceType(clip.source?.type)) {
        vectorAnimationRuntimeManager.destroyClipRuntime(clip.id, clip.source.type);
      }
      if (clip.source?.runtimeSourceId && clip.source.runtimeSessionKey) {
        mediaRuntimeRegistry.releaseSession(
          clip.source.runtimeSourceId,
          clip.source.runtimeSessionKey
        );
        mediaRuntimeRegistry.releaseRuntime(
          clip.source.runtimeSourceId,
          this.getRuntimeOwnerId(layerIndex, clip.id)
        );
      }
    }

    this.layerStates.delete(layerIndex);
    log.info(`Deactivated layer ${layerIndex}`);
  }

  /**
   * Deactivate all layers
   */
  deactivateAll(): void {
    for (const layerIndex of Array.from(this.layerStates.keys())) {
      this.deactivateLayer(layerIndex);
    }
  }

  /**
   * Get the state for a layer (or undefined if not active)
   */
  getLayerState(layerIndex: number): LayerCompState | undefined {
    return this.layerStates.get(layerIndex);
  }

  /**
   * Check if a layer has an active composition
   */
  isLayerActive(layerIndex: number): boolean {
    return this.layerStates.has(layerIndex);
  }

  getLayerPlaybackInfo(layerIndex: number): LayerPlaybackInfo | null {
    const state = this.layerStates.get(layerIndex);
    if (!state) {
      return null;
    }

    return this.resolveLayerPlayback(state, layerIndex);
  }

  playLayer(layerIndex: number): void {
    const state = this.layerStates.get(layerIndex);
    if (!state) {
      return;
    }

    const { trimIn, trimOut, endBehavior } = this.getPlaybackWindow(state);
    const resolved = this.resolveLayerPlayback(state, layerIndex);
    const restartAtTrimIn =
      endBehavior !== 'loop' &&
      resolved.currentTime >= trimOut - 0.0001;

    state.anchorTime = restartAtTrimIn ? trimIn : Math.max(trimIn, Math.min(resolved.currentTime, trimOut));
    state.anchorStartedAt = performance.now();
    state.playbackState = 'playing';
    state.clearRequested = false;
  }

  pauseLayer(layerIndex: number): void {
    const state = this.layerStates.get(layerIndex);
    if (!state) {
      return;
    }

    const resolved = this.resolveLayerPlayback(state, layerIndex);
    state.anchorTime = resolved.currentTime;
    state.anchorStartedAt = performance.now();
    state.playbackState = 'paused';
    state.clearRequested = false;
    this.pauseMediaElements(state);
  }

  stopLayer(layerIndex: number): void {
    const state = this.layerStates.get(layerIndex);
    if (!state) {
      return;
    }

    const { trimIn } = this.getPlaybackWindow(state);
    state.anchorTime = trimIn;
    state.anchorStartedAt = performance.now();
    state.playbackState = 'stopped';
    state.clearRequested = false;
    this.pauseMediaElements(state);
  }

  /**
   * Build render layers for a background composition.
   * Uses independent wall-clock time per layer, NOT the global playhead.
   */
  buildLayersForLayer(layerIndex: number, _playheadPosition: number): Layer | null {
    const state = this.layerStates.get(layerIndex);
    if (!state) return null;

    const playback = this.resolveLayerPlayback(state, layerIndex);
    if (!playback.shouldRender) {
      return null;
    }

    const layerTime = playback.currentTime;
    const innerLayers = buildBackgroundInnerLayers(
      state,
      layerTime,
      (clipId, clipLocalTime) =>
        useTimelineStore.getState().getInterpolatedVectorAnimationSettings(clipId, clipLocalTime)
    );
    if (innerLayers.length === 0) return null;

    const nestedCompData: NestedCompositionData = {
      compositionId: state.compositionId,
      layers: innerLayers,
      width: state.composition.width,
      height: state.composition.height,
      currentTime: layerTime,
    };

    // Read per-layer opacity from store
    const layerOpacity = useMediaStore.getState().layerOpacities[layerIndex] ?? 1;

    // Wrap as a single full-screen layer
    const layer: Layer = {
      id: `bg-layer-${layerIndex}-${state.compositionId}`,
      name: `Layer ${String.fromCharCode(65 + layerIndex)}: ${state.composition.name}`,
      visible: true,
      opacity: layerOpacity,
      blendMode: 'normal',
      source: { type: 'image', nestedComposition: nestedCompData },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };

    return layer;
  }

  private getPlaybackWindow(state: LayerCompState): PlaybackWindow {
    const slotClipSettings = useMediaStore.getState().slotClipSettings ?? {};
    const configured = slotClipSettings[state.compositionId];
    return resolvePlaybackWindow(state.duration, configured);
  }

  private getInitialLayerTime(compositionId: string, duration: number, initialElapsed?: number): number {
    const slotClipSettings = useMediaStore.getState().slotClipSettings ?? {};
    const configured = slotClipSettings[compositionId];
    return resolveInitialLayerTime(duration, configured, initialElapsed);
  }

  private requestClearLayer(layerIndex: number, state: LayerCompState): void {
    if (state.clearRequested) {
      return;
    }

    state.clearRequested = true;
    this.pauseMediaElements(state);
    useMediaStore.getState().deactivateLayer(layerIndex);
  }

  private resolveLayerPlayback(state: LayerCompState, layerIndex: number): LayerPlaybackInfo {
    const playbackWindow = this.getPlaybackWindow(state);
    const rawTime = getAnchoredLayerTime(state, performance.now());
    const decision = resolveLayerPlaybackDecision(state, playbackWindow, rawTime);

    if (decision.endAction === 'hold') {
      state.anchorTime = decision.nextAnchorTime ?? playbackWindow.trimOut;
      state.anchorStartedAt = performance.now();
      state.playbackState = decision.nextPlaybackState ?? 'paused';
    } else if (decision.endAction === 'clear') {
      state.anchorTime = decision.nextAnchorTime ?? playbackWindow.trimIn;
      state.anchorStartedAt = performance.now();
      state.playbackState = decision.nextPlaybackState ?? 'stopped';
      this.requestClearLayer(layerIndex, state);
    }

    return {
      compositionId: decision.compositionId,
      currentTime: decision.currentTime,
      trimIn: decision.trimIn,
      trimOut: decision.trimOut,
      endBehavior: decision.endBehavior,
      playbackState: decision.playbackState,
      shouldRender: decision.shouldRender,
    };
  }

  private pauseMediaElements(state: LayerCompState): void {
    for (const clip of state.clips) {
      clip.source?.videoElement?.pause();
      clip.source?.audioElement?.pause();
    }
  }

  /**
   * Sync video elements for all background layers (each uses its own independent time)
   */
  syncVideoElements(_playheadPosition: number, _isPlaying: boolean): void {
    for (const [layerIndex, state] of this.layerStates) {
      const playback = this.resolveLayerPlayback(state, layerIndex);

      for (const clip of state.clips) {
        syncVideoClipToPlayback(clip, playback);
      }
    }
  }

  /**
   * Sync audio elements for all background layers (each uses its own independent time)
   */
  syncAudioElements(_playheadPosition: number, _isPlaying: boolean): void {
    for (const [layerIndex, state] of this.layerStates) {
      const playback = this.resolveLayerPlayback(state, layerIndex);

      for (const clip of state.clips) {
        syncAudioClipToPlayback(clip, playback);
      }
    }
  }

  /**
   * Check if any background layers are active
   */
  hasActiveLayers(): boolean {
    return this.layerStates.size > 0;
  }

  /**
   * Get all active layer indices
   */
  getActiveLayerIndices(): number[] {
    return Array.from(this.layerStates.keys());
  }

  // === Private media loading methods ===

  private loadVideoForClip(clip: TimelineClip, layerIndex: number, url: string, mediaFileId: string): void {
    const ownerId = this.getRuntimeOwnerId(layerIndex, clip.id);
    const runtimePlan = planSourceRuntimeBindingForOwner({
      ownerId,
      source: {
        type: 'video',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaFileId,
      sessionPolicy: 'background',
      sessionOwnerId: ownerId,
    });
    const admission = reservePlannedClipRuntimeResources({
      policyId: 'background',
      ownerId,
      ownerType: 'clip',
      clip,
      source: runtimePlan?.source ?? {
        type: 'video',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaElementKind: 'video',
      srcKind: getRuntimeSrcKind(url),
      label: `Background layer ${layerIndex} clip resource`,
      tags: ['background-layer', `layer-${layerIndex}`],
    });
    if (!admission.admitted) {
      clip.isLoading = false;
      log.debug('Background video load skipped by runtime admission', {
        clipId: clip.id,
        layerIndex,
        reason: admission.decision.reason,
        rejectedUnits: admission.decision.rejectedUnits.map((entry) => entry.unit),
      });
      return;
    }

    this.disposePendingVideo(ownerId);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true; // Background layers muted by default
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    let disposed = false;
    const disposePending = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      video.removeEventListener('canplaythrough', onCanPlayThrough);
      video.removeEventListener('error', onError);
      admission.release();
      this.cleanupVideoElement(video);
      if (this.pendingVideoDisposers.get(ownerId) === disposePending) {
        this.pendingVideoDisposers.delete(ownerId);
      }
    };
    const onCanPlayThrough = () => {
      if (disposed) {
        return;
      }
      if (this.layerStates.get(layerIndex)?.clips.includes(clip) !== true) {
        disposePending();
        return;
      }
      disposed = true;
      video.removeEventListener('error', onError);
      if (this.pendingVideoDisposers.get(ownerId) === disposePending) {
        this.pendingVideoDisposers.delete(ownerId);
      }
      clip.source = bindSourceRuntimeForOwner({
        ownerId,
        source: {
          type: 'video',
          videoElement: video,
          naturalDuration: video.duration,
          mediaFileId,
        },
        mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: ownerId,
      });
      this.reportClipResources(layerIndex, clip);
      clip.isLoading = false;
      log.debug(`Video loaded for background clip ${clip.name} on layer ${layerIndex}`);
      // Pre-cache frame via createImageBitmap for immediate scrubbing without play()
      engine.preCacheVideoFrame(video);
    };

    const onError = () => {
      disposePending();
      clip.isLoading = false;
      log.warn(`Failed to load video for background clip ${clip.name}`);
    };

    this.pendingVideoDisposers.set(ownerId, disposePending);
    video.addEventListener('canplaythrough', onCanPlayThrough, { once: true });
    video.addEventListener('error', onError, { once: true });
  }

  private loadAudioForClip(clip: TimelineClip, layerIndex: number, url: string, mediaFileId: string): void {
    const ownerId = this.getRuntimeOwnerId(layerIndex, clip.id);
    const runtimePlan = planSourceRuntimeBindingForOwner({
      ownerId,
      source: {
        type: 'audio',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaFileId,
      sessionPolicy: 'background',
      sessionOwnerId: ownerId,
    });
    const admission = reservePlannedClipRuntimeResources({
      policyId: 'background',
      ownerId,
      ownerType: 'clip',
      clip,
      source: runtimePlan?.source ?? {
        type: 'audio',
        mediaFileId,
        naturalDuration: clip.source?.naturalDuration ?? clip.duration,
      },
      mediaElementKind: 'audio',
      srcKind: getRuntimeSrcKind(url),
      label: `Background layer ${layerIndex} clip resource`,
      tags: ['background-layer', `layer-${layerIndex}`],
    });
    if (!admission.admitted) {
      clip.isLoading = false;
      log.debug('Background audio load skipped by runtime admission', {
        clipId: clip.id,
        layerIndex,
        reason: admission.decision.reason,
        rejectedUnits: admission.decision.rejectedUnits.map((entry) => entry.unit),
      });
      return;
    }

    const audio = document.createElement('audio');
    audio.src = url;
    audio.preload = 'auto';

    audio.addEventListener('canplaythrough', () => {
      if (this.layerStates.get(layerIndex)?.clips.includes(clip) !== true) {
        admission.release();
        audio.pause();
        audio.src = '';
        audio.load();
        return;
      }
      clip.source = bindSourceRuntimeForOwner({
        ownerId,
        source: {
          type: 'audio',
          audioElement: audio,
          naturalDuration: audio.duration,
          mediaFileId,
        },
        mediaFileId,
        sessionPolicy: 'background',
        sessionOwnerId: ownerId,
      });
      this.reportClipResources(layerIndex, clip);
      clip.isLoading = false;
      log.debug(`Audio loaded for background clip ${clip.name} on layer ${layerIndex}`);
    }, { once: true });

    audio.addEventListener('error', () => {
      admission.release();
      clip.isLoading = false;
      log.warn(`Failed to load audio for background clip ${clip.name}`);
    }, { once: true });
  }

  private loadImageForClip(clip: TimelineClip, layerIndex: number, url: string): void {
    const ownerId = this.getRuntimeOwnerId(layerIndex, clip.id);
    this.pendingImageHydrations.get(ownerId)?.cancel();
    const handle = startTimelineImageHydration({
      url,
      resource: {
        demand: createBackgroundImageDemand(layerIndex, clip, ownerId, url),
        imageId: `${ownerId}:image`,
        label: 'Background image hydration',
        tags: ['background', 'image'],
      },
      isCurrent: () => this.layerStates.get(layerIndex)?.clips.includes(clip) === true,
      onReady: (img) => {
        this.pendingImageHydrations.delete(ownerId);
        clip.source = bindSourceRuntimeForOwner({
          ownerId,
          source: {
            type: 'image',
            imageElement: img,
            mediaFileId: clip.mediaFileId,
            naturalDuration: clip.duration,
          },
          mediaFileId: clip.mediaFileId,
          sessionPolicy: 'background',
          sessionOwnerId: ownerId,
        });
        this.reportClipResources(layerIndex, clip);
        clip.isLoading = false;
        log.debug(`Image loaded for background clip ${clip.name} on layer ${layerIndex}`);
      },
      onError: () => {
        this.pendingImageHydrations.delete(ownerId);
        clip.isLoading = false;
        log.warn(`Failed to load image for background clip ${clip.name}`);
      },
      onStale: () => {
        this.pendingImageHydrations.delete(ownerId);
        clip.isLoading = false;
      },
      onAdmissionDenied: (decision) => {
        this.pendingImageHydrations.delete(ownerId);
        clip.isLoading = false;
        log.debug('Background image hydration skipped by runtime admission', {
          clipId: clip.id,
          layerIndex,
          reason: decision.reason,
          rejectedUnits: decision.rejectedUnits.map((entry) => entry.unit),
        });
      },
    });
    if (!handle.admitted) {
      return;
    }
    this.pendingImageHydrations.set(ownerId, handle);
  }

  private loadVectorAnimationForClip(
    clip: TimelineClip,
    layerIndex: number,
    file: File,
    sourceType: VectorAnimationProvider
  ): void {
    void (async () => {
      try {
        if (clip.source?.type !== sourceType) {
          clip.source = {
            type: sourceType,
            mediaFileId: clip.mediaFileId,
            naturalDuration: clip.duration,
          };
        }
        const runtimeOwnerId = this.getRuntimeOwnerId(layerIndex, clip.id);
        const runtime = await vectorAnimationRuntimeManager.prepareClipSource(clip, file, {
          policyId: 'background',
          ownerId: runtimeOwnerId,
          ownerType: 'clip',
          label: `Background layer ${layerIndex} vector runtime canvas`,
          tags: ['background-layer', `layer-${layerIndex}`, 'vector-animation'],
        });
        const naturalDuration =
          runtime.metadata.duration ??
          clip.source?.naturalDuration ??
          clip.duration;
        clip.file = file;
        clip.source = {
          type: sourceType,
          textCanvas: runtime.canvas,
          mediaFileId: clip.mediaFileId,
          naturalDuration,
          vectorAnimationSettings: clip.source?.vectorAnimationSettings,
        };
        this.reportClipResources(layerIndex, clip);
        clip.isLoading = false;
        vectorAnimationRuntimeManager.renderClipAtTime(clip, clip.startTime);
      } catch (error) {
        clip.isLoading = false;
        log.warn(`Failed to load vector animation for background clip ${clip.name}`, error);
      }
    })();
  }

  private reportClipResources(layerIndex: number, clip: TimelineClip): void {
    reportClipRuntimeResources({
      policyId: 'background',
      ownerId: this.getRuntimeOwnerId(layerIndex, clip.id),
      ownerType: 'clip',
      clip,
      label: `Background layer ${layerIndex} clip resource`,
      tags: ['background-layer', `layer-${layerIndex}`],
    });
  }
}

// Singleton
export const layerPlaybackManager = new LayerPlaybackManager();
