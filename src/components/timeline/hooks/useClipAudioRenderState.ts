import { useCallback, useMemo } from 'react';
import type {
  ClipAudioEditOperation,
  ClipAudioRegionGainPreview,
  TimelineClip,
} from '../../../types';
import type {
  TimelineAudioDisplayMode,
  TimelineAudioRegionSelection,
} from '../../../stores/timeline/types';
import type { TimelineWaveformPyramid } from '../utils/waveformLod';
import type { TimelineSpectrogramTileSet } from '../../../services/audio/timelineSpectrogramCache';
import {
  resolveStableWaveformRenderGeometry,
  type TimelineHorizontalRenderWindow,
} from '../utils/waveformRenderGeometry';
import { useClipAudioMediaViewProps } from './useClipAudioMediaViewProps';
import type {
  AudioRegionMoveDragState,
  AudioRegionResizeDragState,
} from './useClipRegionInteractions';
import type { AudioAutomationCurveKeyframe } from '../utils/audioAutomationCurve';
import { TIMELINE_RENDER_OVERSCAN_PX } from '../timelineRenderConstants';

const EMPTY_AUDIO_EDIT_STACK = [] as const;
const EMPTY_WAVEFORM: number[] = [];

export function useClipAudioRenderState(input: {
  clip: TimelineClip;
  clipTrim: {
    originalInPoint: number;
    originalOutPoint: number;
  } | null | undefined;
  audioEditStack: readonly ClipAudioEditOperation[];
  audioRegionSelection: TimelineAudioRegionSelection | null;
  audioRegionGainPreview: ClipAudioRegionGainPreview | null;
  audioRegionMoveDrag: AudioRegionMoveDragState | null;
  audioRegionResizeDrag: AudioRegionResizeDragState | null;
  sourceWaveformPyramid: TimelineWaveformPyramid | null;
  processedWaveformPyramid: TimelineWaveformPyramid | null;
  waveformPyramid: TimelineWaveformPyramid | null;
  waveformVariant: 'processed' | 'source' | 'legacy';
  waveformDisplayGain: number;
  spectrogramTileSet: TimelineSpectrogramTileSet | null;
  spectrogramInPoint: number;
  spectrogramOutPoint: number;
  spectrogramNaturalDuration: number;
  spectrogramVariant: 'processed' | 'source';
  waveformRenderWindow: TimelineHorizontalRenderWindow;
  audioVolumeAutomationKeyframes: readonly AudioAutomationCurveKeyframe[];
  isAudioClip: boolean;
  isTrimming: boolean;
  isLinkedToTrimming: boolean;
  displayInPoint: number;
  displayOutPoint: number;
  displayDuration: number;
  width: number;
  left: number;
  scrollX: number;
  renderTimelineViewportWidth: number;
  trackBaseHeight: number;
  zoom: number;
  audioDisplayMode: TimelineAudioDisplayMode;
}) {
  const activeAudioRegionOperationDrag = input.audioRegionMoveDrag ?? input.audioRegionResizeDrag;

  const getMatchingAudioRegionOperationIds = useCallback((selection: TimelineAudioRegionSelection): string[] => {
    const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
    const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);
    return input.audioEditStack
      .filter(operation => {
        if (!operation.timeRange) return false;
        const operationStart = Math.min(operation.timeRange.start, operation.timeRange.end);
        const operationEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
        return Math.abs(operationStart - start) <= 0.001 &&
          Math.abs(operationEnd - end) <= 0.001;
      })
      .map(operation => operation.id);
  }, [input.audioEditStack]);

  const displayAudioEditStack = useMemo(() => {
    if (!input.audioRegionSelection || !activeAudioRegionOperationDrag?.operationIds.length) {
      return input.audioEditStack;
    }

    const operationIds = new Set(activeAudioRegionOperationDrag.operationIds);
    const start = Math.min(input.audioRegionSelection.sourceInPoint, input.audioRegionSelection.sourceOutPoint);
    const end = Math.max(input.audioRegionSelection.sourceInPoint, input.audioRegionSelection.sourceOutPoint);
    const timelineStart = Math.min(input.audioRegionSelection.startTime, input.audioRegionSelection.endTime);
    const timelineEnd = Math.max(input.audioRegionSelection.startTime, input.audioRegionSelection.endTime);

    return input.audioEditStack.map(operation => {
      if (!operationIds.has(operation.id) || !operation.timeRange) return operation;
      return {
        ...operation,
        params: {
          ...operation.params,
          timelineStart,
          timelineEnd,
        },
        timeRange: { start, end },
      };
    });
  }, [activeAudioRegionOperationDrag, input.audioEditStack, input.audioRegionSelection]);

  const preferSourceWaveformForAudioRegionDrag = Boolean(activeAudioRegionOperationDrag?.operationIds.length && input.sourceWaveformPyramid);
  const waveformPyramidForRender = preferSourceWaveformForAudioRegionDrag
    ? input.sourceWaveformPyramid
    : input.waveformPyramid;
  const waveformVariantForRender: 'processed' | 'source' | 'legacy' = preferSourceWaveformForAudioRegionDrag
    ? 'source'
    : input.waveformVariant;
  const waveformUsesProcessedPyramidForRender = Boolean(
    waveformPyramidForRender &&
    input.processedWaveformPyramid &&
    waveformPyramidForRender === input.processedWaveformPyramid,
  );
  const processedWaveformPyramidForRender = waveformUsesProcessedPyramidForRender
    ? input.processedWaveformPyramid
    : null;
  const waveformNaturalDurationForRender = processedWaveformPyramidForRender
    ? Math.max(0.001, processedWaveformPyramidForRender.duration)
    : (input.clip.source?.naturalDuration || input.clip.duration);
  const waveformInPointForRender = processedWaveformPyramidForRender ? 0 : input.displayInPoint;
  const waveformOutPointForRender = processedWaveformPyramidForRender
    ? Math.max(0.001, processedWaveformPyramidForRender.duration)
    : input.displayOutPoint;
  const waveformLegacyForRender = input.clip.waveform ?? EMPTY_WAVEFORM;
  const waveformChannelsForRender = input.clip.waveformChannels;
  const hasWaveformForRender = Boolean(
    waveformPyramidForRender ||
    waveformLegacyForRender.length > 0 ||
    waveformChannelsForRender?.some(channel => channel.length > 0)
  );
  const canApplyPredictiveAudioWaveform = waveformVariantForRender !== 'processed';
  const predictiveAudioEditStack = canApplyPredictiveAudioWaveform
    ? displayAudioEditStack
    : EMPTY_AUDIO_EDIT_STACK;
  const predictiveAudioRegionGainPreview = canApplyPredictiveAudioWaveform
    ? input.audioRegionGainPreview
    : null;
  const originalWaveformTrimInPoint = input.isTrimming && input.clipTrim
    ? input.clipTrim.originalInPoint
    : input.clip.inPoint;
  const originalWaveformTrimOutPoint = input.isTrimming && input.clipTrim
    ? input.clipTrim.originalOutPoint
    : input.clip.outPoint;
  const stableWaveformGeometry = resolveStableWaveformRenderGeometry({
    isAudioClip: input.isAudioClip,
    isTrimming: input.isTrimming,
    isLinkedToTrimming: input.isLinkedToTrimming,
    hasClipTrim: Boolean(input.clipTrim),
    usesProcessedPyramid: Boolean(processedWaveformPyramidForRender),
    clipWidth: input.width,
    clipLeft: input.left,
    scrollX: input.scrollX,
    viewportWidth: input.renderTimelineViewportWidth,
    overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
    baseRenderWindow: input.waveformRenderWindow,
    waveformInPoint: waveformInPointForRender,
    waveformOutPoint: waveformOutPointForRender,
    originalInPoint: originalWaveformTrimInPoint,
    originalOutPoint: originalWaveformTrimOutPoint,
    displayDuration: input.displayDuration,
  });

  const {
    audioSpectrogramProps,
    audioWaveformProps,
  } = useClipAudioMediaViewProps({
    clipId: input.clip.id,
    trackBaseHeight: input.trackBaseHeight,
    width: input.width,
    zoom: input.zoom,
    audioDisplayMode: input.audioDisplayMode,
    spectrogramTileSet: input.spectrogramTileSet,
    spectrogramInPoint: input.spectrogramInPoint,
    spectrogramOutPoint: input.spectrogramOutPoint,
    spectrogramNaturalDuration: input.spectrogramNaturalDuration,
    spectrogramVariant: input.spectrogramVariant,
    waveformRenderWindow: input.waveformRenderWindow,
    waveformLegacyForRender,
    waveformChannelsForRender,
    waveformNaturalDurationForRender,
    waveformPyramidForRender,
    waveformVariantForRender,
    waveformDisplayGainForRender: input.waveformDisplayGain,
    stableWaveformContentWidth: stableWaveformGeometry.contentWidth,
    stableWaveformContentInPoint: stableWaveformGeometry.contentInPoint,
    stableWaveformContentOutPoint: stableWaveformGeometry.contentOutPoint,
    stableWaveformClipDuration: stableWaveformGeometry.clipDuration,
    stableWaveformRenderWindow: stableWaveformGeometry.renderWindow,
    stableWaveformContentOffsetPx: stableWaveformGeometry.contentOffsetPx,
    audioVolumeAutomationKeyframes: input.audioVolumeAutomationKeyframes,
    predictiveAudioEditStack,
    predictiveAudioRegionGainPreview,
    useStableWaveformTrimWindow: stableWaveformGeometry.useStableTrimWindow,
    originalWaveformTrimInPoint,
    originalWaveformTrimOutPoint,
    waveformSourceSecondsPerPixel: stableWaveformGeometry.sourceSecondsPerPixel,
  });

  return {
    displayAudioEditStack,
    getMatchingAudioRegionOperationIds,
    hasWaveformForRender,
    audioSpectrogramProps,
    audioWaveformProps,
  };
}
