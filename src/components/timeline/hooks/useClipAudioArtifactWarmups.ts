import { useEffect, useMemo } from 'react';
import type { Keyframe, TimelineClip } from '../../../types';
import {
  createProcessedClipAudioStateHash,
} from '../../../services/audio/processedWaveformEligibility';
import {
  createTimelineSourceWaveformGenerationRequest,
  scheduleVisibleTimelineSourceWaveformGeneration,
} from '../../../services/timeline/timelineSourceWaveformWarmup';
import {
  scheduleTimelineProcessedWaveformDerivation,
  scheduleTimelineSpectrogramTileGeneration,
} from '../../../services/timeline/timelineAudioArtifactGenerationWarmup';
import type { TimelineSourceWaveformClipRef } from '../../../services/timeline/timelineSourceWaveformWarmup';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';

const WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM = 250;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH = 16_384;

export function useClipAudioArtifactWarmups(input: {
  clip: TimelineClip;
  clipAudioKeyframes: readonly Keyframe[];
  audioDisplayMode: TimelineAudioDisplayMode;
  passiveMediaEnabled: boolean;
  waveformsEnabled: boolean;
  isAudioClip: boolean;
  isClipDragActive: boolean;
  processedWaveformPyramidRef?: string;
  sourceSpectrogramTileSetRef?: string;
  processedSpectrogramTileSetRef?: string;
  width: number;
  zoom: number;
}) {
  const {
    clip,
    clipAudioKeyframes,
    audioDisplayMode,
    passiveMediaEnabled,
    waveformsEnabled,
    isAudioClip,
    isClipDragActive,
    processedWaveformPyramidRef,
    sourceSpectrogramTileSetRef,
    processedSpectrogramTileSetRef,
    width,
    zoom,
  } = input;

  useEffect(() => {
    if (!passiveMediaEnabled || !waveformsEnabled || !isAudioClip || clip.waveformGenerating || isClipDragActive) {
      return;
    }

    const shouldUpgrade =
      audioDisplayMode === 'detailed' ||
      (audioDisplayMode === 'compact' && (zoom >= WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM || width > WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH));

    if (!shouldUpgrade) return;

    const sourceWaveformClip: TimelineSourceWaveformClipRef = {
      id: clip.id,
      name: clip.name,
      mediaFileId: clip.mediaFileId,
      file: clip.file
        ? {
            name: clip.file.name,
            size: clip.file.size,
            lastModified: clip.file.lastModified,
          }
        : undefined,
      waveform: clip.waveform,
      waveformChannels: clip.waveformChannels,
      waveformGenerating: clip.waveformGenerating,
      audioState: clip.audioState,
      source: {
        type: clip.source?.type,
        mediaFileId: clip.source?.mediaFileId,
      },
    };
    const request = createTimelineSourceWaveformGenerationRequest(sourceWaveformClip, audioDisplayMode);
    if (!request) return;

    return scheduleVisibleTimelineSourceWaveformGeneration([request]);
  }, [
    audioDisplayMode,
    clip.audioState,
    clip.file,
    clip.mediaFileId,
    clip.name,
    clip.source?.mediaFileId,
    clip.source?.type,
    clip.id,
    clip.waveform,
    clip.waveformChannels,
    clip.waveformGenerating,
    isClipDragActive,
    isAudioClip,
    passiveMediaEnabled,
    waveformsEnabled,
    width,
    zoom,
  ]);

  const processedWaveformRequestKey = useMemo(
    () => passiveMediaEnabled
      ? `${clip.id}:${createProcessedClipAudioStateHash(clip, { keyframes: clipAudioKeyframes })}`
      : `${clip.id}:passive-media-suppressed`,
    [clip, clipAudioKeyframes, passiveMediaEnabled],
  );

  useEffect(() => {
    if (
      !waveformsEnabled ||
      !passiveMediaEnabled ||
      !isAudioClip ||
      audioDisplayMode === 'spectral' ||
      processedWaveformPyramidRef ||
      clip.waveformGenerating ||
      isClipDragActive
    ) {
      return;
    }

    return scheduleTimelineProcessedWaveformDerivation({
      clipId: clip.id,
      requestKey: processedWaveformRequestKey,
    });
  }, [
    clip.id,
    clip.waveformGenerating,
    audioDisplayMode,
    isClipDragActive,
    isAudioClip,
    passiveMediaEnabled,
    processedWaveformPyramidRef,
    processedWaveformRequestKey,
    waveformsEnabled,
  ]);

  const spectrogramRequestKey = [
    'spectrogram',
    processedWaveformRequestKey,
    sourceSpectrogramTileSetRef ?? '',
    processedSpectrogramTileSetRef ?? '',
  ].join(':');

  useEffect(() => {
    if (
      !waveformsEnabled ||
      !passiveMediaEnabled ||
      !isAudioClip ||
      audioDisplayMode !== 'spectral' ||
      clip.waveformGenerating ||
      isClipDragActive
    ) {
      return;
    }

    return scheduleTimelineSpectrogramTileGeneration({
      clipId: clip.id,
      requestKey: spectrogramRequestKey,
    });
  }, [
    audioDisplayMode,
    clip.id,
    clip.waveformGenerating,
    isClipDragActive,
    isAudioClip,
    passiveMediaEnabled,
    processedSpectrogramTileSetRef,
    sourceSpectrogramTileSetRef,
    spectrogramRequestKey,
    waveformsEnabled,
  ]);
}
