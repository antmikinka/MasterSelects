import { useCallback, useMemo } from 'react';
import type { ClipAudioEditOperation } from '../../../types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type {
  TimelineAudioRegionSelection,
  TimelineSpectralRegionSelection,
  TimelineVideoBakeRegionSelection,
} from '../../../stores/timeline/types';
import type { TimelineClipProps } from '../types';
import {
  resolveAudioEditOperationOverlays,
  resolveClipVideoBakeRegionOverlays,
  type AudioEditOperationOverlay,
  type ClipVideoBakeRegionOverlay,
} from '../utils/activeRegionOverlays';
import {
  resolveSpectralImageLayerOverlays,
  resolveSpectralRegionOverlay,
} from '../utils/spectralRegionOverlays';

export function useClipRegionOverlayState(input: {
  clip: TimelineClipProps['clip'];
  isAudioClip: boolean;
  audioFocusMode: boolean;
  showAudioRegionEditMarkers: boolean;
  audioDisplayMode: string;
  canSelectSpectralRegion: boolean;
  audioRegionSelection: TimelineAudioRegionSelection | null;
  audioSpectralRegionSelection: TimelineSpectralRegionSelection | null;
  videoBakeRegionSelection: TimelineVideoBakeRegionSelection | null;
  displayAudioEditStack: readonly ClipAudioEditOperation[];
  displayStartTime: number;
  displayDuration: number;
  displayInPoint: number;
  displayOutPoint: number;
  width: number;
  trackBaseHeight: number;
  spectralMaxFrequencyHz: number;
  spectralImageFilesById: ReadonlyMap<string, MediaFile>;
  sourceTimeToVideoBakeTimelineTime: (sourceTime: number) => number;
}) {
  const spectralRegionOverlay = useMemo(() => resolveSpectralRegionOverlay({
    selection: input.audioSpectralRegionSelection,
    displayStartTime: input.displayStartTime,
    displayDuration: input.displayDuration,
    width: input.width,
    trackBaseHeight: input.trackBaseHeight,
    maxFrequencyHz: input.spectralMaxFrequencyHz,
  }), [
    input.audioSpectralRegionSelection,
    input.displayDuration,
    input.displayStartTime,
    input.spectralMaxFrequencyHz,
    input.trackBaseHeight,
    input.width,
  ]);

  const sourceTimeToDisplayTimelineTime = useCallback((sourceTime: number): number => {
    const sourceStart = Math.max(0, input.displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + 0.001, input.displayOutPoint ?? sourceStart + input.displayDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = input.clip.reversed ? 1 - sourceRatio : sourceRatio;
    return input.displayStartTime + timelineRatio * input.displayDuration;
  }, [
    input.clip.reversed,
    input.displayDuration,
    input.displayInPoint,
    input.displayOutPoint,
    input.displayStartTime,
  ]);

  const spectralImageLayerOverlays = useMemo(() => {
    const spectralLayers = input.clip.audioState?.spectralLayers ?? [];

    return resolveSpectralImageLayerOverlays({
      enabled: input.canSelectSpectralRegion || input.audioDisplayMode === 'spectral',
      layers: spectralLayers,
      displayStartTime: input.displayStartTime,
      displayDuration: input.displayDuration,
      width: input.width,
      trackBaseHeight: input.trackBaseHeight,
      maxFrequencyHz: input.spectralMaxFrequencyHz,
      sourceTimeToDisplayTimelineTime,
      mediaFilesById: input.spectralImageFilesById,
    });
  }, [
    input.audioDisplayMode,
    input.canSelectSpectralRegion,
    input.clip.audioState?.spectralLayers,
    input.displayDuration,
    input.displayStartTime,
    input.spectralImageFilesById,
    input.spectralMaxFrequencyHz,
    input.trackBaseHeight,
    input.width,
    sourceTimeToDisplayTimelineTime,
  ]);

  const audioEditOperationOverlays = useMemo<AudioEditOperationOverlay[]>(() => {
    if (!input.isAudioClip || !input.audioFocusMode || !input.showAudioRegionEditMarkers || input.displayAudioEditStack.length === 0) {
      return [];
    }

    return resolveAudioEditOperationOverlays({
      operations: input.displayAudioEditStack,
      audioRegionSelection: input.audioRegionSelection,
      clipId: input.clip.id,
      trackId: input.clip.trackId,
      displayStartTime: input.displayStartTime,
      displayDuration: input.displayDuration,
      width: input.width,
      trackBaseHeight: input.trackBaseHeight,
      sourceTimeToDisplayTimelineTime,
    });
  }, [
    input.audioFocusMode,
    input.audioRegionSelection,
    input.clip.id,
    input.clip.trackId,
    input.displayAudioEditStack,
    input.displayDuration,
    input.displayStartTime,
    input.isAudioClip,
    input.showAudioRegionEditMarkers,
    input.trackBaseHeight,
    input.width,
    sourceTimeToDisplayTimelineTime,
  ]);

  const clipVideoBakeRegionOverlays = useMemo<ClipVideoBakeRegionOverlay[]>(() => (
    resolveClipVideoBakeRegionOverlays({
      isAudioClip: input.isAudioClip,
      bakeRegions: input.clip.videoState?.bakeRegions,
      selection: input.videoBakeRegionSelection,
      displayStartTime: input.displayStartTime,
      displayDuration: input.displayDuration,
      width: input.width,
      sourceTimeToVideoBakeTimelineTime: input.sourceTimeToVideoBakeTimelineTime,
    })
  ), [
    input.clip.videoState?.bakeRegions,
    input.displayDuration,
    input.displayStartTime,
    input.isAudioClip,
    input.sourceTimeToVideoBakeTimelineTime,
    input.videoBakeRegionSelection,
    input.width,
  ]);

  return {
    spectralRegionOverlay,
    spectralImageLayerOverlays,
    audioEditOperationOverlays,
    clipVideoBakeRegionOverlays,
  };
}
