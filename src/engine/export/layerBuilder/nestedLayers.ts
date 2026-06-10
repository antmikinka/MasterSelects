import type { TimelineClip } from '../../../stores/timeline/types';
import type { Layer } from '../../../types/layers';
import type { ParallelDecodeManager } from '../../ParallelDecodeManager';
import type { ExportClipStateLike } from './contracts';
import { buildNestedBaseLayer } from './baseLayers';
import {
  buildGaussianSplatSource,
  buildModelSource,
  buildMotionSource,
  getCompositionSize,
  getExportImageElement,
  getExportVideoElement,
} from './sourceLookup';
import { buildTextLikeLayer, isTextLikeClipSource } from './textLayers';
import { buildNestedVideoLayer } from './videoLayers';

const MAX_EXPORT_NESTING_DEPTH = 4;

export function buildNestedLayersForExport(
  clip: TimelineClip,
  nestedTime: number,
  mainTimelineTime: number,
  clipStates: Map<string, ExportClipStateLike>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean,
  depth: number = 0,
): Layer[] {
  if (!clip.nestedClips || !clip.nestedTracks || depth >= MAX_EXPORT_NESTING_DEPTH) return [];

  const nestedVideoTracks = clip.nestedTracks.filter(t => t.type === 'video');
  const nestedAnyVideoSolo = nestedVideoTracks.some(t => t.solo);
  const layers: Layer[] = [];

  for (let i = 0; i < nestedVideoTracks.length; i++) {
    const nestedTrack = nestedVideoTracks[i];
    if (nestedTrack.visible === false) continue;
    if (nestedAnyVideoSolo && !nestedTrack.solo) continue;

    const nestedClip = clip.nestedClips.find(
      nc =>
        nc.trackId === nestedTrack.id &&
        nestedTime >= nc.startTime &&
        nestedTime < nc.startTime + nc.duration
    );

    if (!nestedClip) continue;

    const nestedClipLocalTime = nestedTime - nestedClip.startTime;
    const nestedLayer = buildNestedLayerForExport(
      nestedClip,
      nestedClipLocalTime,
      mainTimelineTime,
      clipStates,
      parallelDecoder,
      useParallelDecode,
      depth,
    );
    if (nestedLayer) {
      layers.push(nestedLayer);
    }
  }

  return layers;
}

function buildNestedLayerForExport(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  mainTimelineTime: number,
  clipStates: Map<string, ExportClipStateLike>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean,
  depth: number,
): Layer | null {
  const baseLayer = buildNestedBaseLayer(nestedClip, nestedClipLocalTime);

  if (nestedClip.isComposition && nestedClip.nestedClips && nestedClip.nestedTracks) {
    const subCompTime = nestedClipLocalTime + (nestedClip.inPoint || 0);
    const subLayers = buildNestedLayersForExport(
      nestedClip,
      subCompTime,
      mainTimelineTime,
      clipStates,
      parallelDecoder,
      useParallelDecode,
      depth + 1,
    );

    if (subLayers.length === 0) {
      return null;
    }

    const { width, height } = getCompositionSize(nestedClip.compositionId);

    return {
      ...baseLayer,
      source: {
        type: 'image',
        nestedComposition: {
          compositionId: nestedClip.compositionId || nestedClip.id,
          layers: subLayers,
          width,
          height,
          currentTime: subCompTime,
          sceneClips: nestedClip.nestedClips,
          sceneTracks: nestedClip.nestedTracks,
        },
      },
    };
  }

  const exportVideo = getExportVideoElement(nestedClip, clipStates);
  if (exportVideo) {
    return buildNestedVideoLayer(
      nestedClip,
      baseLayer,
      exportVideo,
      mainTimelineTime,
      clipStates,
      parallelDecoder,
      useParallelDecode,
    );
  }

  if (nestedClip.source?.type === 'image') {
    const imageElement = getExportImageElement(nestedClip, clipStates);
    return imageElement
      ? {
          ...baseLayer,
          source: { type: 'image', imageElement },
        }
      : null;
  }

  if (nestedClip.source?.type === 'motion-shape') {
    const source = buildMotionSource(nestedClip, nestedClipLocalTime);
    return source
      ? {
          ...baseLayer,
          source,
        }
      : null;
  }

  if (
    nestedClip.source?.type === 'motion-null' ||
    nestedClip.source?.type === 'motion-adjustment'
  ) {
    return null;
  }

  if (nestedClip.source?.type === 'model') {
    const nestedSourceTime = nestedClip.reversed
      ? nestedClip.outPoint - nestedClipLocalTime
      : nestedClipLocalTime + nestedClip.inPoint;
    return {
      ...baseLayer,
      source: buildModelSource(nestedClip, nestedSourceTime),
      is3D: true,
    };
  }

  if (nestedClip.source?.type === 'gaussian-splat') {
    return {
      ...baseLayer,
      source: buildGaussianSplatSource(nestedClip, nestedClipLocalTime),
      is3D: true,
    };
  }

  if (isTextLikeClipSource(nestedClip)) {
    return buildTextLikeLayer(
      nestedClip,
      nestedClipLocalTime,
      nestedClip.startTime + nestedClipLocalTime,
      baseLayer,
      { interpolateTextBounds: false },
    );
  }

  return null;
}
