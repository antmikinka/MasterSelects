import { useMemo, type ComponentProps } from 'react';
import type { Keyframe, TimelineClip } from '../../../types';
import type { TimelineSpectrogramTileSet } from '../../../services/audio/timelineSpectrogramCache';
import type { TimelineWaveformPyramid } from '../utils/waveformLod';
import type { FadeCurve } from '../components/FadeCurve';
import { resolveAudioWaveformDiagnostics } from '../utils/audioWaveformDiagnostics';
import { resolveAudioVolumeAutomationCurveKeyframes } from '../utils/audioAutomationCurve';

type FadeCurveKeyframes = ComponentProps<typeof FadeCurve>['keyframes'];
type FadeCurveKeyframesWithIds = Array<FadeCurveKeyframes[number] & { id?: string }>;

export function useClipAudioDisplayDerivedState(input: {
  clip: TimelineClip;
  clipAudioKeyframes: readonly Keyframe[];
  isAudioClip: boolean;
  waveformsEnabled: boolean;
  processedWaveformPyramid: TimelineWaveformPyramid | null;
  waveformPyramid: TimelineWaveformPyramid | null;
  waveformVariant: 'processed' | 'source' | 'legacy';
  waveformDisplayGain: number;
  processedSpectrogramTileSet: TimelineSpectrogramTileSet | null;
  displayInPoint: number;
  displayOutPoint: number;
  displayDuration: number;
  opacityKeyframes: FadeCurveKeyframesWithIds;
}) {
  const waveformNaturalDuration = input.processedWaveformPyramid
    ? Math.max(0.001, input.processedWaveformPyramid.duration)
    : (input.clip.source?.naturalDuration || input.clip.duration);
  const waveformInPoint = input.processedWaveformPyramid ? 0 : input.displayInPoint;
  const waveformOutPoint = input.processedWaveformPyramid
    ? Math.max(0.001, input.processedWaveformPyramid.duration)
    : input.displayOutPoint;
  const spectrogramNaturalDuration = input.processedSpectrogramTileSet
    ? Math.max(0.001, input.processedSpectrogramTileSet.duration)
    : (input.clip.source?.naturalDuration || input.clip.duration);
  const spectrogramInPoint = input.processedSpectrogramTileSet ? 0 : input.displayInPoint;
  const spectrogramOutPoint = input.processedSpectrogramTileSet
    ? Math.max(0.001, input.processedSpectrogramTileSet.duration)
    : input.displayOutPoint;

  const audioWaveformDiagnostics = useMemo(() => {
    if (!input.isAudioClip || !input.waveformsEnabled) return null;
    if (!input.waveformPyramid && (!input.clip.waveform || input.clip.waveform.length === 0)) return null;

    return resolveAudioWaveformDiagnostics({
      waveform: input.clip.waveform,
      pyramid: input.waveformPyramid,
      inPoint: waveformInPoint,
      outPoint: waveformOutPoint,
      naturalDuration: waveformNaturalDuration,
      gain: input.waveformVariant === 'processed' ? 1 : input.waveformDisplayGain,
    });
  }, [
    input.clip.waveform,
    input.isAudioClip,
    input.waveformDisplayGain,
    input.waveformPyramid,
    input.waveformVariant,
    input.waveformsEnabled,
    waveformInPoint,
    waveformNaturalDuration,
    waveformOutPoint,
  ]);

  const audioVolumeAutomationKeyframes = useMemo(() => {
    if (!input.isAudioClip) return [];

    return resolveAudioVolumeAutomationCurveKeyframes({
      keyframes: input.clipAudioKeyframes,
      legacyEffects: input.clip.effects,
      audioEffectStack: input.clip.audioState?.effectStack,
      clipDuration: input.displayDuration,
    });
  }, [
    input.clip.audioState?.effectStack,
    input.clip.effects,
    input.clipAudioKeyframes,
    input.displayDuration,
    input.isAudioClip,
  ]);

  const visibleFadeCurveKeyframes: FadeCurveKeyframesWithIds = input.isAudioClip
    ? audioVolumeAutomationKeyframes
    : input.opacityKeyframes;
  const visibleFadeCurveKey = visibleFadeCurveKeyframes
    .map(k => `${k.id ?? ''}:${k.time.toFixed(3)}:${k.value}:${k.handleIn?.x ?? ''}:${k.handleIn?.y ?? ''}:${k.handleOut?.x ?? ''}:${k.handleOut?.y ?? ''}`)
    .join('|');

  return {
    spectrogramNaturalDuration,
    spectrogramInPoint,
    spectrogramOutPoint,
    audioWaveformDiagnostics,
    audioVolumeAutomationKeyframes,
    visibleFadeCurveKeyframes,
    visibleFadeCurveKey,
  };
}
