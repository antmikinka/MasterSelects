import { useMemo } from 'react';
import type { Keyframe, TimelineClip } from '../../../types';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import {
  clipRequiresProcessedWaveformPyramid,
} from '../../../services/audio/processedWaveformEligibility';
import { canDeriveProcessedWaveformPyramid } from '../../../services/audio/DerivedWaveformPyramidService';
import { resolveProcessedAudioAnalysisDisplayStatus } from '../utils/audioAnalysisDisplayStatus';
import type { TimelineWaveformPyramidLoadStatus } from './useTimelineWaveformPyramid';
import type { TimelineSpectrogramTileSetLoadStatus } from './useTimelineSpectrogramTileSet';

export function useClipAudioAnalysisDisplayState(input: {
  clip: TimelineClip;
  clipAudioKeyframes: readonly Keyframe[];
  audioDisplayMode: TimelineAudioDisplayMode;
  processedWaveformPyramidRef?: string;
  processedWaveformReady: boolean;
  processedWaveformLoadStatus: TimelineWaveformPyramidLoadStatus;
  sourceWaveformReady: boolean;
  hasLegacyWaveformData: boolean;
  usePredictiveAudioWaveform: boolean;
  processedSpectrogramTileSetRef?: string;
  processedSpectrogramReady: boolean;
  processedSpectrogramLoadStatus: TimelineSpectrogramTileSetLoadStatus;
  sourceSpectrogramReady: boolean;
}) {
  const needsProcessedAudioAnalysis = useMemo(
    () => clipRequiresProcessedWaveformPyramid(input.clip, input.clipAudioKeyframes),
    [input.clip, input.clipAudioKeyframes],
  );
  const canDeriveVisibleProcessedWaveform = useMemo(
    () => canDeriveProcessedWaveformPyramid(input.clip, input.clipAudioKeyframes),
    [input.clip, input.clipAudioKeyframes],
  );
  const hasWaveformDisplayFallback = Boolean(
    input.sourceWaveformReady ||
    input.hasLegacyWaveformData,
  );
  const shouldSuppressBackgroundProcessedWaveformUi = input.audioDisplayMode !== 'spectral' &&
    needsProcessedAudioAnalysis &&
    hasWaveformDisplayFallback &&
    (canDeriveVisibleProcessedWaveform || input.usePredictiveAudioWaveform);

  const rawWaveformProcessingState = input.processedWaveformPyramidRef && !input.processedWaveformReady
    ? `waveform-processed-${input.processedWaveformLoadStatus}`
    : '';
  const spectrogramProcessingState = input.audioDisplayMode === 'spectral'
    && input.processedSpectrogramTileSetRef
    && !input.processedSpectrogramReady
    ? `spectrogram-processed-${input.processedSpectrogramLoadStatus}`
    : '';
  const waveformProcessingState = shouldSuppressBackgroundProcessedWaveformUi
    ? ''
    : rawWaveformProcessingState;
  const canResolveAudioSourceForAnalysis = Boolean(
    input.clip.isComposition ||
    input.clip.file ||
    input.clip.mediaFileId ||
    input.clip.source?.mediaFileId,
  );
  const processedWaveformStatus = shouldSuppressBackgroundProcessedWaveformUi
    ? null
    : resolveProcessedAudioAnalysisDisplayStatus({
        artifactLabel: 'waveform',
        needsProcessed: needsProcessedAudioAnalysis,
        processedRef: input.processedWaveformPyramidRef,
        processedReady: input.processedWaveformReady,
        fallbackAvailable: hasWaveformDisplayFallback,
        loadStatus: input.processedWaveformLoadStatus,
        jobActive: input.clip.audioAnalysisJob?.artifactKinds.includes('processed-waveform-pyramid') === true,
        autoGenerateEligible: canResolveAudioSourceForAnalysis,
      });
  const processedSpectrogramStatus = resolveProcessedAudioAnalysisDisplayStatus({
    artifactLabel: 'spectrogram',
    needsProcessed: needsProcessedAudioAnalysis,
    processedRef: input.processedSpectrogramTileSetRef,
    processedReady: input.processedSpectrogramReady,
    fallbackAvailable: input.sourceSpectrogramReady,
    loadStatus: input.processedSpectrogramLoadStatus,
    jobActive: input.clip.audioAnalysisJob?.artifactKinds.includes('spectrogram-tiles') === true,
    autoGenerateEligible: canResolveAudioSourceForAnalysis,
  });
  const audioAnalysisDisplayStatus = input.audioDisplayMode === 'spectral'
    ? processedSpectrogramStatus
    : processedWaveformStatus;
  const isBackgroundProcessedWaveformJob = input.clip.audioAnalysisJob?.processed === true &&
    input.clip.audioAnalysisJob.artifactKinds.includes('processed-waveform-pyramid');
  const showWaveformGenerationIndicator = Boolean(input.clip.waveformGenerating) &&
    !(isBackgroundProcessedWaveformJob && shouldSuppressBackgroundProcessedWaveformUi);

  return {
    waveformProcessingState,
    spectrogramProcessingState,
    processedWaveformStatus,
    processedSpectrogramStatus,
    audioAnalysisDisplayStatus,
    showWaveformGenerationIndicator,
  };
}
