// Layer building for export rendering

import { Logger } from '../../services/logger';
import type { Layer, NestedCompositionData } from '../../types/layers';
import type { TimelineTrack } from '../../stores/timeline/types';
import type { ExportClipState, FrameContext } from './types';
import { ParallelDecodeManager } from '../ParallelDecodeManager';
import {
  buildGaussianSplatSource,
  buildModelSource,
  buildMotionSource,
  getCompositionSize,
  getExportImageElement,
  getExportVideoElement,
} from './layerBuilder/sourceLookup';
import { getClipSourceWindowTime } from './layerBuilder/timing';
import { buildBaseLayerProps } from './layerBuilder/baseLayers';
import { buildNestedLayersForExport } from './layerBuilder/nestedLayers';
import { buildTextLikeLayer, isTextLikeClipSource } from './layerBuilder/textLayers';
import { buildVideoLayer } from './layerBuilder/videoLayers';

const log = Logger.create('ExportLayerBuilder');

// Cache video tracks and solo state at export start (don't change during export)
let cachedVideoTracks: TimelineTrack[] | null = null;
let cachedAnyVideoSolo = false;

export function initializeLayerBuilder(tracks: TimelineTrack[]): void {
  cachedVideoTracks = tracks.filter(t => t.type === 'video');
  cachedAnyVideoSolo = cachedVideoTracks.some(t => t.solo);
}

export function cleanupLayerBuilder(): void {
  cachedVideoTracks = null;
  cachedAnyVideoSolo = false;
}

/**
 * Build layers for rendering at a specific time.
 * Uses FrameContext for O(1) lookups - no getState() calls per frame.
 */
export function buildLayersAtTime(
  ctx: FrameContext,
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean
): Layer[] {
  const { time, clipsByTrack } = ctx;
  const layers: Layer[] = [];

  if (!cachedVideoTracks) {
    log.error('Not initialized - call initializeLayerBuilder first');
    return [];
  }

  const isTrackVisible = (track: TimelineTrack) => {
    if (!track.visible) return false;
    if (cachedAnyVideoSolo) return track.solo;
    return true;
  };

  // Build layers in track order (bottom to top)
  for (let trackIndex = 0; trackIndex < cachedVideoTracks.length; trackIndex++) {
    const track = cachedVideoTracks[trackIndex];
    if (!isTrackVisible(track)) continue;

    // O(1) lookup instead of O(n) find
    const clip = clipsByTrack.get(track.id);
    if (!clip) continue;

    const clipLocalTime = time - clip.startTime;
    const baseLayerProps = buildBaseLayerProps(
      clip,
      clipLocalTime,
      trackIndex,
      ctx,
    );

    // Handle nested compositions
    if (clip.isComposition && clip.nestedClips && clip.nestedClips.length > 0) {
      const nestedLayers = buildNestedLayersForExport(
        clip,
        clipLocalTime + (clip.inPoint || 0),
        time,
        clipStates,
        parallelDecoder,
        useParallelDecode
      );

      if (nestedLayers.length > 0) {
        const { width: compWidth, height: compHeight } = getCompositionSize(clip.compositionId);

        const nestedCompData: NestedCompositionData = {
          compositionId: clip.compositionId || clip.id,
          layers: nestedLayers,
          width: compWidth,
          height: compHeight,
          currentTime: clipLocalTime + (clip.inPoint || 0),
          sceneClips: clip.nestedClips,
          sceneTracks: clip.nestedTracks,
        };

        layers.push({
          ...baseLayerProps,
          source: {
            type: 'image', // Nested comps are pre-rendered to texture
            nestedComposition: nestedCompData,
          },
        });
      }
      continue;
    }

    // Handle video clips
    if (clip.source?.type === 'video' && getExportVideoElement(clip, clipStates)) {
      const layer = buildVideoLayer(clip, baseLayerProps, time, clipStates, parallelDecoder, useParallelDecode);
      if (layer) layers.push(layer);
    }
    // Handle image clips
    else if (clip.source?.type === 'image') {
      const imageElement = getExportImageElement(clip, clipStates);
      if (imageElement) {
        layers.push({
          ...baseLayerProps,
          source: { type: 'image', imageElement },
        });
      }
    }
    // Handle motion shape clips
    else if (clip.source?.type === 'motion-shape') {
      const source = buildMotionSource(clip, clipLocalTime);
      if (source) {
        layers.push({
          ...baseLayerProps,
          source,
        });
      }
    }
    // Handle 3D model clips
    else if (clip.source?.type === 'model') {
      const modelSourceTime = getClipSourceWindowTime(clip, clipLocalTime, ctx);
      layers.push({
        ...baseLayerProps,
        source: buildModelSource(clip, modelSourceTime),
        is3D: true,
      });
    }
    // Handle Gaussian Splat clips (native WebGPU)
    else if (clip.source?.type === 'gaussian-splat') {
      layers.push({
        ...baseLayerProps,
        source: buildGaussianSplatSource(clip, clipLocalTime),
        is3D: true,
      });
    }
    // Handle text, solid, vector animation, and Math Scene clips
    else if (isTextLikeClipSource(clip)) {
      const layer = buildTextLikeLayer(
        clip,
        clipLocalTime,
        time,
        baseLayerProps,
        { ctx, interpolateTextBounds: true },
      );
      if (layer) layers.push(layer);
    }
  }

  return layers;
}
