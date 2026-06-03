// TimelineClip component - Clip rendering within tracks

import './TimelineClip.css';
import { memo, type CSSProperties, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { IconFileMusic } from '@tabler/icons-react';
import type { TimelineClipProps } from './types';
import { THUMB_WIDTH } from './constants';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from './trackColor';
// PickWhip disabled
import {
  isVectorAnimationSourceType,
  shouldLoopVectorAnimation,
} from '../../types/vectorAnimation';
import { ClipSpectrogram } from './components/ClipSpectrogram';
import { ClipWaveform } from './components/ClipWaveform';
import { ClipAnalysisOverlay } from './components/ClipAnalysisOverlay';
import { FadeCurve } from './components/FadeCurve';
import {
  StaticClipIcon,
  TrimHandleArrows,
  type StaticClipIconKind,
} from './components/ClipPresentationPrimitives';
import {
  ACTIVE_STEM_JOB_PHASES,
  EMPTY_STEM_CHOICES,
  formatStemJobPhase,
  StemChoiceIcon,
} from './components/ClipStemDisplay';
import { useThumbnailCache } from '../../hooks/useThumbnailCache';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { Logger } from '../../services/logger';
import { useTimelineSpectrogramTileSetState } from './hooks/useTimelineSpectrogramTileSet';
import { useTimelineWaveformPyramidState } from './hooks/useTimelineWaveformPyramid';
import {
  clipRequiresProcessedWaveformPyramid,
  createProcessedClipAudioStateHash,
} from '../../services/audio/processedWaveformEligibility';
import { canDeriveProcessedWaveformPyramid } from '../../services/audio/DerivedWaveformPyramidService';
import {
  collectAudioEffectInstanceRouteSettings,
  collectLegacyAudioEffectRouteSettings,
} from '../../services/audio/audioGraphRouteSettings';
import {
  moveTimelineAudioRegionSelection,
  resizeTimelineAudioRegionSelection,
  resolveTimelineAudioRegionSelection,
} from './utils/audioEditSelection';
import {
  AUDIO_REGION_TIMELINE_EPSILON,
  audioRegionGainDbFromClientY,
  formatAudioRegionGainLabel,
  isAudioRegionModifierPressed,
  isVideoBakeRegionModifierPressed,
  resolveAudioRegionTimelineRangeForClip,
} from './utils/audioRegionDisplay';
import {
  createAudioRegionContextMenuModel,
  findAudioRegionContextMenuCommand,
  type AudioRegionContextMenuCommand,
} from './utils/audioRegionContextMenu';
import {
  resolveAudioEditOperationOverlays,
  resolveAudioRegionGainControl,
  resolveAudioRegionOverlay,
  resolveClipVideoBakeRegionOverlays,
  type AudioEditOperationOverlay,
  type ClipVideoBakeRegionOverlay,
} from './utils/activeRegionOverlays';
import { resolveProcessedAudioAnalysisDisplayStatus } from './utils/audioAnalysisDisplayStatus';
import { resolveAudioWaveformDiagnostics } from './utils/audioWaveformDiagnostics';
import { resolveAudioVolumeAutomationCurveKeyframes } from './utils/audioAutomationCurve';
import {
  resolveAnalysisCoveragePercent,
  resolveTranscriptCoveragePercent,
} from './utils/clipCoverageBadges';
import { resolveClipLabelHex } from './utils/resolveClipLabelHex';
import {
  resolveHorizontalRenderWindow,
  resolveStableWaveformRenderGeometry,
  resolveTimelineViewportWidth,
  resolveVisibleSourceWindow,
} from './utils/waveformRenderGeometry';
import { resolveSourceExtensionGhosts } from './utils/sourceExtensionGhosts';
import {
  frequencyHzFromSpectralY,
  getSpectralMaxFrequencyHz,
  resolveTimelineSpectralBrushSelection,
  resolveTimelineSpectralRegionSelection,
} from './utils/spectralSelection';
import {
  resolveSpectralImageLayerOverlays,
  resolveSpectralRegionOverlay,
} from './utils/spectralRegionOverlays';
import type {
  TimelineAudioRegionSelection,
  TimelineSpectralRegionEditType,
  TimelineVideoBakeRegionSelection,
} from '../../stores/timeline/types';
import {
  dispatchTimelineClipPointerClick,
  dispatchTimelineClipPointerMove,
  getTimelineToolCursor,
  isTimelineBladeTool,
  isTimelinePointerTool,
} from './tools/pointer/timelineToolPointerDispatcher';
import { getTrimHandleArrowDirections } from './utils/trimHandleDirections';
import {
  hasLegacyWaveformSamples,
} from '../../utils/audioWaveformPresence';
import {
  createTimelineSourceWaveformGenerationRequest,
  scheduleVisibleTimelineSourceWaveformGeneration,
} from '../../services/timeline/timelineSourceWaveformWarmup';
import {
  scheduleTimelineProcessedWaveformDerivation,
  scheduleTimelineSpectrogramTileGeneration,
} from '../../services/timeline/timelineAudioArtifactGenerationWarmup';

const KEYFRAME_TICK_SNAP_THRESHOLD_PX = 10;
const TIMELINE_VIEWPORT_FALLBACK_PX = 1600;
const TIMELINE_VIEWPORT_MIN_PX = 1600;
const TIMELINE_RENDER_OVERSCAN_PX = 512;
const THUMBNAIL_RENDER_OVERSCAN_PX = THUMB_WIDTH * 3;
const CLIP_RIGHT_STICKY_PADDING_PX = 8;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM = 250;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH = 16_384;
const VIDEO_BAKE_REGION_TIMELINE_EPSILON = 0.001;
const log = Logger.create('TimelineClip');

const EMPTY_CLIP_KEYFRAMES = [] as const;
const EMPTY_AUDIO_EDIT_STACK = [] as const;

function canLoopExtendVectorClip(clip: TimelineClipProps['clip']): boolean {
  return isVectorAnimationSourceType(clip.source?.type) &&
    shouldLoopVectorAnimation(clip.source.vectorAnimationSettings);
}

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getClipSourceDuration(clip: TimelineClipProps['clip']): number {
  const naturalDuration = clip.source?.naturalDuration;
  if (Number.isFinite(naturalDuration) && naturalDuration && naturalDuration > 0) {
    return naturalDuration;
  }
  return Math.max(clip.outPoint, clip.inPoint + clip.duration, clip.duration, 0.1);
}

function getSlippedSourceWindow(
  clip: TimelineClipProps['clip'],
  sourceDelta: number,
): { inPoint: number; outPoint: number } {
  const visibleSourceDuration = clip.outPoint - clip.inPoint;
  const maxInPoint = Math.max(0, getClipSourceDuration(clip) - visibleSourceDuration);
  const inPoint = Math.max(0, Math.min(maxInPoint, clip.inPoint + sourceDelta));
  return {
    inPoint,
    outPoint: inPoint + visibleSourceDuration,
  };
}

type ClipKeyframeTickGroup = NonNullable<TimelineClipProps['keyframeTimeGroups']>[number];
type KeyframeGroupDragState = {
  keyframeIds: string[];
  startX: number;
  startTime: number;
  clipWidth: number;
  clipDuration: number;
};
type AudioRegionDragState = {
  anchorTimelineTime: number;
  startClientX: number;
  rectLeft: number;
  rectWidth: number;
};
type VideoBakeRegionDragState = {
  anchorTimelineTime: number;
  startClientX: number;
  rectLeft: number;
  rectWidth: number;
};
type AudioRegionMoveDragState = {
  startClientX: number;
  clipWidth: number;
  clipDuration: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};
type AudioRegionResizeDragState = {
  edge: 'left' | 'right';
  rectLeft: number;
  rectWidth: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};
type SpectralRegionDragState = AudioRegionDragState & {
  anchorFrequencyHz: number;
  startClientY: number;
  rectTop: number;
  rectHeight: number;
  maxFrequencyHz: number;
  mode: 'rectangle' | 'brush';
  brushTimeRadiusSeconds?: number;
  brushFrequencyRadiusHz?: number;
};
type AudioRegionGainDragState = {
  mode: 'gain' | 'fade-in' | 'fade-out';
  regionLeft: number;
  regionWidth: number;
  regionTop: number;
  regionHeight: number;
  regionDuration: number;
  startGainDb: number;
  startFadeInSeconds: number;
  startFadeOutSeconds: number;
  currentGainDb: number;
  currentFadeInSeconds: number;
  currentFadeOutSeconds: number;
};
type AudioRegionContextMenuState = {
  x: number;
  y: number;
  selection: TimelineAudioRegionSelection;
};

function TimelineClipComponent({
  clip,
  trackId,
  track,
  trackBaseHeight,
  tracks,
  clips,
  isSelected,
  isInLinkedGroup,
  isDragging,
  isTrimming,
  isFading,
  isLinkedToDragging,
  isLinkedToTrimming,
  isTrimFollower,
  isClipDragActive,
  clipDrag,
  clipTrim,
  clipFade: _clipFade,
  zoom,
  scrollX,
  timelineViewportWidth,
  proxyEnabled,
  proxyStatus,
  proxyProgress,
  audioProxyStatus,
  audioProxyProgress,
  showTranscriptMarkers,
  snappingEnabled,
  onMouseDown,
  onDoubleClick,
  onContextMenu,
  onTrimStart,
  onFadeStart,
  hasKeyframes,
  fadeInDuration,
  fadeOutDuration,
  opacityKeyframes,
  allKeyframeTimes,
  keyframeTimeGroups,
  onMoveKeyframeGroup,
  timeToPixel,
  formatTime,
  passiveVisualsSuppressed = false,
}: TimelineClipProps) {
  const thumbnailsEnabled = useTimelineStore(s => s.thumbnailsEnabled);
  const waveformsEnabled = useTimelineStore(s => s.waveformsEnabled);
  const audioDisplayMode = useTimelineStore(s => s.audioDisplayMode);
  const audioFocusMode = useTimelineStore(s => s.audioFocusMode);
  const trackFocusMode = useTimelineStore(s => s.trackFocusMode);
  const showAudioRegionEditMarkers = useTimelineStore(s => s.showAudioRegionEditMarkers);
  const activeTimelineToolId = useTimelineStore(s => s.activeTimelineToolId);
  const timelineToolPreview = useTimelineStore(s => s.timelineToolPreview);
  const clipStemSeparationJob = useTimelineStore(s => {
    const directJob = s.clipStemSeparationJobs[clip.id];
    if (directJob && (directJob.clipId === clip.id || directJob.requestedClipId === clip.id)) {
      return directJob;
    }

    const linkedJob = clip.linkedClipId ? s.clipStemSeparationJobs[clip.linkedClipId] : undefined;
    if (linkedJob && (linkedJob.clipId === clip.id || linkedJob.requestedClipId === clip.id || linkedJob.clipId === clip.linkedClipId)) {
      return linkedJob;
    }

    return Object.values(s.clipStemSeparationJobs).find(job =>
      job.clipId === clip.id ||
      job.requestedClipId === clip.id ||
      (clip.linkedClipId ? job.clipId === clip.linkedClipId || job.requestedClipId === clip.linkedClipId : false)
    ) ?? null;
  });
  const setTimelineToolPreview = useTimelineStore(s => s.setTimelineToolPreview);
  const applyTimelineEditOperation = useTimelineStore(s => s.applyTimelineEditOperation);
  const setActiveTimelineTool = useTimelineStore(s => s.setActiveTimelineTool);
  const timelineTrackColorsVisible = useTimelineStore(s => s.audioLayerAdvancedMode !== false);
  const audioRegionSelection = useTimelineStore(s =>
    s.audioRegionSelection?.clipId === clip.id ? s.audioRegionSelection : null
  );
  const audioRegionGainPreview = useTimelineStore(s =>
    s.audioRegionGainPreview?.clipId === clip.id ? s.audioRegionGainPreview : null
  );
  const audioSpectralRegionSelection = useTimelineStore(s =>
    s.audioSpectralRegionSelection?.clipId === clip.id ? s.audioSpectralRegionSelection : null
  );
  const videoBakeRegionSelection = useTimelineStore(s =>
    s.videoBakeRegionSelection?.scope === 'clip' && s.videoBakeRegionSelection.clipId === clip.id
      ? s.videoBakeRegionSelection
      : null
  );
  const setAudioRegionSelection = useTimelineStore(s => s.setAudioRegionSelection);
  const clearAudioRegionSelection = useTimelineStore(s => s.clearAudioRegionSelection);
  const setVideoBakeRegionSelection = useTimelineStore(s => s.setVideoBakeRegionSelection);
  const clearVideoBakeRegionSelection = useTimelineStore(s => s.clearVideoBakeRegionSelection);
  const addClipVideoBakeRegion = useTimelineStore(s => s.addClipVideoBakeRegion);
  const bakeClipVideoBakeRegion = useTimelineStore(s => s.bakeClipVideoBakeRegion);
  const unbakeClipVideoBakeRegion = useTimelineStore(s => s.unbakeClipVideoBakeRegion);
  const removeClipVideoBakeRegion = useTimelineStore(s => s.removeClipVideoBakeRegion);
  const setAudioSpectralRegionSelection = useTimelineStore(s => s.setAudioSpectralRegionSelection);
  const clearAudioSpectralRegionSelection = useTimelineStore(s => s.clearAudioSpectralRegionSelection);
  const hasAudioRegionClipboard = useTimelineStore(s => s.audioRegionClipboard !== null);
  const applyAudioRegionEdit = useTimelineStore(s => s.applyAudioRegionEdit);
  const setAudioRegionGainPreview = useTimelineStore(s => s.setAudioRegionGainPreview);
  const clearAudioRegionGainPreview = useTimelineStore(s => s.clearAudioRegionGainPreview);
  const setAudioRegionGainEdit = useTimelineStore(s => s.setAudioRegionGainEdit);
  const applySpectralRegionEdit = useTimelineStore(s => s.applySpectralRegionEdit);
  const addClipSpectralImageLayer = useTimelineStore(s => s.addClipSpectralImageLayer);
  const copySelectedAudioRegion = useTimelineStore(s => s.copySelectedAudioRegion);
  const pasteAudioRegionToSelection = useTimelineStore(s => s.pasteAudioRegionToSelection);
  const setClipAudioEditOperationEnabled = useTimelineStore(s => s.setClipAudioEditOperationEnabled);
  const setClipAudioEditOperationRange = useTimelineStore(s => s.setClipAudioEditOperationRange);
  const removeClipAudioEditOperation = useTimelineStore(s => s.removeClipAudioEditOperation);
  const clearClipAudioEditStack = useTimelineStore(s => s.clearClipAudioEditStack);
  const bakeClipAudioEditStack = useTimelineStore(s => s.bakeClipAudioEditStack);
  const unbakeClipAudioEditStack = useTimelineStore(s => s.unbakeClipAudioEditStack);
  const setClipSourceToStem = useTimelineStore(s => s.setClipSourceToStem);
  const prewarmStemSourceMediaFiles = useTimelineStore(s => s.prewarmStemSourceMediaFiles);
  const mediaFiles = useMediaStore(s => s.files);
  const selectClip = useTimelineStore(s => s.selectClip);
  const clipAudioKeyframes = useTimelineStore(s => s.clipKeyframes.get(clip.id) ?? EMPTY_CLIP_KEYFRAMES);
  const passiveMediaEnabled = !passiveVisualsSuppressed;
  const passiveDecorationsEnabled = passiveMediaEnabled;
  const processedWaveformPyramidRef = passiveMediaEnabled ? clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId : undefined;
  const sourceWaveformPyramidRef = passiveMediaEnabled ? clip.audioState?.sourceAnalysisRefs?.waveformPyramidId : undefined;
  const hasLegacyWaveformData = hasLegacyWaveformSamples(clip);
  const processedSpectrogramTileSetRef = passiveMediaEnabled ? clip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0] : undefined;
  const sourceSpectrogramTileSetRef = passiveMediaEnabled ? clip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0] : undefined;
  const processedWaveformState = useTimelineWaveformPyramidState(processedWaveformPyramidRef);
  const sourceWaveformState = useTimelineWaveformPyramidState(sourceWaveformPyramidRef);
  const processedSpectrogramState = useTimelineSpectrogramTileSetState(processedSpectrogramTileSetRef);
  const sourceSpectrogramState = useTimelineSpectrogramTileSetState(sourceSpectrogramTileSetRef);
  const processedWaveformPyramid = processedWaveformState.pyramid;
  const sourceWaveformPyramid = sourceWaveformState.pyramid;
  const audioEditStack = clip.audioState?.editStack ?? EMPTY_AUDIO_EDIT_STACK;
  const activeAudioEditCount = audioEditStack.filter(operation => operation.enabled !== false).length;
  const latestAudioBake = clip.audioState?.bakeHistory?.at(-1);
  const canUnbakeAudioEditStack = Boolean(latestAudioBake?.restore);
  const usePredictiveAudioWaveform = audioRegionGainPreview !== null || (!processedWaveformPyramid && audioEditStack.length > 0);
  const waveformPyramid = usePredictiveAudioWaveform && sourceWaveformPyramid
    ? sourceWaveformPyramid
    : processedWaveformPyramid ?? sourceWaveformPyramid;
  const waveformUsesProcessedPyramid = Boolean(waveformPyramid && processedWaveformPyramid && waveformPyramid === processedWaveformPyramid);
  const waveformUsesSourcePyramid = Boolean(waveformPyramid && sourceWaveformPyramid && waveformPyramid === sourceWaveformPyramid);
  const processedSpectrogramTileSet = processedSpectrogramState.tileSet;
  const sourceSpectrogramTileSet = sourceSpectrogramState.tileSet;
  const spectrogramTileSet = processedSpectrogramTileSet ?? sourceSpectrogramTileSet;
  const spectrogramVariant = processedSpectrogramTileSet ? 'processed' : 'source';
  const spectralMaxFrequencyHz = getSpectralMaxFrequencyHz(spectrogramTileSet?.sampleRate);
  const selectedSpectralImageFileId = useMediaStore(s => {
    for (const id of s.selectedIds) {
      const file = s.files.find(candidate => candidate.id === id);
      if (file?.type === 'image') return file.id;
    }
    return null;
  });
  const spectralImageMediaFiles = mediaFiles;
  const spectralImageFilesById = useMemo(() => {
    const entries = spectralImageMediaFiles
      .filter(file => file.type === 'image')
      .map(file => [file.id, file] as const);
    return new Map(entries);
  }, [spectralImageMediaFiles]);
  const selectedSpectralImageFile = selectedSpectralImageFileId
    ? spectralImageFilesById.get(selectedSpectralImageFileId) ?? null
    : null;
  const waveformVariant = waveformUsesProcessedPyramid
    ? 'processed'
    : waveformUsesSourcePyramid
      ? 'source'
      : 'legacy';
  const waveformDisplayGain = useMemo(() => {
    const clipAudioEffectIds = new Set((clip.audioState?.effectStack ?? []).map(effect => effect.id));
    const graphSettings = collectAudioEffectInstanceRouteSettings(clip.audioState?.effectStack);
    const legacySettings = collectLegacyAudioEffectRouteSettings(clip.effects, clipAudioEffectIds);
    return Math.max(0, Math.min(8, graphSettings.volume * legacySettings.volume));
  }, [clip.audioState?.effectStack, clip.effects]);
  const rawWaveformProcessingState = processedWaveformPyramidRef && !processedWaveformState.pyramid
    ? `waveform-processed-${processedWaveformState.status}`
    : '';
  const spectrogramProcessingState = audioDisplayMode === 'spectral'
    && processedSpectrogramTileSetRef
    && !processedSpectrogramState.tileSet
    ? `spectrogram-processed-${processedSpectrogramState.status}`
    : '';
  const needsProcessedAudioAnalysis = useMemo(
    () => clipRequiresProcessedWaveformPyramid(clip, clipAudioKeyframes),
    [clip, clipAudioKeyframes],
  );
  const canDeriveVisibleProcessedWaveform = useMemo(
    () => canDeriveProcessedWaveformPyramid(clip, clipAudioKeyframes),
    [clip, clipAudioKeyframes],
  );
  const hasWaveformDisplayFallback = Boolean(
    sourceWaveformPyramid ||
    hasLegacyWaveformData,
  );
  const shouldSuppressBackgroundProcessedWaveformUi = audioDisplayMode !== 'spectral' &&
    needsProcessedAudioAnalysis &&
    hasWaveformDisplayFallback &&
    (canDeriveVisibleProcessedWaveform || usePredictiveAudioWaveform);
  const waveformProcessingState = shouldSuppressBackgroundProcessedWaveformUi
    ? ''
    : rawWaveformProcessingState;
  const canResolveAudioSourceForAnalysis = Boolean(
    clip.isComposition ||
    clip.file ||
    clip.mediaFileId ||
    clip.source?.mediaFileId,
  );
  const processedWaveformStatus = shouldSuppressBackgroundProcessedWaveformUi
    ? null
    : resolveProcessedAudioAnalysisDisplayStatus({
        artifactLabel: 'waveform',
        needsProcessed: needsProcessedAudioAnalysis,
        processedRef: processedWaveformPyramidRef,
        processedReady: Boolean(processedWaveformPyramid),
        fallbackAvailable: hasWaveformDisplayFallback,
        loadStatus: processedWaveformState.status,
        jobActive: clip.audioAnalysisJob?.artifactKinds.includes('processed-waveform-pyramid') === true,
        autoGenerateEligible: canResolveAudioSourceForAnalysis,
      });
  const processedSpectrogramStatus = resolveProcessedAudioAnalysisDisplayStatus({
    artifactLabel: 'spectrogram',
    needsProcessed: needsProcessedAudioAnalysis,
    processedRef: processedSpectrogramTileSetRef,
    processedReady: Boolean(processedSpectrogramTileSet),
    fallbackAvailable: Boolean(sourceSpectrogramTileSet),
    loadStatus: processedSpectrogramState.status,
    jobActive: clip.audioAnalysisJob?.artifactKinds.includes('spectrogram-tiles') === true,
    autoGenerateEligible: canResolveAudioSourceForAnalysis,
  });
  const audioAnalysisDisplayStatus = audioDisplayMode === 'spectral'
    ? processedSpectrogramStatus
    : processedWaveformStatus;
  const isBackgroundProcessedWaveformJob = clip.audioAnalysisJob?.processed === true &&
    clip.audioAnalysisJob.artifactKinds.includes('processed-waveform-pyramid');
  const showWaveformGenerationIndicator = clip.waveformGenerating &&
    !(isBackgroundProcessedWaveformJob && shouldSuppressBackgroundProcessedWaveformUi);
  const isBladeToolActive = isTimelineBladeTool(activeTimelineToolId);
  const isPointerToolActive = isTimelinePointerTool(activeTimelineToolId);
  const timelineToolCursor = getTimelineToolCursor(activeTimelineToolId);
  const canUseTrimHandles =
    activeTimelineToolId === 'select' ||
    activeTimelineToolId === 'edge-trim' ||
    activeTimelineToolId === 'ripple-trim' ||
    activeTimelineToolId === 'rolling-edit' ||
    activeTimelineToolId === 'rate-stretch';
  const canUseFadeHandles = activeTimelineToolId === 'select';
  const canUseBodyToolGesture = activeTimelineToolId === 'slip' || activeTimelineToolId === 'slide';
  const leftTrimHandleDirections = getTrimHandleArrowDirections(clip, 'left');
  const rightTrimHandleDirections = getTrimHandleArrowDirections(clip, 'right');

  // Subscribe to playhead position only when blade tool is active (avoids re-renders during playback)
  const playheadPosition = useTimelineStore((state) =>
    isBladeToolActive ? state.playheadPosition : 0
  );

  // Look up media label color from mediaStore
  const mediaLabelHex = useMediaStore(s => resolveClipLabelHex(clip, s));

  // Animation phase for enter/exit transitions
  const clipAnimationPhase = useTimelineStore(s => s.clipAnimationPhase);
  const compositionSwitchDirection = useTimelineStore(s => s.compositionSwitchDirection);
  const clipEntranceKey = useTimelineStore(s => s.clipEntranceAnimationKey);
  const aiMove = useTimelineStore(s => s.aiMovingClips.get(clip.id));
  const [mountEntranceKey] = useState(clipEntranceKey);
  const [stemMenuOpen, setStemMenuOpen] = useState(false);
  const stemMenuCloseTimerRef = useRef<number | null>(null);

  // Only compute stagger order during composition entrance animation. Doing a
  // full clips sort inside every TimelineClip render gets very expensive once
  // AI splits create hundreds of clips.
  const animationDelay = clipAnimationPhase === 'entering'
    ? Math.max(0, (() => {
        const sorted = [...clips].sort((a, b) => {
          const aTrack = tracks.findIndex(t => t.id === a.trackId);
          const bTrack = tracks.findIndex(t => t.id === b.trackId);
          if (aTrack !== bTrack) return aTrack - bTrack;
          return a.startTime - b.startTime;
        });
        return sorted.findIndex(c => c.id === clip.id);
      })()) * 0.02
    : 0;

  // Determine animation class:
  // - 'exiting': apply exit animation
  // - 'entering' + new clips: apply entrance animation (only during composition switch)
  // - Otherwise: no animation
  const isNewClip = mountEntranceKey === clipEntranceKey && clipEntranceKey > 0;
  const exitAnimationClass = compositionSwitchDirection === 'backward'
    ? 'exit-animate exit-animate-left'
    : 'exit-animate exit-animate-right';
  const entranceAnimationClass = compositionSwitchDirection === 'backward'
    ? 'entrance-animate entrance-animate-right'
    : 'entrance-animate entrance-animate-left';
  const animationClass = clipAnimationPhase === 'exiting'
    ? exitAnimationClass
    : (clipAnimationPhase === 'entering' && isNewClip)
      ? entranceAnimationClass
      : '';

  // AI move animation (FLIP technique)
  const [aiMovePhase, setAiMovePhase] = useState<'idle' | 'initial' | 'animating'>('idle');
  const aiMoveRef = useRef<number | null>(null);
  const aiMoveStartedAt = aiMove?.startedAt;
  const aiMoveDuration = aiMove?.animationDuration ?? 200;

  useEffect(() => {
    if (aiMoveStartedAt !== undefined) {
      // Double-rAF to ensure the initial transform is painted before starting transition
      const raf1 = requestAnimationFrame(() => {
        setAiMovePhase('initial');
        const raf2 = requestAnimationFrame(() => {
          setAiMovePhase('animating');
        });
        aiMoveRef.current = raf2;
      });
      const timer = setTimeout(() => {
        setAiMovePhase('idle');
      }, aiMoveDuration + 50);
      return () => {
        cancelAnimationFrame(raf1);
        if (aiMoveRef.current) cancelAnimationFrame(aiMoveRef.current);
        clearTimeout(timer);
      };
    } else {
      const frame = requestAnimationFrame(() => setAiMovePhase('idle'));
      return () => cancelAnimationFrame(frame);
    }
  }, [aiMoveDuration, aiMoveStartedAt]);

  // Check if this clip should show blade indicator (either directly hovered or linked to hovered clip)
  const isDirectlyHovered = timelineToolPreview?.clipId === clip.id;
  const linkedClip = clip.linkedClipId ? clips.find(c => c.id === clip.linkedClipId) : null;
  const isLinkedToHovered = linkedClip && timelineToolPreview?.clipId === linkedClip.id;
  // Also check reverse link - if another clip links to this one
  const reverseLinkedClip = clips.find(c => c.linkedClipId === clip.id);
  const isReverseLinkedToHovered = reverseLinkedClip && timelineToolPreview?.clipId === reverseLinkedClip.id;
  const shouldShowCutIndicator = isBladeToolActive &&
    timelineToolPreview &&
    isTimelineBladeTool(timelineToolPreview.toolId) &&
    timelineToolPreview.plane === 'clip-local' &&
    !timelineToolPreview.blocked &&
    (isDirectlyHovered || isLinkedToHovered || isReverseLinkedToHovered);

  // Determine if this is an audio clip (check source type, MIME type, or extension as fallback)
  const audioExtensions = ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus'];
  const fileExt = (clip.file?.name || clip.name || '').split('.').pop()?.toLowerCase() || '';
  const isAudioClip = clip.source?.type === 'audio' ||
    clip.file?.type?.startsWith('audio/') ||
    audioExtensions.includes(fileExt);

  // Determine if this is a text clip
  const isTextClip = clip.source?.type === 'text';
  const meshType = clip.meshType ?? clip.source?.meshType;
  const isText3DClip = clip.source?.type === 'model' && meshType === 'text3d';
  const isModelClip = clip.source?.type === 'model' && !isText3DClip;
  const text3DProperties = clip.text3DProperties ?? clip.source?.text3DProperties;

  // Determine if this is a solid clip
  const isSolidClip = clip.source?.type === 'solid';
  const isMathSceneClip = clip.source?.type === 'math-scene';
  const isVectorAnimationClip = isVectorAnimationSourceType(clip.source?.type);
  const vectorAnimationIcon = clip.source?.type === 'rive' ? 'R' : 'L';
  const vectorAnimationTitle = clip.source?.type === 'rive' ? 'Rive Clip' : 'Lottie Clip';
  const isCameraClip = clip.source?.type === 'camera';
  const isGaussianSplatClip = clip.source?.type === 'gaussian-splat';
  const isSplatEffectorClip = clip.source?.type === 'splat-effector';
  const staticClipIconKind: StaticClipIconKind | null = isCameraClip
    ? 'camera'
    : isGaussianSplatClip
      ? 'gaussian-splat'
      : isModelClip
        ? 'model'
        : null;
  const showsStaticClipArtwork = staticClipIconKind !== null;

  const isGeneratingProxy = proxyStatus === 'generating';
  const hasProxy = proxyStatus === 'ready';
  const hasProxyError = proxyStatus === 'error';
  const isGeneratingAudioProxy = audioProxyStatus === 'generating';
  const hasAudioProxy = audioProxyStatus === 'ready';
  const hasAudioProxyError = audioProxyStatus === 'error';
  const activeStemSeparationJob = clipStemSeparationJob && ACTIVE_STEM_JOB_PHASES.has(clipStemSeparationJob.phase)
    ? clipStemSeparationJob
    : null;
  const activeStemProgressPercent = activeStemSeparationJob
    ? Math.round(Math.max(0, Math.min(1, activeStemSeparationJob.progress)) * 100)
    : 0;
  const activeStemStatusLabel = activeStemSeparationJob
    ? activeStemSeparationJob.message ?? formatStemJobPhase(activeStemSeparationJob.phase)
    : '';
  const activeStemStatusTitle = activeStemSeparationJob
    ? `${activeStemStatusLabel}: ${activeStemProgressPercent}%`
    : undefined;
  const isDownloadingStemModel = activeStemSeparationJob?.phase === 'downloading-model';
  const completedStemChoices = !activeStemSeparationJob && clipStemSeparationJob?.phase === 'complete'
    ? clipStemSeparationJob.stems ?? EMPTY_STEM_CHOICES
    : EMPTY_STEM_CHOICES;
  const hasCompletedStemChoices = completedStemChoices.length > 0;
  let stemSourceMediaFileId = clipStemSeparationJob?.sourceMediaFileId ?? null;
  if (!stemSourceMediaFileId) {
    for (const stem of completedStemChoices) {
      const sourceMediaFileId = mediaFiles.find(file => file.id === stem.mediaFileId)?.stemInfo?.sourceMediaFileId;
      if (sourceMediaFileId) {
        stemSourceMediaFileId = sourceMediaFileId;
        break;
      }
    }
  }
  const hasStemSourceChoice = Boolean(
    stemSourceMediaFileId &&
    mediaFiles.some(file => file.id === stemSourceMediaFileId && file.type === 'audio')
  );
  const stemSourceClip = clipStemSeparationJob
    ? clips.find(candidate => candidate.id === clipStemSeparationJob.clipId)
    : clip;
  const activeStemMediaFileId = stemSourceClip?.source?.mediaFileId ?? stemSourceClip?.mediaFileId;

  // Check if this clip is linked to the dragging/trimming clip
  const draggedClip = clipDrag
    ? clips.find((c) => c.id === clipDrag.clipId)
    : null;
  const trimmedClip = clipTrim
    ? clips.find((c) => c.id === clipTrim.clipId)
    : null;

  // Calculate live trim values (including inPoint/outPoint for waveform/thumbnail rendering)
  let displayStartTime = clip.startTime;
  let displayDuration = clip.duration;
  let displayInPoint = clip.inPoint;
  let displayOutPoint = clip.outPoint;

  if (isTrimming && clipTrim) {
    // Use the resolved (snapped/frame-quantized) delta so the live resize lands
    // exactly where the trim will commit.
    const deltaTime = clipTrim.appliedDelta;
    const sourceType = clip.source?.type;
    const isInfiniteClip = sourceType === 'text' || sourceType === 'image' || sourceType === 'solid' || sourceType === 'camera' || sourceType === 'splat-effector' || sourceType === 'math-scene';
    const canLoopExtendRight = canLoopExtendVectorClip(clip);
    const maxDuration = isInfiniteClip
      ? Number.MAX_SAFE_INTEGER
      : (clip.source?.naturalDuration || clip.duration);

    if (clipTrim.edge === 'left') {
      const maxTrim = clipTrim.originalDuration - 0.1;
      const minTrim = isInfiniteClip
        ? -clipTrim.originalStartTime
        : -clipTrim.originalInPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      displayStartTime = clipTrim.originalStartTime + clampedDelta;
      displayDuration = clipTrim.originalDuration - clampedDelta;
      // Update inPoint when trimming left edge
      displayInPoint = clipTrim.originalInPoint + clampedDelta;
    } else {
      const maxExtend = canLoopExtendRight
        ? Number.MAX_SAFE_INTEGER
        : maxDuration - clipTrim.originalOutPoint;
      const minTrim = -(clipTrim.originalDuration - 0.1);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      displayDuration = clipTrim.originalDuration + clampedDelta;
      // Update outPoint when trimming right edge
      displayOutPoint = clipTrim.originalOutPoint + clampedDelta;
    }
  } else if (clipTrim && (isTrimFollower || (isLinkedToTrimming && trimmedClip))) {
    // Resize this clip live too: a linked clip, or a selected clip following a
    // multi-trim. Each clamps the shared (snapped) delta to its own bounds.
    const deltaTime = clipTrim.appliedDelta;
    const canLoopExtendRight = canLoopExtendVectorClip(clip);
    const maxDuration = clip.source?.naturalDuration || clip.duration;

    if (clipTrim.edge === 'left') {
      const maxTrim = clip.duration - 0.1;
      const minTrim = -clip.inPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      displayStartTime = clip.startTime + clampedDelta;
      displayDuration = clip.duration - clampedDelta;
      displayInPoint = clip.inPoint + clampedDelta;
    } else {
      const maxExtend = canLoopExtendRight
        ? Number.MAX_SAFE_INTEGER
        : maxDuration - clip.outPoint;
      const minTrim = -(clip.duration - 0.1);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      displayDuration = clip.duration + clampedDelta;
      displayOutPoint = clip.outPoint + clampedDelta;
    }
  }

  const isSlipPreview =
    clipDrag?.toolGesture === 'slip' &&
    clipDrag.sourceTimeDelta !== undefined &&
    (isDragging || (!clipDrag.altKeyPressed && isLinkedToDragging));
  if (isSlipPreview) {
    const sourceWindow = getSlippedSourceWindow(clip, clipDrag.sourceTimeDelta ?? 0);
    displayInPoint = sourceWindow.inPoint;
    displayOutPoint = sourceWindow.outPoint;
  }

  const width = timeToPixel(displayDuration);
  const isClipPositionDragPreview = !clipDrag?.toolGesture && (
    isDragging ||
    isLinkedToDragging ||
    (
      clipDrag?.multiSelectClipIds?.includes(clip.id) &&
      clipDrag.multiSelectTimeDelta !== undefined
    )
  );

  // Calculate position - if dragging, use the computed position (with snapping/resistance)
  let left = timeToPixel(displayStartTime);
  if (isDragging && clipDrag) {
    // Always use snappedTime when available - it contains the position with snapping and resistance applied
    if (clipDrag.snappedTime !== null) {
      left = timeToPixel(clipDrag.snappedTime);
    }
  } else if (isLinkedToDragging && clipDrag && draggedClip) {
    // Move linked clip in sync - use computed position (snapped + resistance) if available
    if (clipDrag.snappedTime !== null) {
      const newDragTime = clipDrag.snappedTime;
      const timeDelta = newDragTime - draggedClip.startTime;
      left = timeToPixel(Math.max(0, clip.startTime + timeDelta));
    }
  } else if (clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined) {
    // This clip is part of multi-select drag (but not the primary dragged clip)
    left = timeToPixel(Math.max(0, clip.startTime + clipDrag.multiSelectTimeDelta));
  }
  const visibleTimelineViewportWidth = timelineViewportWidth > 0
    ? timelineViewportWidth
    : TIMELINE_VIEWPORT_FALLBACK_PX;
  const renderTimelineViewportWidth = resolveTimelineViewportWidth({
    timelineViewportWidth,
    fallbackPx: TIMELINE_VIEWPORT_FALLBACK_PX,
    minPx: TIMELINE_VIEWPORT_MIN_PX,
  });
  const staticContentRenderLeft = isClipPositionDragPreview
    ? timeToPixel(displayStartTime)
    : left;
  const waveformRenderWindow = resolveHorizontalRenderWindow({
    scrollX,
    contentLeft: staticContentRenderLeft,
    contentWidth: width,
    viewportWidth: renderTimelineViewportWidth,
    overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
  });
  const thumbnailRenderWindow = resolveHorizontalRenderWindow({
    scrollX,
    contentLeft: staticContentRenderLeft,
    contentWidth: width,
    viewportWidth: renderTimelineViewportWidth,
    overscanPx: THUMBNAIL_RENDER_OVERSCAN_PX,
  });
  const thumbnailVisibleSourceWindow = resolveVisibleSourceWindow({
    inPoint: displayInPoint,
    outPoint: displayOutPoint,
    clipWidth: width,
    renderWindow: thumbnailRenderWindow,
  });
  const thumbnailVisibleInPoint = thumbnailVisibleSourceWindow.inPoint;
  const thumbnailVisibleOutPoint = thumbnailVisibleSourceWindow.outPoint;

  useEffect(() => {
    if (!passiveMediaEnabled || !waveformsEnabled || !isAudioClip || clip.waveformGenerating || isClipDragActive) {
      return;
    }

    const shouldUpgrade =
      audioDisplayMode === 'detailed' ||
      (audioDisplayMode === 'compact' && (zoom >= WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM || width > WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH));

    if (!shouldUpgrade) return;

    const request = createTimelineSourceWaveformGenerationRequest(clip, audioDisplayMode);
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

  const waveformNaturalDuration = processedWaveformPyramid
    ? Math.max(0.001, processedWaveformPyramid.duration)
    : (clip.source?.naturalDuration || clip.duration);
  const waveformInPoint = processedWaveformPyramid ? 0 : displayInPoint;
  const waveformOutPoint = processedWaveformPyramid
    ? Math.max(0.001, processedWaveformPyramid.duration)
    : displayOutPoint;
  const spectrogramNaturalDuration = processedSpectrogramTileSet
    ? Math.max(0.001, processedSpectrogramTileSet.duration)
    : (clip.source?.naturalDuration || clip.duration);
  const spectrogramInPoint = processedSpectrogramTileSet ? 0 : displayInPoint;
  const spectrogramOutPoint = processedSpectrogramTileSet
    ? Math.max(0.001, processedSpectrogramTileSet.duration)
    : displayOutPoint;
  const audioWaveformDiagnostics = useMemo(() => {
    if (!isAudioClip || !waveformsEnabled) return null;
    if (!waveformPyramid && (!clip.waveform || clip.waveform.length === 0)) return null;

    return resolveAudioWaveformDiagnostics({
      waveform: clip.waveform,
      pyramid: waveformPyramid,
      inPoint: waveformInPoint,
      outPoint: waveformOutPoint,
      naturalDuration: waveformNaturalDuration,
      gain: waveformVariant === 'processed' ? 1 : waveformDisplayGain,
    });
  }, [
    clip.waveform,
    isAudioClip,
    waveformDisplayGain,
    waveformInPoint,
    waveformNaturalDuration,
    waveformOutPoint,
    waveformPyramid,
    waveformVariant,
    waveformsEnabled,
  ]);
  const audioVolumeAutomationKeyframes = useMemo(() => {
    if (!isAudioClip) return [];

    return resolveAudioVolumeAutomationCurveKeyframes({
      keyframes: clipAudioKeyframes,
      legacyEffects: clip.effects,
      audioEffectStack: clip.audioState?.effectStack,
      clipDuration: displayDuration,
    });
  }, [
    clip.audioState?.effectStack,
    clip.effects,
    clipAudioKeyframes,
    displayDuration,
    isAudioClip,
  ]);
  const visibleFadeCurveKeyframes = isAudioClip ? audioVolumeAutomationKeyframes : opacityKeyframes;
  const visibleFadeCurveKey = visibleFadeCurveKeyframes
    .map(k => `${k.id}:${k.time.toFixed(3)}:${k.value}:${k.handleIn?.x ?? ''}:${k.handleIn?.y ?? ''}:${k.handleOut?.x ?? ''}:${k.handleOut?.y ?? ''}`)
    .join('|');

  const clipMetaOffset = clip.isLoading
    ? 0
    : Math.min(
        Math.max(0, scrollX - left),
        Math.max(0, width - 48)
      );
  const clipRightOverflow = left + width - (scrollX + visibleTimelineViewportWidth);
  const clipRightStickyOffset = Math.max(
    0,
    Math.min(
      Math.max(0, width - 18),
      clipRightOverflow > 0 ? clipRightOverflow + CLIP_RIGHT_STICKY_PADDING_PX : 0
    )
  );

  // Render only the visible filmstrip window. At deep zoom the full clip can be
  // hundreds of thousands of pixels wide, so tying thumbnails to full clip width
  // makes the entire timeline unresponsive.
  const visibleThumbs = thumbnailRenderWindow.width > 0
    ? Math.max(1, Math.ceil(thumbnailRenderWindow.width / THUMB_WIDTH) + 1)
    : 0;

  // Source-based thumbnail cache: pull thumbnails from cache by mediaFileId
  const sourceMediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
  const isCompositionWithSegments = clip.isComposition && clip.clipSegments && clip.clipSegments.length > 0;
  const useSourceCache = passiveMediaEnabled && clip.source?.type === 'video' && !!sourceMediaFileId && !isCompositionWithSegments;
  const cachedThumbnails = useThumbnailCache(
    useSourceCache ? sourceMediaFileId : undefined,
    thumbnailVisibleInPoint,
    thumbnailVisibleOutPoint,
    visibleThumbs,
    clip.reversed
  );
  // Fallback to clip.thumbnails for compositions/legacy clips without mediaFileId
  const legacyThumbnails = clip.thumbnails || [];
  const compositionSegments = clip.clipSegments ?? [];
  const showSegmentThumbnails = passiveMediaEnabled &&
    thumbnailsEnabled &&
    clip.isComposition &&
    compositionSegments.length > 0 &&
    !isAudioClip &&
    !showsStaticClipArtwork;
  const showRegularThumbnails = passiveMediaEnabled &&
    thumbnailsEnabled &&
    !isAudioClip &&
    !showsStaticClipArtwork &&
    !isCompositionWithSegments &&
    (useSourceCache ? cachedThumbnails.some(Boolean) : legacyThumbnails.length > 0);

  const keyframeTickGroups: ClipKeyframeTickGroup[] = keyframeTimeGroups ?? allKeyframeTimes.map(time => ({
    time,
    keyframeIds: [],
  }));
  const [keyframeGroupDrag, setKeyframeGroupDrag] = useState<KeyframeGroupDragState | null>(null);
  const [audioRegionDrag, setAudioRegionDrag] = useState<AudioRegionDragState | null>(null);
  const [videoBakeRegionDrag, setVideoBakeRegionDrag] = useState<VideoBakeRegionDragState | null>(null);
  const [audioRegionMoveDrag, setAudioRegionMoveDrag] = useState<AudioRegionMoveDragState | null>(null);
  const [audioRegionResizeDrag, setAudioRegionResizeDrag] = useState<AudioRegionResizeDragState | null>(null);
  const [spectralRegionDrag, setSpectralRegionDrag] = useState<SpectralRegionDragState | null>(null);
  const [audioRegionGainDrag, setAudioRegionGainDrag] = useState<AudioRegionGainDragState | null>(null);
  const [audioRegionContextMenu, setAudioRegionContextMenu] = useState<AudioRegionContextMenuState | null>(null);
  const audioRegionCommandHandledRef = useRef(false);
  const { menuRef: audioRegionContextMenuRef, adjustedPosition: audioRegionContextMenuPosition } =
    useContextMenuPosition(audioRegionContextMenu);
  const [audioBakePending, setAudioBakePending] = useState(false);

  const getMatchingAudioRegionOperationIds = useCallback((selection: TimelineAudioRegionSelection): string[] => {
    const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
    const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);
    return audioEditStack
      .filter(operation => {
        if (!operation.timeRange) return false;
        const operationStart = Math.min(operation.timeRange.start, operation.timeRange.end);
        const operationEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
        return Math.abs(operationStart - start) <= 0.001 &&
          Math.abs(operationEnd - end) <= 0.001;
      })
      .map(operation => operation.id);
  }, [audioEditStack]);

  const activeAudioRegionOperationDrag = audioRegionMoveDrag ?? audioRegionResizeDrag;
  const displayAudioEditStack = useMemo(() => {
    if (!audioRegionSelection || !activeAudioRegionOperationDrag?.operationIds.length) {
      return audioEditStack;
    }

    const operationIds = new Set(activeAudioRegionOperationDrag.operationIds);
    const start = Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const end = Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const timelineStart = Math.min(audioRegionSelection.startTime, audioRegionSelection.endTime);
    const timelineEnd = Math.max(audioRegionSelection.startTime, audioRegionSelection.endTime);

    return audioEditStack.map(operation => {
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
  }, [activeAudioRegionOperationDrag, audioEditStack, audioRegionSelection]);
  const preferSourceWaveformForAudioRegionDrag = Boolean(activeAudioRegionOperationDrag?.operationIds.length && sourceWaveformPyramid);
  const waveformPyramidForRender = preferSourceWaveformForAudioRegionDrag
    ? sourceWaveformPyramid
    : waveformPyramid;
  const waveformVariantForRender = preferSourceWaveformForAudioRegionDrag
    ? 'source'
    : waveformVariant;
  const waveformUsesProcessedPyramidForRender = Boolean(
    waveformPyramidForRender &&
    processedWaveformPyramid &&
    waveformPyramidForRender === processedWaveformPyramid,
  );
  const processedWaveformPyramidForRender = waveformUsesProcessedPyramidForRender
    ? processedWaveformPyramid
    : null;
  const waveformNaturalDurationForRender = processedWaveformPyramidForRender
    ? Math.max(0.001, processedWaveformPyramidForRender.duration)
    : (clip.source?.naturalDuration || clip.duration);
  const waveformInPointForRender = processedWaveformPyramidForRender ? 0 : displayInPoint;
  const waveformOutPointForRender = processedWaveformPyramidForRender
    ? Math.max(0.001, processedWaveformPyramidForRender.duration)
    : displayOutPoint;
  const waveformLegacyForRender = clip.waveform ?? [];
  const waveformChannelsForRender = clip.waveformChannels;
  const hasWaveformForRender = Boolean(
    waveformPyramidForRender ||
    waveformLegacyForRender.length > 0 ||
    waveformChannelsForRender?.some(channel => channel.length > 0)
  );
  const waveformDisplayGainForRender = waveformDisplayGain;
  const canApplyPredictiveAudioWaveform = waveformVariantForRender !== 'processed';
  const predictiveAudioEditStack = canApplyPredictiveAudioWaveform
    ? displayAudioEditStack
    : EMPTY_AUDIO_EDIT_STACK;
  const predictiveAudioRegionGainPreview = canApplyPredictiveAudioWaveform
    ? audioRegionGainPreview
    : null;
  const originalWaveformTrimInPoint = isTrimming && clipTrim
    ? clipTrim.originalInPoint
    : clip.inPoint;
  const originalWaveformTrimOutPoint = isTrimming && clipTrim
    ? clipTrim.originalOutPoint
    : clip.outPoint;
  const stableWaveformGeometry = resolveStableWaveformRenderGeometry({
    isAudioClip,
    isTrimming,
    isLinkedToTrimming,
    hasClipTrim: Boolean(clipTrim),
    usesProcessedPyramid: Boolean(processedWaveformPyramidForRender),
    clipWidth: width,
    clipLeft: left,
    scrollX,
    viewportWidth: renderTimelineViewportWidth,
    overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
    baseRenderWindow: waveformRenderWindow,
    waveformInPoint: waveformInPointForRender,
    waveformOutPoint: waveformOutPointForRender,
    originalInPoint: originalWaveformTrimInPoint,
    originalOutPoint: originalWaveformTrimOutPoint,
    displayDuration,
  });
  const useStableWaveformTrimWindow = stableWaveformGeometry.useStableTrimWindow;
  const waveformSourceSecondsPerPixel = stableWaveformGeometry.sourceSecondsPerPixel;
  const stableWaveformContentInPoint = stableWaveformGeometry.contentInPoint;
  const stableWaveformContentOutPoint = stableWaveformGeometry.contentOutPoint;
  const stableWaveformContentWidth = stableWaveformGeometry.contentWidth;
  const stableWaveformContentOffsetPx = stableWaveformGeometry.contentOffsetPx;
  const stableWaveformRenderWindow = stableWaveformGeometry.renderWindow;
  const stableWaveformClipDuration = stableWaveformGeometry.clipDuration;

  const commitAudioRegionOperationRange = useCallback((
    operationIds: string[],
    selection: TimelineAudioRegionSelection,
    historyLabel: string,
  ) => {
    if (operationIds.length === 0) return;
    setClipAudioEditOperationRange(clip.id, operationIds, selection, {
      captureHistory: true,
      historyLabel,
    });
  }, [clip.id, setClipAudioEditOperationRange]);

  const handleKeyframeTickMouseDown = (
    e: React.MouseEvent<HTMLButtonElement>,
    group: ClipKeyframeTickGroup
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!onMoveKeyframeGroup || group.keyframeIds.length === 0) return;

    setKeyframeGroupDrag({
      keyframeIds: group.keyframeIds,
      startX: e.clientX,
      startTime: group.time,
      clipWidth: Math.max(1, width),
      clipDuration: Math.max(0.001, displayDuration),
    });
  };

  useEffect(() => {
    if (!keyframeGroupDrag || !onMoveKeyframeGroup) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const deltaX = e.clientX - keyframeGroupDrag.startX;
      const deltaTime = (deltaX / keyframeGroupDrag.clipWidth) * keyframeGroupDrag.clipDuration;
      let newTime = Math.max(
        0,
        Math.min(keyframeGroupDrag.clipDuration, keyframeGroupDrag.startTime + deltaTime)
      );

      if (e.shiftKey) {
        const movingIds = new Set(keyframeGroupDrag.keyframeIds);
        let bestDistancePx = KEYFRAME_TICK_SNAP_THRESHOLD_PX;

        for (const group of keyframeTickGroups) {
          if (group.keyframeIds.some(id => movingIds.has(id))) continue;

          const distancePx = Math.abs(
            ((group.time - newTime) / keyframeGroupDrag.clipDuration) * keyframeGroupDrag.clipWidth
          );

          if (distancePx <= bestDistancePx) {
            bestDistancePx = distancePx;
            newTime = group.time;
          }
        }
      }

      onMoveKeyframeGroup(keyframeGroupDrag.keyframeIds, newTime);
    };

    const handleDocumentMouseUp = () => {
      setKeyframeGroupDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [keyframeGroupDrag, keyframeTickGroups, onMoveKeyframeGroup]);

  const canSelectAudioRegion = audioFocusMode &&
    isAudioClip &&
    audioDisplayMode === 'detailed' &&
    activeTimelineToolId === 'select' &&
    track.locked !== true;
  const canSelectSpectralRegion = audioFocusMode &&
    isAudioClip &&
    audioDisplayMode === 'spectral' &&
    activeTimelineToolId === 'select' &&
    track.locked !== true;
  const canSelectVideoBakeRegion = trackFocusMode === 'video' &&
    !isAudioClip &&
    activeTimelineToolId === 'select' &&
    track.locked !== true;

  const timelineTimeFromAudioRegionClientX = useCallback((
    clientX: number,
    drag: Pick<AudioRegionDragState, 'rectLeft' | 'rectWidth'>,
  ): number => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    return displayStartTime + (x / Math.max(1, drag.rectWidth)) * Math.max(0.001, displayDuration);
  }, [displayDuration, displayStartTime]);

  const timelineTimeFromVideoBakeClientX = useCallback((
    clientX: number,
    drag: Pick<VideoBakeRegionDragState, 'rectLeft' | 'rectWidth'>,
  ): number => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    return displayStartTime + (x / Math.max(1, drag.rectWidth)) * Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
  }, [displayDuration, displayStartTime]);

  const sourceTimeFromVideoBakeTimelineTime = useCallback((timelineTime: number): number => {
    const clipDuration = Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayOutPoint ?? sourceStart + clipDuration);
    const timelineRatio = Math.max(0, Math.min(1, (timelineTime - displayStartTime) / clipDuration));
    const sourceRatio = clip.reversed ? 1 - timelineRatio : timelineRatio;
    return sourceStart + sourceRatio * (sourceEnd - sourceStart);
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);

  const sourceTimeToVideoBakeTimelineTime = useCallback((sourceTime: number): number => {
    const clipDuration = Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayOutPoint ?? sourceStart + clipDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
    return displayStartTime + timelineRatio * clipDuration;
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);

  const resolveVideoBakeRegionDragSelection = useCallback((
    drag: VideoBakeRegionDragState,
    clientX: number,
  ): TimelineVideoBakeRegionSelection => {
    const focusTimelineTime = timelineTimeFromVideoBakeClientX(clientX, drag);
    return {
      scope: 'clip',
      clipId: clip.id,
      trackId: track.id,
      startTime: drag.anchorTimelineTime,
      endTime: focusTimelineTime,
      sourceInPoint: sourceTimeFromVideoBakeTimelineTime(drag.anchorTimelineTime),
      sourceOutPoint: sourceTimeFromVideoBakeTimelineTime(focusTimelineTime),
    };
  }, [
    clip.id,
    sourceTimeFromVideoBakeTimelineTime,
    timelineTimeFromVideoBakeClientX,
    track.id,
  ]);

  const resolveAudioRegionDragSelection = useCallback((
    drag: AudioRegionDragState,
    clientX: number,
  ) => resolveTimelineAudioRegionSelection({
    clip: {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    },
    anchorTimelineTime: drag.anchorTimelineTime,
    focusTimelineTime: timelineTimeFromAudioRegionClientX(clientX, drag),
    snapThresholdSeconds: Math.min(0.035, Math.max(0.002, 7 / Math.max(1, zoom))),
  }), [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
    zoom,
  ]);

  const resolveAudioRegionMoveSelection = useCallback((
    drag: AudioRegionMoveDragState,
    clientX: number,
  ) => {
    const deltaX = clientX - drag.startClientX;
    const deltaTimelineSeconds = (deltaX / Math.max(1, drag.clipWidth)) * Math.max(0.001, drag.clipDuration);
    return moveTimelineAudioRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      selection: drag.initialSelection,
      deltaTimelineSeconds,
    });
  }, [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
  ]);

  const resolveAudioRegionResizeSelection = useCallback((
    drag: AudioRegionResizeDragState,
    clientX: number,
  ) => resizeTimelineAudioRegionSelection({
    clip: {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    },
    selection: drag.initialSelection,
    edge: drag.edge,
    focusTimelineTime: timelineTimeFromAudioRegionClientX(clientX, drag),
    snapThresholdSeconds: Math.min(0.035, Math.max(0.002, 7 / Math.max(1, zoom))),
  }), [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
    zoom,
  ]);

  const resolveSpectralRegionDragSelection = useCallback((
    drag: SpectralRegionDragState,
    clientX: number,
    clientY: number,
  ) => {
    const selectionClip = {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    };
    const focusTimelineTime = timelineTimeFromAudioRegionClientX(clientX, drag);
    const focusFrequencyHz = frequencyHzFromSpectralY(clientY - drag.rectTop, drag.rectHeight, drag.maxFrequencyHz);

    if (drag.mode === 'brush') {
      return resolveTimelineSpectralBrushSelection({
        clip: selectionClip,
        centerTimelineTime: focusTimelineTime,
        centerFrequencyHz: focusFrequencyHz,
        timeRadiusSeconds: drag.brushTimeRadiusSeconds ?? 0.08,
        frequencyRadiusHz: drag.brushFrequencyRadiusHz ?? drag.maxFrequencyHz * 0.04,
        maxFrequencyHz: drag.maxFrequencyHz,
      });
    }

    return resolveTimelineSpectralRegionSelection({
      clip: selectionClip,
      anchorTimelineTime: drag.anchorTimelineTime,
      focusTimelineTime,
      anchorFrequencyHz: drag.anchorFrequencyHz,
      focusFrequencyHz,
      maxFrequencyHz: drag.maxFrequencyHz,
    });
  }, [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
  ]);

  const handleAudioRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || e.button !== 0 || !isAudioRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const drag: AudioRegionDragState = {
      anchorTimelineTime: timelineTimeFromAudioRegionClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      startClientX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
    };

    setAudioRegionDrag(drag);
    setAudioRegionSelection(resolveAudioRegionDragSelection(drag, e.clientX));
  };
  const handleAudioRegionDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    setAudioRegionSelection(resolveTimelineAudioRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      anchorTimelineTime: displayStartTime,
      focusTimelineTime: displayStartTime + Math.max(0.001, displayDuration),
      snapThresholdSeconds: 0,
    }));
  };

  const handleVideoBakeRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectVideoBakeRegion || e.button !== 0 || !isVideoBakeRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const drag: VideoBakeRegionDragState = {
      anchorTimelineTime: timelineTimeFromVideoBakeClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      startClientX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
    };

    setVideoBakeRegionDrag(drag);
    setVideoBakeRegionSelection(resolveVideoBakeRegionDragSelection(drag, e.clientX));
  };

  const handleVideoBakeRegionDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectVideoBakeRegion || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    addClipVideoBakeRegion(clip.id, {
      trackId: track.id,
      startTime: displayStartTime,
      endTime: displayStartTime + Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration),
      sourceInPoint: displayInPoint,
      sourceOutPoint: displayOutPoint,
    });
  };

  const handleAudioRegionSelectionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || !audioRegionSelection || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    setAudioRegionMoveDrag({
      startClientX: e.clientX,
      clipWidth: Math.max(1, width),
      clipDuration: Math.max(0.001, displayDuration),
      initialSelection: audioRegionSelection,
      operationIds: getMatchingAudioRegionOperationIds(audioRegionSelection),
    });
  };

  const handleAudioRegionEdgeMouseDown = useCallback((
    edge: AudioRegionResizeDragState['edge'],
  ) => (e: React.MouseEvent<HTMLSpanElement>) => {
    if (!canSelectAudioRegion || !audioRegionSelection || e.button !== 0) return;
    const clipElement = e.currentTarget.closest('.timeline-clip');
    if (!clipElement) return;

    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    const rect = clipElement.getBoundingClientRect();
    setAudioRegionResizeDrag({
      edge,
      rectLeft: rect.left,
      rectWidth: Math.max(1, rect.width),
      initialSelection: audioRegionSelection,
      operationIds: getMatchingAudioRegionOperationIds(audioRegionSelection),
    });
  }, [
    audioRegionSelection,
    canSelectAudioRegion,
    getMatchingAudioRegionOperationIds,
    setAudioRegionContextMenu,
  ]);

  const handleSpectralRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion || e.button !== 0 || !isAudioRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const brushMode = e.shiftKey || e.altKey;
    const drag: SpectralRegionDragState = {
      anchorTimelineTime: timelineTimeFromAudioRegionClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      anchorFrequencyHz: frequencyHzFromSpectralY(e.clientY - rect.top, rect.height, spectralMaxFrequencyHz),
      startClientX: e.clientX,
      startClientY: e.clientY,
      rectLeft: rect.left,
      rectWidth: rect.width,
      rectTop: rect.top,
      rectHeight: rect.height,
      maxFrequencyHz: spectralMaxFrequencyHz,
      mode: brushMode ? 'brush' : 'rectangle',
      brushTimeRadiusSeconds: brushMode ? Math.max(0.025, Math.min(0.5, 18 / Math.max(1, zoom))) : undefined,
      brushFrequencyRadiusHz: brushMode ? Math.max(80, spectralMaxFrequencyHz * 0.045) : undefined,
    };

    setSpectralRegionDrag(drag);
    setAudioSpectralRegionSelection(resolveSpectralRegionDragSelection(drag, e.clientX, e.clientY));
  };

  useEffect(() => {
    if (!audioRegionDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isAudioRegionModifierPressed(e)) {
        setAudioRegionDrag(null);
        return;
      }
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionDragSelection(audioRegionDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (Math.abs(e.clientX - audioRegionDrag.startClientX) < 3) {
        clearAudioRegionSelection();
      }
      setAudioRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionDrag,
    canSelectAudioRegion,
    clearAudioRegionSelection,
    resolveAudioRegionDragSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!videoBakeRegionDrag || !canSelectVideoBakeRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isVideoBakeRegionModifierPressed(e)) {
        setVideoBakeRegionDrag(null);
        clearVideoBakeRegionSelection();
        return;
      }
      e.preventDefault();
      setVideoBakeRegionSelection(resolveVideoBakeRegionDragSelection(videoBakeRegionDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const draggedFarEnough = Math.abs(e.clientX - videoBakeRegionDrag.startClientX) >= 3;
      if (draggedFarEnough) {
        const selection = resolveVideoBakeRegionDragSelection(videoBakeRegionDrag, e.clientX);
        addClipVideoBakeRegion(clip.id, selection);
      } else {
        clearVideoBakeRegionSelection();
      }
      setVideoBakeRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    addClipVideoBakeRegion,
    canSelectVideoBakeRegion,
    clearVideoBakeRegionSelection,
    clip.id,
    resolveVideoBakeRegionDragSelection,
    setVideoBakeRegionSelection,
    videoBakeRegionDrag,
  ]);

  useEffect(() => {
    if (!audioRegionMoveDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionMoveSelection(audioRegionMoveDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const nextSelection = resolveAudioRegionMoveSelection(audioRegionMoveDrag, e.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(
        audioRegionMoveDrag.operationIds,
        nextSelection,
        'Move audio region edit',
      );
      setAudioRegionMoveDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionMoveDrag,
    canSelectAudioRegion,
    commitAudioRegionOperationRange,
    resolveAudioRegionMoveSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!audioRegionResizeDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionResizeSelection(audioRegionResizeDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const nextSelection = resolveAudioRegionResizeSelection(audioRegionResizeDrag, e.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(
        audioRegionResizeDrag.operationIds,
        nextSelection,
        'Resize audio region edit',
      );
      setAudioRegionResizeDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionResizeDrag,
    canSelectAudioRegion,
    commitAudioRegionOperationRange,
    resolveAudioRegionResizeSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!audioRegionSelection) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.clip-audio-region-selection')) return;
      if (target.closest('.clip-audio-region-context-menu')) return;
      if (target.closest('.clip-audio-edit-operation-overlay')) return;

      setAudioRegionContextMenu(null);
      clearAudioRegionSelection();
    };

    document.addEventListener('mousedown', handleDocumentMouseDown, true);

    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
    };
  }, [audioRegionSelection, clearAudioRegionSelection]);

  useEffect(() => {
    if (!spectralRegionDrag || !canSelectSpectralRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isAudioRegionModifierPressed(e)) {
        setSpectralRegionDrag(null);
        return;
      }
      e.preventDefault();
      setAudioSpectralRegionSelection(resolveSpectralRegionDragSelection(spectralRegionDrag, e.clientX, e.clientY));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (
        spectralRegionDrag.mode !== 'brush' &&
        Math.abs(e.clientX - spectralRegionDrag.startClientX) < 3 &&
        Math.abs(e.clientY - spectralRegionDrag.startClientY) < 3
      ) {
        clearAudioSpectralRegionSelection();
      }
      setSpectralRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canSelectSpectralRegion,
    clearAudioSpectralRegionSelection,
    resolveSpectralRegionDragSelection,
    setAudioSpectralRegionSelection,
    spectralRegionDrag,
  ]);

  // Determine clip type class (audio, video, text, or image)
  const clipTypeClass = isSolidClip ? 'solid' : isMathSceneClip ? 'math-scene' : (isTextClip || isText3DClip) ? 'text' : isCameraClip ? 'camera' : isSplatEffectorClip ? 'splat-effector' : isAudioClip ? 'audio' : (clip.source?.type || 'video');

  // Check if this clip is part of a multi-select drag
  const isInMultiSelectDrag = clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined;
  const isClipBodyDragging = isDragging || isLinkedToDragging || isInMultiSelectDrag;
  const showFocusCollisionHighlight = trackFocusMode !== 'balanced' && !!clipDrag?.overlapClipIds?.length;
  const isOverlapCollisionTarget = showFocusCollisionHighlight && !!clipDrag?.overlapClipIds?.includes(clip.id);
  const isOverlapCollisionSource = showFocusCollisionHighlight && isClipBodyDragging;
  const isTrackLocked = track.locked === true;
  const canHandleTimelineToolPointer = !isClipDragActive && !isTrackLocked && !isClipBodyDragging;
  const trackTypeIndex = useMemo(
    () => tracks.filter(candidate => candidate.type === track.type).findIndex(candidate => candidate.id === track.id),
    [track.id, track.type, tracks],
  );
  const trackColor = timelineTrackColorsVisible ? getTimelineTrackColor(track, trackTypeIndex) : TIMELINE_TRACK_COLOR_HIDDEN;

  const clipClass = [
    'timeline-clip',
    isSelected ? 'selected' : '',
    isInLinkedGroup ? 'linked-group' : '',
    isDragging ? 'dragging' : '',
    clipDrag?.toolGesture === 'slip' && (isDragging || isLinkedToDragging) ? 'slipping' : '',
    clipDrag?.toolGesture === 'slide' && (isDragging || isLinkedToDragging) ? 'sliding' : '',
    isInMultiSelectDrag ? 'dragging multiselect-dragging' : '',
    isLinkedToDragging ? 'linked-dragging' : '',
    isTrimming ? 'trimming' : '',
    isLinkedToTrimming ? 'linked-trimming' : '',
    isFading ? 'fading' : '',
    isDragging && clipDrag?.forcingOverlap ? 'forcing-overlap' : '',
    isOverlapCollisionSource ? 'overlap-collision-source' : '',
    isOverlapCollisionTarget ? 'overlap-collision-target' : '',
    clipTypeClass,
    isAudioClip ? `audio-mode-${audioDisplayMode}` : '',
    isAudioClip && audioFocusMode ? 'audio-focus-active' : '',
    audioRegionSelection ? 'audio-region-selected' : '',
    audioSpectralRegionSelection ? 'spectral-region-selected' : '',
    videoBakeRegionSelection ? 'video-bake-region-selected' : '',
    clip.videoState?.bakeRegions?.length ? 'has-video-bake-regions' : '',
    clip.isLoading ? 'loading' : '',
    clip.needsReload ? 'needs-reload' : '',
    hasProxy ? 'has-proxy' : '',
    isGeneratingProxy ? 'generating-proxy' : '',
    hasProxyError ? 'proxy-error' : '',
    hasAudioProxy ? 'has-audio-proxy' : '',
    isGeneratingAudioProxy ? 'generating-audio-proxy' : '',
    hasAudioProxyError ? 'audio-proxy-error' : '',
    activeStemSeparationJob ? 'separating-stems' : '',
    hasKeyframes(clip.id) ? 'has-keyframes' : '',
    clip.reversed ? 'reversed' : '',
    clip.transcriptStatus === 'ready' ? 'has-transcript' : '',
    showWaveformGenerationIndicator ? 'generating-waveform' : '',
    waveformProcessingState,
    spectrogramProcessingState,
    audioDisplayMode === 'spectral' ? '' : (processedWaveformStatus?.className ?? ''),
    audioDisplayMode === 'spectral' ? (processedSpectrogramStatus?.className ?? '') : '',
    ...(audioWaveformDiagnostics?.classNames ?? []),
    clip.parentClipId ? 'has-parent' : '',
    clip.isPendingDownload ? 'pending-download' : '',
    clip.downloadError ? 'download-error' : '',
    clip.isComposition ? 'composition' : '',
    aiMovePhase !== 'idle' ? 'ai-moving' : '',
    isTrackLocked ? 'track-locked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const clearStemMenuCloseTimer = useCallback(() => {
    if (stemMenuCloseTimerRef.current === null) return;
    window.clearTimeout(stemMenuCloseTimerRef.current);
    stemMenuCloseTimerRef.current = null;
  }, []);

  const prewarmCompletedStemSources = useCallback(() => {
    if (!hasCompletedStemChoices) return;
    const mediaFileIds = completedStemChoices.map(stem => stem.mediaFileId);
    if (stemSourceMediaFileId) {
      mediaFileIds.unshift(stemSourceMediaFileId);
    }
    prewarmStemSourceMediaFiles(mediaFileIds);
  }, [completedStemChoices, hasCompletedStemChoices, prewarmStemSourceMediaFiles, stemSourceMediaFileId]);

  useEffect(() => clearStemMenuCloseTimer, [clearStemMenuCloseTimer]);

  const handleStemControlMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleStemBadgeClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    clearStemMenuCloseTimer();
    if (!hasCompletedStemChoices) return;
    setStemMenuOpen(open => {
      const nextOpen = !open;
      if (nextOpen) {
        prewarmCompletedStemSources();
      }
      return nextOpen;
    });
  }, [clearStemMenuCloseTimer, hasCompletedStemChoices, prewarmCompletedStemSources]);

  const handleStemChoiceClick = useCallback((stemMediaFileId: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setClipSourceToStem(clip.id, stemMediaFileId);
  }, [clip.id, setClipSourceToStem]);

  const handleStemSwitcherMouseEnter = useCallback(() => {
    clearStemMenuCloseTimer();
    prewarmCompletedStemSources();
  }, [clearStemMenuCloseTimer, prewarmCompletedStemSources]);

  const handleStemSwitcherMouseLeave = useCallback(() => {
    if (!stemMenuOpen) return;
    clearStemMenuCloseTimer();
    stemMenuCloseTimerRef.current = window.setTimeout(() => {
      setStemMenuOpen(false);
      stemMenuCloseTimerRef.current = null;
    }, 320);
  }, [clearStemMenuCloseTimer, stemMenuOpen]);

  const getClipPointerContext = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      toolId: activeTimelineToolId,
      clip,
      track,
      clips,
      playheadPosition,
      snappingEnabled,
      displayStartTime,
      displayDuration,
      width,
      clientX: e.clientX,
      rectLeft: rect.left,
      altKey: e.altKey,
    };
  };

  // Timeline tool pointer handlers
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!canHandleTimelineToolPointer) return;

    const result = dispatchTimelineClipPointerMove(getClipPointerContext(e));
    if (!result.handled) {
      if (timelineToolPreview?.clipId === clip.id) setTimelineToolPreview(null);
      return;
    }
    setTimelineToolPreview(result.preview ?? null);
  };

  const handleMouseLeave = () => {
    if (!canHandleTimelineToolPointer) return;

    if (timelineToolPreview?.clipId === clip.id) setTimelineToolPreview(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    const result = dispatchTimelineClipPointerClick(getClipPointerContext(e));
    if (!result.handled) return;
    e.preventDefault();
    e.stopPropagation();

    if (result.operation) {
      applyTimelineEditOperation(result.operation, {
        source: 'ui',
      historyLabel: result.operation.type === 'select-clips-from-time'
        ? 'Track select'
        : result.operation.type === 'split-all-at-time'
          ? 'Blade all tracks'
          : 'Blade clip',
      });
    }
    if (result.nextToolId) setActiveTimelineTool(result.nextToolId);
    setTimelineToolPreview(null);
  };

  // Calculate cut indicator position for this clip
  const cutIndicatorX = shouldShowCutIndicator && timelineToolPreview?.time !== undefined
    ? ((timelineToolPreview.time - displayStartTime) / displayDuration) * width
    : null;
  const audioRegionOverlay = resolveAudioRegionOverlay({
    selection: audioRegionSelection,
    displayStartTime,
    displayDuration,
    width,
  });
  const selectedAudioRegionGainOperation = useMemo(() => {
    if (!audioRegionSelection) return null;
    const start = Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const end = Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);

    for (let index = displayAudioEditStack.length - 1; index >= 0; index -= 1) {
      const operation = displayAudioEditStack[index];
      if (
        operation?.type === 'gain' &&
        operation.enabled !== false &&
        operation.timeRange &&
        Math.abs(Math.min(operation.timeRange.start, operation.timeRange.end) - start) <= 0.001 &&
        Math.abs(Math.max(operation.timeRange.start, operation.timeRange.end) - end) <= 0.001
      ) {
        return operation;
      }
    }

    return null;
  }, [displayAudioEditStack, audioRegionSelection]);
  const audioRegionGainControl = audioRegionOverlay
    ? resolveAudioRegionGainControl({
        selection: audioRegionSelection,
        overlayWidth: audioRegionOverlay.width,
        selectedOperation: selectedAudioRegionGainOperation,
        dragState: audioRegionGainDrag,
      })
    : null;
  const commitAudioRegionGainEdit = useCallback((input: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    setAudioRegionGainEdit({
      gainDb: input.gainDb,
      fadeInSeconds: input.fadeInSeconds,
      fadeOutSeconds: input.fadeOutSeconds,
      keepSelection: true,
    });
  }, [setAudioRegionGainEdit]);
  const publishAudioRegionGainPreview = useCallback((input: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    if (!audioRegionSelection) return;
    setAudioRegionGainPreview({
      clipId: clip.id,
      trackId: audioRegionSelection.trackId,
      startTime: audioRegionSelection.startTime,
      endTime: audioRegionSelection.endTime,
      sourceInPoint: audioRegionSelection.sourceInPoint,
      sourceOutPoint: audioRegionSelection.sourceOutPoint,
      gainDb: input.gainDb,
      fadeInSeconds: input.fadeInSeconds,
      fadeOutSeconds: input.fadeOutSeconds,
    });
  }, [audioRegionSelection, clip.id, setAudioRegionGainPreview]);
  const handleAudioRegionGainMouseDown = useCallback((
    mode: AudioRegionGainDragState['mode'],
  ) => (e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!audioRegionGainControl) return;
    const regionElement = e.currentTarget.closest('.clip-audio-region-selection');
    if (!regionElement) return;

    e.preventDefault();
    e.stopPropagation();
    const rect = regionElement.getBoundingClientRect();
    const startGainDb = mode === 'gain'
      ? Number(audioRegionGainDbFromClientY(e.clientY, rect).toFixed(1))
      : audioRegionGainControl.gainDb;
    publishAudioRegionGainPreview({
      gainDb: startGainDb,
      fadeInSeconds: audioRegionGainControl.fadeInSeconds,
      fadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
    });

    setAudioRegionGainDrag({
      mode,
      regionLeft: rect.left,
      regionWidth: rect.width,
      regionTop: rect.top,
      regionHeight: rect.height,
      regionDuration: audioRegionGainControl.regionDuration,
      startGainDb,
      startFadeInSeconds: audioRegionGainControl.fadeInSeconds,
      startFadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
      currentGainDb: startGainDb,
      currentFadeInSeconds: audioRegionGainControl.fadeInSeconds,
      currentFadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
    });
  }, [audioRegionGainControl, publishAudioRegionGainPreview]);
  const handleAudioRegionContextMenu = useCallback((e: React.MouseEvent) => {
    if (!audioRegionSelection) return;
    e.preventDefault();
    e.stopPropagation();
    const expectedExpandedHeight = 340;
    const y = typeof window === 'undefined'
      ? e.clientY
      : Math.min(
          e.clientY,
          Math.max(8, window.innerHeight - expectedExpandedHeight - 8),
        );
    audioRegionCommandHandledRef.current = false;
    setAudioRegionContextMenu({ x: e.clientX, y, selection: audioRegionSelection });
  }, [audioRegionSelection, setAudioRegionContextMenu]);
  const closeAudioRegionContextMenu = useCallback(() => {
    setAudioRegionContextMenu(null);
  }, [setAudioRegionContextMenu]);
  useEffect(() => {
    if (!audioRegionGainDrag) return;

    const getNextDragState = (e: MouseEvent): AudioRegionGainDragState => {
      if (audioRegionGainDrag.mode === 'gain') {
        return {
          ...audioRegionGainDrag,
          currentGainDb: Number(audioRegionGainDbFromClientY(e.clientY, {
            top: audioRegionGainDrag.regionTop,
            height: audioRegionGainDrag.regionHeight,
          }).toFixed(1)),
        };
      }

      const localX = Math.max(0, Math.min(audioRegionGainDrag.regionWidth, e.clientX - audioRegionGainDrag.regionLeft));
      const secondsAtPointer = (localX / Math.max(1, audioRegionGainDrag.regionWidth)) * audioRegionGainDrag.regionDuration;
      const maxFadeSeconds = audioRegionGainDrag.regionDuration / 2;

      return {
        ...audioRegionGainDrag,
        currentFadeInSeconds: audioRegionGainDrag.mode === 'fade-in'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, secondsAtPointer)).toFixed(4))
          : audioRegionGainDrag.currentFadeInSeconds,
        currentFadeOutSeconds: audioRegionGainDrag.mode === 'fade-out'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, audioRegionGainDrag.regionDuration - secondsAtPointer)).toFixed(4))
          : audioRegionGainDrag.currentFadeOutSeconds,
      };
    };

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const next = getNextDragState(e);
      publishAudioRegionGainPreview({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      setAudioRegionGainDrag(next);
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const next = getNextDragState(e);
      commitAudioRegionGainEdit({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      clearAudioRegionGainPreview();
      setAudioRegionGainDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [audioRegionGainDrag, clearAudioRegionGainPreview, commitAudioRegionGainEdit, publishAudioRegionGainPreview]);

  useEffect(() => () => {
    const preview = useTimelineStore.getState().audioRegionGainPreview;
    if (preview?.clipId === clip.id) {
      useTimelineStore.getState().clearAudioRegionGainPreview();
    }
  }, [clip.id]);

  useEffect(() => {
    if (!audioRegionContextMenu) return;

    const handlePointerDown = () => closeAudioRegionContextMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAudioRegionContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [audioRegionContextMenu, closeAudioRegionContextMenu]);
  const spectralRegionOverlay = resolveSpectralRegionOverlay({
    selection: audioSpectralRegionSelection,
    displayStartTime,
    displayDuration,
    width,
    trackBaseHeight,
    maxFrequencyHz: spectralMaxFrequencyHz,
  });
  const sourceTimeToDisplayTimelineTime = useCallback((sourceTime: number): number => {
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + 0.001, displayOutPoint ?? sourceStart + displayDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
    return displayStartTime + timelineRatio * displayDuration;
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);
  const spectralImageLayerOverlays = useMemo(() => resolveSpectralImageLayerOverlays({
    enabled: canSelectSpectralRegion || audioDisplayMode === 'spectral',
    layers: clip.audioState?.spectralLayers ?? [],
    displayStartTime,
    displayDuration,
    width,
    trackBaseHeight,
    maxFrequencyHz: spectralMaxFrequencyHz,
    sourceTimeToDisplayTimelineTime,
    mediaFilesById: spectralImageFilesById,
  }), [
    audioDisplayMode,
    canSelectSpectralRegion,
    clip.audioState?.spectralLayers,
    displayDuration,
    displayStartTime,
    sourceTimeToDisplayTimelineTime,
    spectralImageFilesById,
    spectralMaxFrequencyHz,
    trackBaseHeight,
    width,
  ]);
  const audioEditOperationOverlays = useMemo<AudioEditOperationOverlay[]>(() => {
    if (!isAudioClip || !audioFocusMode || !showAudioRegionEditMarkers || displayAudioEditStack.length === 0) {
      return [];
    }

    return resolveAudioEditOperationOverlays({
      operations: displayAudioEditStack,
      audioRegionSelection,
      clipId: clip.id,
      trackId: clip.trackId,
      displayStartTime,
      displayDuration,
      width,
      trackBaseHeight,
      sourceTimeToDisplayTimelineTime,
    });
  }, [
    audioRegionSelection,
    clip.id,
    clip.trackId,
    displayAudioEditStack,
    audioFocusMode,
    displayDuration,
    displayStartTime,
    isAudioClip,
    showAudioRegionEditMarkers,
    sourceTimeToDisplayTimelineTime,
    trackBaseHeight,
    width,
  ]);
  const clipVideoBakeRegionOverlays = useMemo<ClipVideoBakeRegionOverlay[]>(() => (
    resolveClipVideoBakeRegionOverlays({
      isAudioClip,
      bakeRegions: clip.videoState?.bakeRegions,
      selection: videoBakeRegionSelection,
      displayStartTime,
      displayDuration,
      width,
      sourceTimeToVideoBakeTimelineTime,
    })
  ), [
    clip.videoState?.bakeRegions,
    displayDuration,
    displayStartTime,
    isAudioClip,
    sourceTimeToVideoBakeTimelineTime,
    videoBakeRegionSelection,
    width,
  ]);
  const handleAudioEditOperationOverlayMouseDown = useCallback((
    overlay: AudioEditOperationOverlay,
  ) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    setAudioRegionSelection(overlay.selection);
  }, [setAudioRegionContextMenu, setAudioRegionSelection]);
  const handleApplySpectralRegionEdit = (type: TimelineSpectralRegionEditType) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    applySpectralRegionEdit(type);
  };
  const addSpectralImageLayerFromSelection = useCallback((imageMediaFileId: string) => {
    if (!audioSpectralRegionSelection) return null;
    const start = Math.min(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint);
    const end = Math.max(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint);
    if (end - start <= 0.0005) return null;

    return addClipSpectralImageLayer(clip.id, {
      imageMediaFileId,
      timeStart: start,
      duration: end - start,
      frequencyMin: audioSpectralRegionSelection.frequencyMinHz,
      frequencyMax: audioSpectralRegionSelection.frequencyMaxHz,
      opacity: 0.85,
      blendMode: 'attenuate',
      gainDb: -18,
      featherTime: 0.02,
      featherFrequency: 80,
    });
  }, [addClipSpectralImageLayer, audioSpectralRegionSelection, clip.id]);
  const handleAddSelectedImageSpectralLayer = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedSpectralImageFile) return;
    addSpectralImageLayerFromSelection(selectedSpectralImageFile.id);
  };
  const getDroppedImageMediaFileId = (dataTransfer: DataTransfer): string | null => {
    const mediaFileId = dataTransfer.getData('application/x-media-file-id');
    if (!mediaFileId) return null;
    const file = useMediaStore.getState().files.find(candidate => candidate.id === mediaFileId);
    return file?.type === 'image' ? file.id : null;
  };
  const handleSpectralImageLayerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion || !getDroppedImageMediaFileId(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleSpectralImageLayerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion) return;
    const imageMediaFileId = getDroppedImageMediaFileId(e.dataTransfer);
    if (!imageMediaFileId) return;

    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const centerTime = timelineTimeFromAudioRegionClientX(e.clientX, {
      rectLeft: rect.left,
      rectWidth: rect.width,
    });
    const layerDuration = Math.max(0.15, Math.min(displayDuration, Math.max(0.65, 160 / Math.max(1, zoom))));
    const centerFrequency = frequencyHzFromSpectralY(e.clientY - rect.top, rect.height, spectralMaxFrequencyHz);
    const frequencySpan = Math.max(120, spectralMaxFrequencyHz * 0.16);
    const selection = resolveTimelineSpectralRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      anchorTimelineTime: centerTime - layerDuration / 2,
      focusTimelineTime: centerTime + layerDuration / 2,
      anchorFrequencyHz: centerFrequency - frequencySpan / 2,
      focusFrequencyHz: centerFrequency + frequencySpan / 2,
      maxFrequencyHz: spectralMaxFrequencyHz,
    });

    addClipSpectralImageLayer(clip.id, {
      imageMediaFileId,
      timeStart: selection.sourceInPoint,
      duration: Math.max(0.001, selection.sourceOutPoint - selection.sourceInPoint),
      frequencyMin: selection.frequencyMinHz,
      frequencyMax: selection.frequencyMaxHz,
      opacity: 0.85,
      blendMode: 'attenuate',
      gainDb: -18,
      featherTime: 0.02,
      featherFrequency: 80,
    });
    setAudioSpectralRegionSelection(selection);
  };
  const handleAudioEditStackMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleBakeAudioEditStack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioBakePending) return;
    setAudioBakePending(true);
    void bakeClipAudioEditStack(clip.id).finally(() => {
      setAudioBakePending(false);
    });
  };
  const handleUnbakeAudioEditStack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioBakePending || !canUnbakeAudioEditStack) return;
    unbakeClipAudioEditStack(clip.id);
  };
  const handleClearAudioEditStack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearClipAudioEditStack(clip.id);
  };
  const handleSplitAudioRegionAtSelection = (selectionSnapshot?: TimelineAudioRegionSelection | null) => {
    const store = useTimelineStore.getState();
    const selection = selectionSnapshot?.clipId === clip.id
      ? selectionSnapshot
      : store.audioRegionSelection?.clipId === clip.id
      ? store.audioRegionSelection
      : audioRegionSelection;
    const currentClip = store.clips.find(candidate => candidate.id === clip.id) ?? clip;
    if (!selection) {
      log.warn('Cannot split audio region without an active selection', { clipId: clip.id });
      return;
    }

    const range = resolveAudioRegionTimelineRangeForClip(currentClip, selection);
    if (!range) {
      log.warn('Cannot split audio region outside clip bounds', { clipId: clip.id, selection });
      return;
    }

    const clipStart = currentClip.startTime;
    const clipEnd = currentClip.startTime + Math.max(AUDIO_REGION_TIMELINE_EPSILON, currentClip.duration);
    const splitTimes = [range.start, range.end].filter(time =>
      time > clipStart + AUDIO_REGION_TIMELINE_EPSILON &&
      time < clipEnd - AUDIO_REGION_TIMELINE_EPSILON
    );
    const result = splitTimes.length > 0
      ? applyTimelineEditOperation({
        id: `split-audio-region:${clip.id}:${range.start}:${range.end}`,
        type: 'split-at-times',
        clipId: currentClip.id,
        times: splitTimes,
        includeLinked: false,
      }, {
        source: 'context-menu',
        historyLabel: 'Split audio region',
      })
      : { success: true };

    if (result.success) {
      const middleClip = useTimelineStore.getState().clips.find(candidate =>
        candidate.trackId === currentClip.trackId &&
        Math.abs(candidate.startTime - range.start) <= AUDIO_REGION_TIMELINE_EPSILON &&
        Math.abs(candidate.duration - range.duration) <= AUDIO_REGION_TIMELINE_EPSILON
      );
      if (middleClip) {
        selectClip(middleClip.id);
      }
    } else {
      log.warn('Split audio region operation failed', { clipId: currentClip.id, range, result });
    }
    clearAudioRegionSelection();
  };
  const handleCutAudioRegion = (selectionSnapshot?: TimelineAudioRegionSelection | null) => {
    const store = useTimelineStore.getState();
    const selection = selectionSnapshot?.clipId === clip.id
      ? selectionSnapshot
      : store.audioRegionSelection?.clipId === clip.id
      ? store.audioRegionSelection
      : audioRegionSelection;
    const currentClip = store.clips.find(candidate => candidate.id === clip.id) ?? clip;
    if (!selection) {
      log.warn('Cannot cut audio region without an active selection', { clipId: clip.id });
      return;
    }

    const range = resolveAudioRegionTimelineRangeForClip(currentClip, selection);
    if (!range) {
      log.warn('Cannot cut audio region outside clip bounds', { clipId: clip.id, selection });
      return;
    }

    if (store.audioRegionSelection?.clipId !== currentClip.id) {
      setAudioRegionSelection(selection);
    }
    copySelectedAudioRegion();
    const result = applyTimelineEditOperation({
      id: `cut-audio-region:${clip.id}:${range.start}:${range.end}`,
      type: 'lift-range',
      range: {
        startTime: range.start,
        endTime: range.end,
        trackIds: [currentClip.trackId],
      },
      includeLinked: false,
    }, {
      source: 'context-menu',
      historyLabel: 'Cut audio region',
    });
    if (result.success) {
      clearAudioRegionSelection();
    } else {
      log.warn('Cut audio region operation failed', { clipId: currentClip.id, range, result });
    }
  };
  const contextMenuAudioRegionSelection = audioRegionContextMenu?.selection ?? audioRegionSelection;
  const audioRegionContextMenuModel = createAudioRegionContextMenuModel({
    hasAudioRegionClipboard,
    onSplit: () => handleSplitAudioRegionAtSelection(contextMenuAudioRegionSelection),
    onCut: () => handleCutAudioRegion(contextMenuAudioRegionSelection),
    onCopy: copySelectedAudioRegion,
    onPaste: pasteAudioRegionToSelection,
    applyAudioRegionEdit,
  });
  const audioRegionDirectMenuCommands = audioRegionContextMenuModel.directCommands;
  const audioRegionContextMenuGroups = audioRegionContextMenuModel.groups;
  const runAudioRegionContextMenuCommand = (
    command: AudioRegionContextMenuCommand,
    selection: TimelineAudioRegionSelection,
  ) => {
    if (audioRegionCommandHandledRef.current) return;
    if (command.disabled) return;
    audioRegionCommandHandledRef.current = true;
    log.info('Audio region context command', {
      command: command.key,
      clipId: clip.id,
      selection,
    });
    setAudioRegionSelection(selection);
    command.action();
    closeAudioRegionContextMenu();
  };

  // Track filtering must stay after all hooks so React sees a stable hook order
  // while clips move between tracks during drag and linked edits.
  if (isDragging && clipDrag && clipDrag.currentTrackId !== trackId) {
    return null;
  }
  if (!isDragging && !isLinkedToDragging && clip.trackId !== trackId) {
    return null;
  }
  if (clip.trackId !== trackId && !isDragging) {
    return null;
  }
  const clipStyle = {
    left,
    width,
    cursor: isTrackLocked ? 'not-allowed' : timelineToolCursor,
    animationDelay: `${animationDelay}s`,
    '--track-color': trackColor,
    '--clip-right-sticky-offset': `${clipRightStickyOffset}px`,
    // FLIP move animation: initial phase applies offset transform, animating phase transitions to 0
    ...(aiMovePhase === 'initial' && aiMove ? {
      transform: `translateX(${timeToPixel(aiMove.fromStartTime) - left}px)`,
    } : aiMovePhase === 'animating' && aiMove ? {
      transform: 'translateX(0)',
      transition: `transform ${aiMove.animationDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
    } : {}),
    ...(isAudioClip && audioFocusMode ? {
      background: `linear-gradient(180deg, color-mix(in srgb, ${trackColor} 72%, #202020), color-mix(in srgb, ${trackColor} 34%, #101010))`,
      borderColor: trackColor,
    } : isSolidClip && clip.solidColor ? {
      background: clip.solidColor,
      borderColor: clip.solidColor,
    } : mediaLabelHex ? {
      background: mediaLabelHex,
      borderColor: mediaLabelHex,
    } : {}),
  } as CSSProperties & {
    '--track-color'?: string;
    '--clip-right-sticky-offset'?: string;
  };
  const audioRegionContextMenuPortalTarget = typeof document === 'undefined'
    ? null
    : document.body;
  const sourceExtensionGhosts = resolveSourceExtensionGhosts({
    enabled: passiveDecorationsEnabled,
    isTrimming,
    isLinkedToTrimming,
    trimEdge: clipTrim?.edge,
    clipWidth: width,
    clipLeft: left,
    clipStartTime: clip.startTime,
    clipDuration: clip.duration,
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    sourceDuration: getClipSourceDuration(clip),
    scrollX,
    viewportWidth: renderTimelineViewportWidth,
    overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
    timeToPixel,
  });

  return (
    <div
      className={`${clipClass}${isBladeToolActive ? ' cut-mode' : ''} ${animationClass}`}
      style={clipStyle}
      data-clip-id={clip.id}
      data-dock-layout-child-anim-id={`timeline-clip:${clip.id}`}
      onMouseDown={(e) => {
        if (e.button === 2) {
          onMouseDown(e);
          return;
        }
        if (isTrackLocked || (isPointerToolActive && !canUseBodyToolGesture)) return;
        onMouseDown(e);
      }}
      onDoubleClick={isPointerToolActive ? undefined : onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseMove={canHandleTimelineToolPointer ? handleMouseMove : undefined}
      onMouseLeave={canHandleTimelineToolPointer ? handleMouseLeave : undefined}
      onClick={isTrackLocked ? undefined : handleClick}
    >
      {/* Cut indicator line */}
      {shouldShowCutIndicator && cutIndicatorX !== null && cutIndicatorX >= 0 && cutIndicatorX <= width && (
        <div
          className="cut-indicator"
          style={{ left: cutIndicatorX }}
        />
      )}
      {passiveDecorationsEnabled && sourceExtensionGhosts.map((ghost) => (
        <div
          key={ghost.edge}
          className={`clip-source-extension-ghost ${ghost.edge}`}
          style={{ left: ghost.left, width: ghost.width }}
        />
      ))}
      {/* YouTube pending download preview */}
      {passiveDecorationsEnabled && clip.isPendingDownload && clip.youtubeThumbnail && (
        <div
          className="clip-youtube-preview"
          style={{ backgroundImage: `url(${clip.youtubeThumbnail})` }}
        />
      )}
      {/* Download progress bar */}
      {passiveDecorationsEnabled && clip.isPendingDownload && !clip.downloadError && (
        <>
          <div className="clip-download-progress">
            <div
              className="clip-download-progress-bar"
              style={{ width: `${clip.downloadProgress || 0}%` }}
            />
          </div>
          <div className="clip-download-status">
            <div className="download-spinner" />
            <span>Downloading {Math.round(clip.downloadProgress || 0)}%{clip.downloadSpeed ? ` \u00B7 ${clip.downloadSpeed}` : ''}</span>
          </div>
        </>
      )}
      {/* Download error badge */}
      {passiveDecorationsEnabled && clip.downloadError && (
        <div className="clip-download-error-badge" title={clip.downloadError}>
          Error
        </div>
      )}
      {/* Proxy generating indicator - fill badge */}
      {passiveDecorationsEnabled && isGeneratingProxy && (
        <div className="clip-proxy-generating" title={`Generating proxy: ${proxyProgress}%`}>
          <span className="proxy-fill-badge">
            <span className="proxy-fill-bg">P</span>
            <span
              className="proxy-fill-progress"
              style={{ height: `${proxyProgress}%` }}
            >P</span>
          </span>
          <span className="proxy-percent">{proxyProgress}%</span>
        </div>
      )}
      {passiveDecorationsEnabled && isGeneratingAudioProxy && (
        <div className="clip-audio-proxy-generating" title={`Preparing WAV audio proxy: ${audioProxyProgress}%`}>
          <span className="audio-proxy-fill-badge">
            <span className="audio-proxy-fill-bg">A</span>
            <span
              className="audio-proxy-fill-progress"
              style={{ height: `${audioProxyProgress}%` }}
            >A</span>
          </span>
          <span className="audio-proxy-percent">{audioProxyProgress}%</span>
        </div>
      )}
      {activeStemSeparationJob && (
        <div className="clip-stem-generating" title={activeStemStatusTitle}>
          <span className="stem-fill-badge">
            <span className="stem-fill-bg">S</span>
            <span
              className="stem-fill-progress"
              style={{ height: `${activeStemProgressPercent}%` }}
            >S</span>
          </span>
          <span className={isDownloadingStemModel ? 'stem-status-text' : 'stem-percent'}>
            {isDownloadingStemModel ? 'Downloading model' : `${activeStemProgressPercent}%`}
          </span>
        </div>
      )}
      {hasCompletedStemChoices && (
        <div
          className={`clip-stem-switcher ${stemMenuOpen ? 'open' : ''}`}
          onMouseEnter={handleStemSwitcherMouseEnter}
          onMouseLeave={handleStemSwitcherMouseLeave}
        >
          <button
            type="button"
            className="clip-stem-ready-badge"
            aria-label="Show separated stems"
            title="Separated stems ready"
            onMouseDown={handleStemControlMouseDown}
            onClick={handleStemBadgeClick}
          >
            S
          </button>
          {stemMenuOpen && (
            <div className="clip-stem-menu" role="menu" aria-label="Use stem source">
              {hasStemSourceChoice && stemSourceMediaFileId && (
                <button
                  type="button"
                  className={`clip-stem-choice-button source ${activeStemMediaFileId === stemSourceMediaFileId ? 'active' : ''}`}
                  role="menuitem"
                  aria-label="Use source audio"
                  title="Use source audio"
                  onMouseDown={handleStemControlMouseDown}
                  onClick={handleStemChoiceClick(stemSourceMediaFileId)}
                >
                  <IconFileMusic className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />
                </button>
              )}
              {completedStemChoices.map(stem => {
                const isActiveStemSource = activeStemMediaFileId === stem.mediaFileId;
                return (
                  <button
                    key={stem.id}
                    type="button"
                    className={`clip-stem-choice-button ${isActiveStemSource ? 'active' : ''}`}
                    role="menuitem"
                    aria-label={`Use ${stem.label} stem`}
                    title={`Use ${stem.label} stem as clip source`}
                    onMouseDown={handleStemControlMouseDown}
                    onClick={handleStemChoiceClick(stem.mediaFileId)}
                  >
                    <StemChoiceIcon kind={stem.kind} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {/* Proxy ready indicator */}
      {passiveDecorationsEnabled && hasProxy && proxyEnabled && !isGeneratingProxy && (
        <div className="clip-proxy-badge" title="Proxy ready">
          P
        </div>
      )}
      {passiveDecorationsEnabled && hasProxyError && (
        <div className="clip-proxy-error" title="Proxy generation failed">
          P!
        </div>
      )}
      {passiveDecorationsEnabled && hasAudioProxy && !isGeneratingAudioProxy && (
        <div className="clip-audio-proxy-badge" title="WAV audio proxy ready">
          A
        </div>
      )}
      {passiveDecorationsEnabled && hasAudioProxyError && (
        <div className="clip-audio-proxy-error" title="WAV audio proxy failed">
          A!
        </div>
      )}
      {/* Reversed indicator */}
      {passiveDecorationsEnabled && clip.reversed && (
        <div className="clip-reversed-badge" title="Reversed playback">
          {'\u27F2'}
        </div>
      )}
      {/* Linked group indicator */}
      {passiveDecorationsEnabled && isInLinkedGroup && (
        <div className="clip-linked-group-badge" title="Multicam linked group">
          {'\u26D3'}
        </div>
      )}
      {/* Transcript badge with coverage fill */}
      {passiveDecorationsEnabled && clip.transcriptStatus === 'ready' && clip.transcript && clip.transcript.length > 0 && (() => {
        const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
        const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
        const pct = resolveTranscriptCoveragePercent({
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          duration: clip.duration,
          transcript: clip.transcript,
          transcribedRanges: mediaFile?.transcribedRanges,
        });
        if (pct <= 0) return null;
        return pct >= 100 ? (
          <div className="clip-transcript-badge" title="Fully transcribed">T</div>
        ) : (
          <div className="clip-transcript-badge clip-badge-fill" title={`${pct}% transcribed`}>
            <span className="clip-badge-bg">T</span>
            <span className="clip-badge-progress clip-badge-transcript-fill" style={{ height: `${pct}%` }}>T</span>
          </div>
        );
      })()}
      {/* Analysis badge with coverage fill */}
      {passiveDecorationsEnabled && !isAudioClip && (clip.analysisStatus === 'ready' || clip.sceneDescriptionStatus === 'ready') && (() => {
        const pct = resolveAnalysisCoveragePercent({
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          duration: clip.duration,
          frames: clip.analysis?.frames,
          sampleIntervalMs: clip.analysis?.sampleInterval,
        });
        if (pct <= 0) return null;
        return pct >= 100 ? (
          <div className="clip-analysis-badge" title="Fully analyzed">A</div>
        ) : (
          <div className="clip-analysis-badge clip-badge-fill" title={`${pct}% analyzed`}>
            <span className="clip-badge-bg">A</span>
            <span className="clip-badge-progress clip-badge-analysis-fill" style={{ height: `${pct}%` }}>A</span>
          </div>
        );
      })()}
      {/* Waveform generation progress indicator */}
      {passiveDecorationsEnabled && showWaveformGenerationIndicator && (
        <div
          className="clip-waveform-indicator"
          title={clip.audioAnalysisJob ? `${clip.audioAnalysisJob.label}: ${clip.audioAnalysisJob.phase}` : undefined}
        >
          <div
            className="waveform-progress"
            style={{ width: `${clip.audioAnalysisJob?.progress ?? clip.waveformProgress ?? 50}%` }}
          />
        </div>
      )}
      {/* Audio waveform / spectrogram */}
      {passiveMediaEnabled && waveformsEnabled && isAudioClip && (
        audioDisplayMode === 'spectral'
        || hasWaveformForRender
      ) && (
        <div className="clip-waveform">
          {audioDisplayMode === 'spectral' && spectrogramTileSet ? (
            <ClipSpectrogram
              tileSet={spectrogramTileSet}
              width={width}
              height={Math.max(20, trackBaseHeight - 12)}
              inPoint={spectrogramInPoint}
              outPoint={spectrogramOutPoint}
              naturalDuration={spectrogramNaturalDuration}
              renderStartPx={waveformRenderWindow.startPx}
              renderWidth={waveformRenderWindow.width}
              variant={spectrogramVariant}
            />
          ) : audioDisplayMode === 'spectral' ? (
            <div className="spectrogram-pending" />
          ) : hasWaveformForRender ? (
            <ClipWaveform
              clipId={clip.id}
              waveform={waveformLegacyForRender}
              waveformChannels={waveformChannelsForRender}
              width={stableWaveformContentWidth}
              height={Math.max(20, trackBaseHeight - 12)}
              inPoint={stableWaveformContentInPoint}
              outPoint={stableWaveformContentOutPoint}
              naturalDuration={waveformNaturalDurationForRender}
              clipDuration={stableWaveformClipDuration}
              displayMode={audioDisplayMode}
              pixelsPerSecond={zoom}
              pyramid={waveformPyramidForRender}
              waveformVariant={waveformVariantForRender}
              displayGain={waveformDisplayGainForRender}
              volumeAutomationKeyframes={audioVolumeAutomationKeyframes}
              audioEditStack={predictiveAudioEditStack}
              audioRegionGainPreview={predictiveAudioRegionGainPreview}
              renderStartPx={stableWaveformRenderWindow.startPx}
              renderWidth={stableWaveformRenderWindow.width}
              contentOffsetPx={stableWaveformContentOffsetPx}
              normalizationInPoint={useStableWaveformTrimWindow ? originalWaveformTrimInPoint : undefined}
              normalizationOutPoint={useStableWaveformTrimWindow ? originalWaveformTrimOutPoint : undefined}
              normalizationWidth={useStableWaveformTrimWindow ? Math.max(1, (originalWaveformTrimOutPoint - originalWaveformTrimInPoint) / waveformSourceSecondsPerPixel) : undefined}
            />
          ) : null}
          {(audioAnalysisDisplayStatus || (audioWaveformDiagnostics?.badges.length ?? 0) > 0) && (
            <div className="clip-audio-status-stack">
              {audioAnalysisDisplayStatus && (
                <div
                  className={`clip-audio-analysis-status clip-audio-analysis-status-${audioAnalysisDisplayStatus.kind}`}
                  title={audioAnalysisDisplayStatus.title}
                  data-audio-analysis-status={audioAnalysisDisplayStatus.kind}
                >
                  {audioAnalysisDisplayStatus.label}
                </div>
              )}
              {audioWaveformDiagnostics?.badges.map((badge) => (
                <div
                  key={badge.kind}
                  className={`clip-audio-diagnostic-badge ${badge.className}`}
                  title={badge.title}
                  data-audio-diagnostic={badge.kind}
                  data-audio-diagnostic-source={audioWaveformDiagnostics.source}
                >
                  {badge.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {audioRegionOverlay && (
        <div
          className={`clip-audio-region-selection ${audioRegionSelection?.snappedToZeroCrossing ? 'snapped' : ''} ${audioRegionMoveDrag ? 'moving' : ''} ${audioRegionResizeDrag ? 'resizing' : ''}`}
          style={{
            left: audioRegionOverlay.left,
            width: audioRegionOverlay.width,
          }}
          onMouseDown={handleAudioRegionSelectionMouseDown}
          onContextMenu={handleAudioRegionContextMenu}
          title="Drag to move the selected audio region; drag edges to resize"
        >
          <span
            className="clip-audio-region-edge left"
            onMouseDown={handleAudioRegionEdgeMouseDown('left')}
            title="Drag to resize the selected audio region start"
          />
          <span
            className="clip-audio-region-edge right"
            onMouseDown={handleAudioRegionEdgeMouseDown('right')}
            title="Drag to resize the selected audio region end"
          />
          {audioRegionGainControl && (
            <div
              className="clip-audio-region-gain-control"
              style={{ top: `${audioRegionGainControl.yPercent}%` }}
            >
              <div
                className="clip-audio-region-gain-line"
                onMouseDown={handleAudioRegionGainMouseDown('gain')}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  commitAudioRegionGainEdit({
                    gainDb: 0,
                    fadeInSeconds: 0,
                    fadeOutSeconds: 0,
                  });
                }}
                title="Drag to set region gain; double-click to reset"
              />
              <button
                type="button"
                className="clip-audio-region-fade-handle fade-in"
                style={{ left: audioRegionGainControl.fadeInPx }}
                onMouseDown={handleAudioRegionGainMouseDown('fade-in')}
                title={`Fade in gain change: ${audioRegionGainControl.fadeInSeconds.toFixed(2)}s`}
              />
              <button
                type="button"
                className="clip-audio-region-fade-handle fade-out"
                style={{ right: audioRegionGainControl.fadeOutPx }}
                onMouseDown={handleAudioRegionGainMouseDown('fade-out')}
                title={`Fade out gain change: ${audioRegionGainControl.fadeOutSeconds.toFixed(2)}s`}
              />
              <span className="clip-audio-region-gain-value">
                {formatAudioRegionGainLabel(audioRegionGainControl.gainDb)}
              </span>
            </div>
          )}
        </div>
      )}
      {clipVideoBakeRegionOverlays.map((overlay) => (
        <div
          key={overlay.id}
          className={`clip-video-bake-region ${overlay.selection ? 'selection' : ''} status-${overlay.status ?? 'marked'}`}
          style={{
            left: overlay.left,
            width: overlay.width,
          }}
          title={overlay.selection ? 'Video bake selection' : 'Video bake region'}
        >
          {!overlay.selection && (
            <div className="clip-video-bake-region-controls">
              <button
                type="button"
                className="clip-video-bake-btn"
                disabled={overlay.status === 'baking'}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (overlay.status === 'baked') {
                    unbakeClipVideoBakeRegion(clip.id, overlay.id);
                    return;
                  }
                  void bakeClipVideoBakeRegion(clip.id, overlay.id);
                }}
                title={overlay.status === 'baked' ? 'Unbake video region' : 'Bake video region'}
              >
                {overlay.status === 'baked' ? 'Unbake' : overlay.status === 'baking' ? '...' : 'Bake'}
              </button>
              <button
                type="button"
                className="clip-video-bake-btn remove"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeClipVideoBakeRegion(clip.id, overlay.id);
                }}
                title="Remove video bake region"
              >
                x
              </button>
            </div>
          )}
        </div>
      ))}
      {audioEditOperationOverlays.map((overlay) => (
        <div
          key={overlay.id}
          className="clip-audio-edit-operation-overlay"
          data-audio-edit-type={overlay.type}
          role="button"
          tabIndex={0}
          style={{
            left: overlay.left,
            width: overlay.width,
            top: overlay.top,
            height: overlay.height,
          }}
          onMouseDown={handleAudioEditOperationOverlayMouseDown(overlay)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            setAudioRegionContextMenu(null);
            setAudioRegionSelection(overlay.selection);
          }}
          title={overlay.label}
        >
          <span>{overlay.label}</span>
        </div>
      ))}
      {audioRegionContextMenu && audioRegionContextMenuPortalTarget && createPortal((
        <div
          ref={audioRegionContextMenuRef}
          className="timeline-context-menu clip-audio-region-context-menu"
          style={{
            position: 'fixed',
            left: audioRegionContextMenuPosition?.x ?? audioRegionContextMenu.x,
            top: audioRegionContextMenuPosition?.y ?? audioRegionContextMenu.y,
            zIndex: 10000,
          }}
          onPointerDownCapture={(e) => {
            if (e.button !== 0) return;
            const target = e.target;
            if (!(target instanceof Element)) return;
            const commandElement = target.closest<HTMLElement>('[data-audio-region-command]');
            const commandKey = commandElement?.dataset.audioRegionCommand;
            if (!commandKey) return;
            const command = findAudioRegionContextMenuCommand(audioRegionContextMenuModel, commandKey);
            if (!command) return;
            e.preventDefault();
            e.stopPropagation();
            runAudioRegionContextMenuCommand(command, audioRegionContextMenu.selection);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="context-menu-title">Audio Region</div>
          <div className="clip-audio-region-direct-actions">
            {audioRegionDirectMenuCommands.map(command => (
              <div
                key={command.key}
                data-audio-region-command={command.key}
                className={`context-menu-item ${command.disabled ? 'disabled' : ''} ${command.danger ? 'danger' : ''}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  runAudioRegionContextMenuCommand(command, audioRegionContextMenu.selection);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  runAudioRegionContextMenuCommand(command, audioRegionContextMenu.selection);
                }}
              >
                {command.label}
              </div>
            ))}
          </div>
          <div className="context-menu-separator" />
          {audioRegionContextMenuGroups.map(group => (
            <div
              key={group.key}
              className="context-menu-item has-submenu clip-audio-region-submenu-trigger"
            >
                <span>{group.label}</span>
              <span className="submenu-arrow" aria-hidden="true">▶</span>
              <div className="context-submenu clip-audio-region-submenu-panel">
                {group.commands.map(command => (
                <div
                  key={command.key}
                  data-audio-region-command={command.key}
                  className={`context-menu-item ${command.disabled ? 'disabled' : ''} ${command.danger ? 'danger' : ''}`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    runAudioRegionContextMenuCommand(command, audioRegionContextMenu.selection);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    runAudioRegionContextMenuCommand(command, audioRegionContextMenu.selection);
                  }}
                >
                  {command.label}
                </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ), audioRegionContextMenuPortalTarget)}
      {spectralRegionOverlay && (
        <div
          className={`clip-spectral-region-selection ${audioSpectralRegionSelection?.selectionMode === 'brush' ? 'brush' : 'rectangle'}`}
          style={{
            left: spectralRegionOverlay.left,
            width: spectralRegionOverlay.width,
            top: spectralRegionOverlay.top,
            height: spectralRegionOverlay.height,
          }}
        >
          <span className="clip-spectral-region-corner tl" />
          <span className="clip-spectral-region-corner tr" />
          <span className="clip-spectral-region-corner bl" />
          <span className="clip-spectral-region-corner br" />
        </div>
      )}
      {spectralImageLayerOverlays.map(({ id, left: overlayLeft, width: overlayWidth, top, height, layer, mediaFile }) => {
        const blendMode = layer.blendMode ?? 'attenuate';
        const opacity = finiteNumberOr(layer.opacity, 0.85);
        const gainDb = finiteNumberOr(layer.gainDb, -18);
        const imageUrl = mediaFile?.thumbnailUrl || mediaFile?.url;

        return (
          <div
            key={id}
            className={`clip-spectral-image-layer blend-${blendMode} ${layer.enabled === false ? 'disabled' : ''}`}
            style={{
              left: overlayLeft,
              width: overlayWidth,
              top,
              height,
              opacity: Math.max(0.18, opacity),
              backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
            }}
            title={`${mediaFile?.name ?? 'Spectral image'}: ${blendMode}, ${gainDb.toFixed(1)} dB`}
          >
            <span>{blendMode}</span>
          </div>
        );
      })}
      {spectralRegionOverlay && canSelectSpectralRegion && (
        <div
          className="clip-spectral-region-toolbar"
          style={{
            left: Math.max(4, spectralRegionOverlay.left),
            top: Math.max(20, spectralRegionOverlay.top),
          }}
          onMouseDown={handleAudioEditStackMouseDown}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={handleApplySpectralRegionEdit('spectral-mask')} title="Attenuate selected frequency region">Mask</button>
          <button type="button" onClick={handleApplySpectralRegionEdit('spectral-resynthesis')} title="Create a resynthesis operation for the selected frequency region">Resyn</button>
          <button
            type="button"
            onClick={handleAddSelectedImageSpectralLayer}
            disabled={!selectedSpectralImageFile}
            title={selectedSpectralImageFile ? `Add ${selectedSpectralImageFile.name} as a spectral image layer` : 'Select an image in the Media panel first'}
          >
            Img
          </button>
        </div>
      )}
      {isAudioClip && audioFocusMode && (audioEditStack.length > 0 || canUnbakeAudioEditStack) && (
        <div className="clip-audio-edit-stack" onMouseDown={handleAudioEditStackMouseDown}>
          <span className="clip-audio-edit-stack-count" title={`${activeAudioEditCount} active audio edits`}>
            {activeAudioEditCount}/{audioEditStack.length}
          </span>
          {audioEditStack.map(operation => (
            <button
              type="button"
              key={operation.id}
              className={operation.enabled === false ? 'disabled' : ''}
              title={`${operation.params.label ?? operation.type}: click to ${operation.enabled === false ? 'enable' : 'bypass'}, Alt-click to remove`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.altKey) {
                  removeClipAudioEditOperation(clip.id, operation.id);
                  return;
                }
                setClipAudioEditOperationEnabled(clip.id, operation.id, operation.enabled === false);
              }}
            >
              {String(operation.params.label ?? operation.type).slice(0, 3)}
            </button>
          ))}
          <button type="button" onClick={handleBakeAudioEditStack} disabled={audioBakePending || activeAudioEditCount === 0} title="Bake active audio edits into a new WAV source">
            {audioBakePending ? '...' : 'Bake'}
          </button>
          <button type="button" onClick={handleUnbakeAudioEditStack} disabled={audioBakePending || !canUnbakeAudioEditStack} title="Restore the source audio and region edits from the latest bake">
            Unbake
          </button>
          <button type="button" onClick={handleClearAudioEditStack} title="Clear audio edit stack">
            Clear
          </button>
        </div>
      )}
      {canSelectAudioRegion && (
        <div
          className="clip-audio-region-hitarea"
          onMouseDown={handleAudioRegionMouseDown}
          onDoubleClick={handleAudioRegionDoubleClick}
          title="Double-click to select the whole clip; hold Ctrl/Strg and drag to select an audio region"
        />
      )}
      {canSelectVideoBakeRegion && (
        <div
          className="clip-video-bake-region-hitarea"
          onMouseDown={handleVideoBakeRegionMouseDown}
          onDoubleClick={handleVideoBakeRegionDoubleClick}
          title="Double-click to mark the whole clip; hold Ctrl/Strg and drag to mark a video bake region"
        />
      )}
      {canSelectSpectralRegion && (
        <div
          className="clip-audio-region-hitarea clip-spectral-region-hitarea"
          onMouseDown={handleSpectralRegionMouseDown}
          onDragOver={handleSpectralImageLayerDragOver}
          onDrop={handleSpectralImageLayerDrop}
          onDoubleClick={(e) => {
            if (!isAudioRegionModifierPressed(e)) return;
            e.preventDefault();
            e.stopPropagation();
            clearAudioSpectralRegionSelection();
          }}
          title="Hold Ctrl/Strg and drag to select a spectral region; add Shift or Alt for brush"
        />
      )}
      {/* Nested composition mixdown waveform - shown overlaid on thumbnails */}
      {passiveDecorationsEnabled && waveformsEnabled && clip.isComposition && clip.mixdownWaveform && clip.mixdownWaveform.length > 0 && (
        <div className="clip-mixdown-waveform">
          <ClipWaveform
            waveform={clip.mixdownWaveform}
            width={width}
            height={Math.min(42, Math.max(16, trackBaseHeight / 3))}
            inPoint={displayInPoint}
            outPoint={displayOutPoint}
            naturalDuration={clip.duration}
            displayMode={audioDisplayMode}
            pixelsPerSecond={zoom}
            renderStartPx={waveformRenderWindow.startPx}
            renderWidth={waveformRenderWindow.width}
          />
        </div>
      )}
      {/* Nested composition mixdown generating indicator */}
      {passiveDecorationsEnabled && clip.isComposition && clip.mixdownGenerating && (
        <div className="clip-mixdown-indicator">
          <span>Generating audio...</span>
        </div>
      )}
      {passiveDecorationsEnabled && staticClipIconKind && (
        <div className="clip-static-artwork" aria-hidden="true">
          <StaticClipIcon kind={staticClipIconKind} className="clip-static-artwork-icon" />
        </div>
      )}
      {/* Segment-based thumbnails for nested compositions */}
      {showSegmentThumbnails && (
        <div
          className="clip-thumbnails clip-thumbnails-segments clip-thumbnails-windowed"
          style={{
            left: thumbnailRenderWindow.startPx,
            width: thumbnailRenderWindow.width,
            right: 'auto',
          }}
        >
          {compositionSegments.map((segment, segIdx) => {
            const windowStartNorm = thumbnailRenderWindow.startPx / Math.max(1, width);
            const windowEndNorm = (thumbnailRenderWindow.startPx + thumbnailRenderWindow.width) / Math.max(1, width);
            if (segment.endNorm < windowStartNorm || segment.startNorm > windowEndNorm) return null;
            const windowNormSpan = Math.max(0.0001, windowEndNorm - windowStartNorm);
            const clippedSegmentStart = Math.max(segment.startNorm, windowStartNorm);
            const clippedSegmentEnd = Math.min(segment.endNorm, windowEndNorm);
            const segmentWidth = ((clippedSegmentEnd - clippedSegmentStart) / windowNormSpan) * 100;
            const segmentLeft = ((clippedSegmentStart - windowStartNorm) / windowNormSpan) * 100;
            // Calculate how many thumbnails fit in this segment
            const segmentThumbCount = Math.max(1, Math.min(
              visibleThumbs,
              Math.ceil(((clippedSegmentEnd - clippedSegmentStart) * width) / THUMB_WIDTH) + 1,
            ));

            return (
              <div
                key={segIdx}
                className="clip-segment"
                style={{
                  position: 'absolute',
                  left: `${segmentLeft}%`,
                  width: `${segmentWidth}%`,
                  height: '100%',
                  display: 'flex',
                  overflow: 'hidden',
                }}
              >
                {segment.thumbnails.length > 0 ? (
                  Array.from({ length: segmentThumbCount }).map((_, i) => {
                    const thumbIndex = Math.floor((i / segmentThumbCount) * segment.thumbnails.length);
                    const thumb = segment.thumbnails[Math.min(thumbIndex, segment.thumbnails.length - 1)];
                    return (
                      <img
                        key={i}
                        src={thumb}
                        alt=""
                        className="clip-thumb"
                        draggable={false}
                        style={{ flex: '1 0 auto', minWidth: 0, objectFit: 'cover' }}
                      />
                    );
                  })
                ) : (
                  <div className="clip-segment-empty" style={{ width: '100%', height: '100%', background: '#1a1a1a' }} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Regular thumbnail filmstrip - source-based cache or legacy fallback */}
      {showRegularThumbnails && (
        <div
          className="clip-thumbnails clip-thumbnails-windowed"
          style={{
            left: thumbnailRenderWindow.startPx,
            width: thumbnailRenderWindow.width,
            right: 'auto',
          }}
        >
          {useSourceCache ? (
            // Source-based cache: thumbnails already mapped to visible range by hook
            cachedThumbnails.map((thumb, i) => thumb ? (
              <img
                key={i}
                src={thumb}
                alt=""
                className="clip-thumb"
                draggable={false}
              />
            ) : (
              <div key={i} className="clip-thumb clip-thumb-placeholder" />
            ))
          ) : (
            // Legacy fallback for clips without mediaFileId (compositions, old projects)
            Array.from({ length: visibleThumbs }).map((_, i) => {
              const naturalDuration = clip.source?.naturalDuration || clip.duration;
              const startRatio = displayInPoint / naturalDuration;
              const endRatio = displayOutPoint / naturalDuration;
              const positionInTrimmed = Math.min(1, Math.max(
                0,
                (thumbnailRenderWindow.startPx + i * THUMB_WIDTH) / Math.max(1, width),
              ));
              const sourceRatio = startRatio + positionInTrimmed * (endRatio - startRatio);
              const thumbIndex = Math.floor(sourceRatio * legacyThumbnails.length);
              const thumb = legacyThumbnails[Math.min(Math.max(0, thumbIndex), legacyThumbnails.length - 1)];
              return (
                <img
                  key={i}
                  src={thumb}
                  alt=""
                  className="clip-thumb"
                  draggable={false}
                />
              );
            })
          )}
        </div>
      )}
      {/* Nested composition clip boundary markers */}
      {passiveDecorationsEnabled && clip.isComposition && clip.nestedClipBoundaries && clip.nestedClipBoundaries.length > 0 && (
        <div className="nested-clip-boundaries">
          {clip.nestedClipBoundaries.map((boundary, i) => (
            <div
              key={i}
              className="nested-boundary-line"
              style={{ left: `${boundary * 100}%` }}
            />
          ))}
        </div>
      )}
      {/* Needs reload indicator */}
      {passiveDecorationsEnabled && clip.needsReload && (
        <div className="clip-reload-badge" title="Click media file to reload">
          !
        </div>
      )}
      {passiveDecorationsEnabled && (
      <div className="clip-content">
        <div
          className="clip-meta"
          style={clipMetaOffset > 0 ? { transform: `translateX(${clipMetaOffset}px)` } : undefined}
        >
          {clip.isLoading && <div className="clip-loading-spinner" />}
          <div className="clip-name-row">
            {isSolidClip && (
              <span className="clip-solid-swatch" title="Solid Clip" style={{ background: clip.solidColor || '#fff' }} />
            )}
            {(isTextClip || isText3DClip) && (
              <span className="clip-text-icon" title={isText3DClip ? '3D Text Clip' : 'Text Clip'}>
                {isText3DClip ? '3T' : 'T'}
              </span>
            )}
            {isVectorAnimationClip && (
              <span className="clip-text-icon" title={vectorAnimationTitle}>{vectorAnimationIcon}</span>
            )}
            {isMathSceneClip && (
              <span className="clip-text-icon" title="Math Scene Clip">ƒ</span>
            )}
            {staticClipIconKind && (
              <StaticClipIcon
                kind={staticClipIconKind}
                className="clip-type-icon"
              />
            )}
            {isSplatEffectorClip && (
              <span className="clip-text-icon" title="3D Effector Clip">E</span>
            )}
            <span className="clip-name">
              {isTextClip && clip.textProperties
                ? clip.textProperties.text.slice(0, 30) || 'Text'
                : isMathSceneClip && clip.mathScene
                  ? clip.mathScene.objects.find((object) => object.type === 'function')?.expression || 'Math Scene'
                : isText3DClip && text3DProperties
                  ? text3DProperties.text.slice(0, 30) || '3D Text'
                  : clip.name}
            </span>
            {/* PickWhip disabled */}
          </div>
          <span className="clip-duration">{formatTime(displayDuration)}</span>
        </div>
      </div>
      )}
      {/* Transcript word markers */}
      {passiveDecorationsEnabled && showTranscriptMarkers && clip.transcript && clip.transcript.length > 0 && (
        <div className="clip-transcript-markers">
          {clip.transcript.map((word) => {
            // Word times are relative to clip's inPoint
            const wordStartInClip = word.start - clip.inPoint;
            const wordEndInClip = word.end - clip.inPoint;

            // Only show markers that are visible within the clip's current trim
            if (wordEndInClip < 0 || wordStartInClip > displayDuration) {
              return null;
            }

            // Calculate marker position and width
            const markerStart = Math.max(0, wordStartInClip);
            const markerEnd = Math.min(displayDuration, wordEndInClip);
            const markerLeft = (markerStart / displayDuration) * 100;
            const markerWidth = ((markerEnd - markerStart) / displayDuration) * 100;

            return (
              <div
                key={word.id}
                className="transcript-marker"
                style={{
                  left: `${markerLeft}%`,
                  width: `${Math.max(0.5, markerWidth)}%`,
                }}
                title={word.text}
              />
            );
          })}
        </div>
      )}
      {/* Transcribing indicator */}
      {passiveDecorationsEnabled && clip.transcriptStatus === 'transcribing' && (
        <div className="clip-transcribing-indicator">
          <div className="transcribing-progress" style={{ width: `${clip.transcriptProgress || 0}%` }} />
        </div>
      )}
      {/* Analysis overlay - graph showing focus/motion (renders during analysis and when ready) */}
      {/* Only show analysis overlay for video clips, not audio */}
      {passiveDecorationsEnabled && !isAudioClip && clip.analysis && (clip.analysisStatus === 'ready' || clip.analysisStatus === 'analyzing') && (
        <>
          <div className="analysis-legend-labels">
            <span className="legend-focus">Focus</span>
            <span className="legend-motion">Motion</span>
            {clip.analysisStatus === 'analyzing' && (
              <span className="legend-progress">{clip.analysisProgress || 0}%</span>
            )}
          </div>
          <div className="clip-analysis-overlay">
            <ClipAnalysisOverlay
              analysis={clip.analysis}
              clipDuration={displayDuration}
              clipInPoint={clip.inPoint}
              clipStartTime={displayStartTime}
              width={width}
              height={trackBaseHeight}
            />
          </div>
        </>
      )}
      {/* Analyzing indicator (thin progress bar at bottom) */}
      {passiveDecorationsEnabled && clip.analysisStatus === 'analyzing' && (
        <div className="clip-analyzing-indicator">
          <div className="analyzing-progress" style={{ width: `${clip.analysisProgress || 0}%` }} />
        </div>
      )}
      {/* Keyframe tick marks on clip bar */}
      {keyframeTickGroups.length > 0 && (
        <div className="clip-keyframe-ticks">
          {keyframeTickGroups.map((group, i) => {
            const xPercent = (group.time / displayDuration) * 100;
            if (xPercent < 0 || xPercent > 100) return null;
            const isDraggingKeyframeGroup = keyframeGroupDrag
              ? group.keyframeIds.some(id => keyframeGroupDrag.keyframeIds.includes(id))
              : false;
            const keyframeCount = group.keyframeIds.length || 1;
            return (
              <button
                type="button"
                key={`${group.time}:${group.keyframeIds.join('|') || i}`}
                className={`keyframe-tick${isDraggingKeyframeGroup ? ' dragging' : ''}${group.hasStateChange ? ' state-change' : ''}`}
                style={{ left: `${xPercent}%` }}
                onMouseDown={isTrackLocked ? undefined : (e) => handleKeyframeTickMouseDown(e, group)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Move ${keyframeCount} keyframe${keyframeCount === 1 ? '' : 's'} at ${formatTime(group.time)}`}
                title={`Drag to move ${keyframeCount} keyframe${keyframeCount === 1 ? '' : 's'} at ${formatTime(group.time)} (Shift snaps to clip keyframes)`}
              />
            );
          })}
        </div>
      )}
      {/* Fade curve - SVG bezier curve showing opacity or audio-volume automation */}
      {visibleFadeCurveKeyframes.length >= 2 && (
        <div
          className={`fade-curve-container ${isAudioClip ? 'audio-automation-curve-container' : ''}`}
          data-audio-automation-curve={isAudioClip ? 'volume' : undefined}
        >
          <FadeCurve
            key={visibleFadeCurveKey}
            keyframes={visibleFadeCurveKeyframes}
            clipDuration={displayDuration}
            width={width}
            height={trackBaseHeight}
          />
        </div>
      )}
      {!isTrackLocked && (
        <>
          {/* Fade handles - corner handles for adjusting fade-in/out */}
          <div
            className={`fade-handle left${fadeInDuration > 0 ? ' active' : ''}`}
            style={fadeInDuration > 0 ? { left: timeToPixel(fadeInDuration) - 6 } : undefined}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (!canUseFadeHandles) return;
              e.stopPropagation();
              onFadeStart(e, 'left');
            }}
            title={fadeInDuration > 0 ? `Fade In: ${fadeInDuration.toFixed(2)}s` : 'Drag to add fade in'}
          />
          <div
            className={`fade-handle right${fadeOutDuration > 0 ? ' active' : ''}`}
            style={fadeOutDuration > 0 ? { right: timeToPixel(fadeOutDuration) - 6 } : undefined}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (!canUseFadeHandles) return;
              e.stopPropagation();
              onFadeStart(e, 'right');
            }}
            title={fadeOutDuration > 0 ? `Fade Out: ${fadeOutDuration.toFixed(2)}s` : 'Drag to add fade out'}
          />
          {/* Trim handles */}
          <div
            className={`trim-handle left arrows-${leftTrimHandleDirections.length}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (!canUseTrimHandles) return;
              e.stopPropagation();
              onTrimStart(e, 'left');
            }}
          >
            <TrimHandleArrows directions={leftTrimHandleDirections} />
          </div>
          <div
            className={`trim-handle right arrows-${rightTrimHandleDirections.length}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (!canUseTrimHandles) return;
              e.stopPropagation();
              onTrimStart(e, 'right');
            }}
          >
            <TrimHandleArrows directions={rightTrimHandleDirections} />
          </div>
        </>
      )}
    </div>
  );
}

export const TimelineClip = memo(TimelineClipComponent);
