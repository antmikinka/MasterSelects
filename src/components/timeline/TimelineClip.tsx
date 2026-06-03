// TimelineClip component - Clip rendering within tracks

import './TimelineClip.css';
import { memo, type CSSProperties, useRef, useState, useCallback, useMemo } from 'react';
import type { TimelineClipProps } from './types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from './trackColor';
import { ClipAudioEditStackControls } from './components/ClipAudioEditStackControls';
import { ClipAudioRegionSelectionOverlay } from './components/ClipAudioRegionSelectionOverlay';
import { ClipSpectralRegionOverlays } from './components/ClipSpectralRegionOverlays';
import { ClipAudioRegionContextMenu } from './components/ClipAudioRegionContextMenu';
import { ClipVideoBakeRegionOverlays } from './components/ClipVideoBakeRegionOverlays';
import { ClipAudioEditOperationOverlays } from './components/ClipAudioEditOperationOverlays';
import { ClipKeyframeTicks } from './components/ClipKeyframeTicks';
import { ClipFadeTrimControls } from './components/ClipFadeTrimControls';
import { ClipSelectionHitareas } from './components/ClipSelectionHitareas';
import {
  ClipPassiveBackgroundLayer,
  ClipPassiveForegroundLayer,
} from './components/ClipPassiveVisualLayers';
import { useTimelineSpectrogramTileSetState } from './hooks/useTimelineSpectrogramTileSet';
import { useTimelineWaveformPyramidState } from './hooks/useTimelineWaveformPyramid';
import {
  collectAudioEffectInstanceRouteSettings,
  collectLegacyAudioEffectRouteSettings,
} from '../../services/audio/audioGraphRouteSettings';
import {
  resolveAudioEditOperationOverlays,
  resolveClipVideoBakeRegionOverlays,
  type AudioEditOperationOverlay,
  type ClipVideoBakeRegionOverlay,
} from './utils/activeRegionOverlays';
import { resolveAudioWaveformDiagnostics } from './utils/audioWaveformDiagnostics';
import { resolveAudioVolumeAutomationCurveKeyframes } from './utils/audioAutomationCurve';
import { resolveClipLabelHex } from './utils/resolveClipLabelHex';
import { resolveClipMediaClassification } from './utils/clipMediaClassification';
import {
  getTimelineClipSourceDuration,
} from './utils/clipSourceTiming';
import { resolveSourceExtensionGhosts } from './utils/sourceExtensionGhosts';
import {
  getSpectralMaxFrequencyHz,
} from './utils/spectralSelection';
import {
  resolveSpectralImageLayerOverlays,
  resolveSpectralRegionOverlay,
} from './utils/spectralRegionOverlays';
import type { TimelineAudioRegionSelection } from '../../stores/timeline/types';
import {
  getTimelineToolCursor,
  isTimelineBladeTool,
  isTimelinePointerTool,
} from './tools/pointer/timelineToolPointerDispatcher';
import { getTrimHandleArrowDirections } from './utils/trimHandleDirections';
import {
  hasLegacyWaveformSamples,
} from '../../utils/audioWaveformPresence';
import { useClipAudioRegionControls } from './hooks/useClipAudioRegionControls';
import { useClipStemSwitcher } from './hooks/useClipStemSwitcher';
import { useClipAnimationState } from './hooks/useClipAnimationState';
import {
  useClipRegionInteractions,
  type AudioRegionDragState,
  type AudioRegionMoveDragState,
  type AudioRegionResizeDragState,
  type SpectralRegionDragState,
  type VideoBakeRegionDragState,
} from './hooks/useClipRegionInteractions';
import { useClipKeyframeTickDrag } from './hooks/useClipKeyframeTickDrag';
import { useClipSpectralImageLayers } from './hooks/useClipSpectralImageLayers';
import { useClipOverlayActions } from './hooks/useClipOverlayActions';
import { useClipAudioArtifactWarmups } from './hooks/useClipAudioArtifactWarmups';
import { useClipAudioRenderState } from './hooks/useClipAudioRenderState';
import { useClipAudioAnalysisDisplayState } from './hooks/useClipAudioAnalysisDisplayState';
import { useClipTimelineRenderGeometry } from './hooks/useClipTimelineRenderGeometry';
import { useClipTimelineToolPointer } from './hooks/useClipTimelineToolPointer';

const TIMELINE_RENDER_OVERSCAN_PX = 512;
const CLIP_RIGHT_STICKY_PADDING_PX = 8;
const EMPTY_CLIP_KEYFRAMES = [] as const;
const EMPTY_AUDIO_EDIT_STACK = [] as const;
const EMPTY_SPECTRAL_LAYERS = [] as const;

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
  const spectrogramVariant: 'processed' | 'source' = processedSpectrogramTileSet ? 'processed' : 'source';
  const spectralMaxFrequencyHz = getSpectralMaxFrequencyHz(spectrogramTileSet?.sampleRate);
  const waveformVariant: 'processed' | 'source' | 'legacy' = waveformUsesProcessedPyramid
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
  const {
    waveformProcessingState,
    spectrogramProcessingState,
    processedWaveformStatus,
    processedSpectrogramStatus,
    audioAnalysisDisplayStatus,
    showWaveformGenerationIndicator,
  } = useClipAudioAnalysisDisplayState({
    clip,
    clipAudioKeyframes,
    audioDisplayMode,
    processedWaveformPyramidRef,
    processedWaveformReady: Boolean(processedWaveformPyramid),
    processedWaveformLoadStatus: processedWaveformState.status,
    sourceWaveformReady: Boolean(sourceWaveformPyramid),
    hasLegacyWaveformData,
    usePredictiveAudioWaveform,
    processedSpectrogramTileSetRef,
    processedSpectrogramReady: Boolean(processedSpectrogramTileSet),
    processedSpectrogramLoadStatus: processedSpectrogramState.status,
    sourceSpectrogramReady: Boolean(sourceSpectrogramTileSet),
  });
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

  const {
    aiMove,
    aiMovePhase,
    animationClass,
    animationDelay,
  } = useClipAnimationState({ clip, clips, tracks });

  const {
    isAudioClip,
    isTextClip,
    isText3DClip,
    isSolidClip,
    isMathSceneClip,
    isVectorAnimationClip,
    vectorAnimationIcon,
    vectorAnimationTitle,
    isSplatEffectorClip,
    staticClipIconKind,
    showsStaticClipArtwork,
    text3DProperties,
    clipTypeClass,
  } = resolveClipMediaClassification(clip);

  const isGeneratingProxy = proxyStatus === 'generating';
  const hasProxy = proxyStatus === 'ready';
  const hasProxyError = proxyStatus === 'error';
  const isGeneratingAudioProxy = audioProxyStatus === 'generating';
  const hasAudioProxy = audioProxyStatus === 'ready';
  const hasAudioProxyError = audioProxyStatus === 'error';
  const {
    showActiveStemSeparation,
    activeStemProgressPercent,
    activeStemStatusTitle,
    isDownloadingStemModel,
    stemSwitcherNode,
  } = useClipStemSwitcher({
    clip,
    clips,
    mediaFiles,
    clipStemSeparationJob,
    setClipSourceToStem,
    prewarmStemSourceMediaFiles,
  });

  const {
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    width,
    left,
    visibleTimelineViewportWidth,
    renderTimelineViewportWidth,
    waveformRenderWindow,
    thumbnailRenderWindow,
    showSegmentThumbnails,
    showRegularThumbnails,
    useSourceCache,
    cachedThumbnails,
    segmentThumbnailPlans,
    legacyThumbnailPlans,
  } = useClipTimelineRenderGeometry({
    clip,
    clips,
    isDragging,
    isTrimming,
    isLinkedToDragging,
    isLinkedToTrimming,
    isTrimFollower,
    clipDrag,
    clipTrim,
    timelineViewportWidth,
    scrollX,
    thumbnailsEnabled,
    passiveMediaEnabled,
    isAudioClip,
    showsStaticClipArtwork,
    timeToPixel,
  });

  useClipAudioArtifactWarmups({
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
  });

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

  const keyframeTickGroups = keyframeTimeGroups;
  const [audioRegionDrag, setAudioRegionDrag] = useState<AudioRegionDragState | null>(null);
  const [videoBakeRegionDrag, setVideoBakeRegionDrag] = useState<VideoBakeRegionDragState | null>(null);
  const [audioRegionMoveDrag, setAudioRegionMoveDrag] = useState<AudioRegionMoveDragState | null>(null);
  const [audioRegionResizeDrag, setAudioRegionResizeDrag] = useState<AudioRegionResizeDragState | null>(null);
  const [spectralRegionDrag, setSpectralRegionDrag] = useState<SpectralRegionDragState | null>(null);

  const {
    displayAudioEditStack,
    getMatchingAudioRegionOperationIds,
    hasWaveformForRender,
    audioSpectrogramProps,
    audioWaveformProps,
  } = useClipAudioRenderState({
    clip,
    clipTrim,
    audioEditStack,
    audioRegionSelection,
    audioRegionGainPreview,
    audioRegionMoveDrag,
    audioRegionResizeDrag,
    sourceWaveformPyramid,
    processedWaveformPyramid,
    waveformPyramid,
    waveformVariant,
    waveformDisplayGain,
    spectrogramTileSet,
    spectrogramInPoint,
    spectrogramOutPoint,
    spectrogramNaturalDuration,
    spectrogramVariant,
    waveformRenderWindow,
    audioVolumeAutomationKeyframes,
    isAudioClip,
    isTrimming,
    isLinkedToTrimming,
    displayInPoint,
    displayOutPoint,
    displayDuration,
    width,
    left,
    scrollX,
    renderTimelineViewportWidth,
    trackBaseHeight,
    zoom,
    audioDisplayMode,
  });
  const {
    audioRegionOverlay,
    audioRegionGainControl,
    audioRegionContextMenu,
    audioRegionContextMenuRef,
    audioRegionContextMenuRenderPosition,
    audioRegionContextMenuModel,
    runAudioRegionContextMenuCommand,
    closeAudioRegionContextMenu,
    handleAudioRegionGainMouseDown,
    handleAudioRegionContextMenu,
    handleResetAudioRegionGain,
  } = useClipAudioRegionControls({
    clip,
    audioRegionSelection,
    displayAudioEditStack,
    displayStartTime,
    displayDuration,
    width,
    hasAudioRegionClipboard,
    applyTimelineEditOperation,
    applyAudioRegionEdit,
    setAudioRegionGainPreview,
    clearAudioRegionGainPreview,
    setAudioRegionGainEdit,
    setAudioRegionSelection,
    clearAudioRegionSelection,
    copySelectedAudioRegion,
    pasteAudioRegionToSelection,
    selectClip,
  });

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

  const {
    keyframeGroupDrag,
    handleKeyframeTickMouseDown,
  } = useClipKeyframeTickDrag({
    keyframeTickGroups,
    displayDuration,
    width,
    onMoveKeyframeGroup,
  });

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

  const {
    timelineTimeFromAudioRegionClientX,
    sourceTimeToVideoBakeTimelineTime,
    handleAudioRegionMouseDown,
    handleAudioRegionDoubleClick,
    handleVideoBakeRegionMouseDown,
    handleVideoBakeRegionDoubleClick,
    handleAudioRegionSelectionMouseDown,
    handleAudioRegionEdgeMouseDown,
    handleSpectralRegionMouseDown,
    handleSpectralRegionDoubleClick,
  } = useClipRegionInteractions({
    clip,
    track,
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    width,
    zoom,
    spectralMaxFrequencyHz,
    canSelectAudioRegion,
    canSelectSpectralRegion,
    canSelectVideoBakeRegion,
    audioRegionSelection,
    audioRegionDrag,
    videoBakeRegionDrag,
    audioRegionMoveDrag,
    audioRegionResizeDrag,
    spectralRegionDrag,
    setAudioRegionDrag,
    setVideoBakeRegionDrag,
    setAudioRegionMoveDrag,
    setAudioRegionResizeDrag,
    setSpectralRegionDrag,
    getMatchingAudioRegionOperationIds,
    commitAudioRegionOperationRange,
    closeAudioRegionContextMenu,
    setAudioRegionSelection,
    clearAudioRegionSelection,
    setAudioSpectralRegionSelection,
    clearAudioSpectralRegionSelection,
    setVideoBakeRegionSelection,
    clearVideoBakeRegionSelection,
    addClipVideoBakeRegion,
  });

  const {
    spectralImageFilesById,
    selectedSpectralImageFile,
    handleAddSelectedImageSpectralLayer,
    handleSpectralImageLayerDragOver,
    handleSpectralImageLayerDrop,
  } = useClipSpectralImageLayers({
    clip,
    mediaFiles,
    audioSpectralRegionSelection,
    displayStartTime,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    zoom,
    spectralMaxFrequencyHz,
    canSelectSpectralRegion,
    timelineTimeFromAudioRegionClientX,
    addClipSpectralImageLayer,
    setAudioSpectralRegionSelection,
  });

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

  const {
    shouldShowCutIndicator,
    cutIndicatorX,
    handleMouseMove,
    handleMouseLeave,
    handleClick,
  } = useClipTimelineToolPointer({
    clip,
    track,
    clips,
    activeTimelineToolId,
    timelineToolPreview,
    canHandleTimelineToolPointer,
    playheadPosition,
    snappingEnabled,
    displayStartTime,
    displayDuration,
    width,
    isBladeToolActive,
    setTimelineToolPreview,
    applyTimelineEditOperation,
    setActiveTimelineTool,
  });

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
    showActiveStemSeparation ? 'separating-stems' : '',
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

  const spectralRegionOverlay = useMemo(() => resolveSpectralRegionOverlay({
    selection: audioSpectralRegionSelection,
    displayStartTime,
    displayDuration,
    width,
    trackBaseHeight,
    maxFrequencyHz: spectralMaxFrequencyHz,
  }), [
    audioSpectralRegionSelection,
    displayDuration,
    displayStartTime,
    spectralMaxFrequencyHz,
    trackBaseHeight,
    width,
  ]);
  const sourceTimeToDisplayTimelineTime = useCallback((sourceTime: number): number => {
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + 0.001, displayOutPoint ?? sourceStart + displayDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
    return displayStartTime + timelineRatio * displayDuration;
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);
  const spectralLayers = clip.audioState?.spectralLayers ?? EMPTY_SPECTRAL_LAYERS;
  const spectralImageLayerOverlays = useMemo(() => resolveSpectralImageLayerOverlays({
    enabled: canSelectSpectralRegion || audioDisplayMode === 'spectral',
    layers: spectralLayers,
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
    displayDuration,
    displayStartTime,
    sourceTimeToDisplayTimelineTime,
    spectralLayers,
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
  const {
    audioBakePending,
    handleBakeClipVideoRegion,
    handleUnbakeClipVideoRegion,
    handleRemoveClipVideoRegion,
    handleAudioEditOperationOverlayActivate,
    handleToggleAudioEditOperation,
    handleRemoveAudioEditOperation,
    handleApplySpectralRegionEdit,
    handleAudioEditStackMouseDown,
    handleBakeAudioEditStack,
    handleUnbakeAudioEditStack,
    handleClearAudioEditStack,
  } = useClipOverlayActions({
    clipId: clip.id,
    canUnbakeAudioEditStack,
    bakeClipVideoBakeRegion,
    unbakeClipVideoBakeRegion,
    removeClipVideoBakeRegion,
    closeAudioRegionContextMenu,
    setAudioRegionSelection,
    setClipAudioEditOperationEnabled,
    removeClipAudioEditOperation,
    applySpectralRegionEdit,
    clearClipAudioEditStack,
    bakeClipAudioEditStack,
    unbakeClipAudioEditStack,
  });

  // Track filtering must stay after all hooks so React sees a stable hook order
  // while clips move between tracks during drag and linked edits.
  if (isDragging && clipDrag && clipDrag.currentTrackId !== trackId) {
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
  const sourceExtensionGhosts = useMemo(() => resolveSourceExtensionGhosts({
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
    sourceDuration: getTimelineClipSourceDuration(clip),
    scrollX,
    viewportWidth: renderTimelineViewportWidth,
    overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
    timeToPixel,
  }), [
    clip.duration,
    clip.inPoint,
    clip.outPoint,
    clip.source?.naturalDuration,
    clip.startTime,
    clipTrim?.edge,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    isLinkedToTrimming,
    isTrimming,
    left,
    passiveDecorationsEnabled,
    renderTimelineViewportWidth,
    scrollX,
    timeToPixel,
    width,
  ]);

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
      <ClipPassiveBackgroundLayer
        sourceExtensionGhosts={sourceExtensionGhosts}
        passiveDecorationsEnabled={passiveDecorationsEnabled}
        passiveMediaEnabled={passiveMediaEnabled}
        waveformsEnabled={waveformsEnabled}
        clip={clip}
        proxyEnabled={proxyEnabled}
        isGeneratingProxy={isGeneratingProxy}
        proxyProgress={proxyProgress}
        hasProxy={hasProxy}
        hasProxyError={hasProxyError}
        isGeneratingAudioProxy={isGeneratingAudioProxy}
        audioProxyProgress={audioProxyProgress}
        hasAudioProxy={hasAudioProxy}
        hasAudioProxyError={hasAudioProxyError}
        showActiveStemSeparation={showActiveStemSeparation}
        activeStemStatusTitle={activeStemStatusTitle}
        activeStemProgressPercent={activeStemProgressPercent}
        isDownloadingStemModel={isDownloadingStemModel}
        isInLinkedGroup={isInLinkedGroup}
        stemSwitcher={stemSwitcherNode}
        mediaFiles={mediaFiles}
        isAudioClip={isAudioClip}
        showWaveformGenerationIndicator={showWaveformGenerationIndicator}
        audioDisplayMode={audioDisplayMode}
        hasWaveformForRender={hasWaveformForRender}
        audioSpectrogramProps={audioSpectrogramProps}
        audioWaveformProps={audioWaveformProps}
        audioAnalysisDisplayStatus={audioAnalysisDisplayStatus}
        audioWaveformDiagnostics={audioWaveformDiagnostics}
      />
      {audioRegionOverlay && (
        <ClipAudioRegionSelectionOverlay
          overlay={audioRegionOverlay}
          snappedToZeroCrossing={Boolean(audioRegionSelection?.snappedToZeroCrossing)}
          moving={Boolean(audioRegionMoveDrag)}
          resizing={Boolean(audioRegionResizeDrag)}
          gainControl={audioRegionGainControl}
          onSelectionMouseDown={handleAudioRegionSelectionMouseDown}
          onContextMenu={handleAudioRegionContextMenu}
          onEdgeMouseDown={handleAudioRegionEdgeMouseDown}
          onGainMouseDown={handleAudioRegionGainMouseDown}
          onResetGain={handleResetAudioRegionGain}
        />
      )}
      <ClipVideoBakeRegionOverlays
        overlays={clipVideoBakeRegionOverlays}
        onBakeRegion={handleBakeClipVideoRegion}
        onUnbakeRegion={handleUnbakeClipVideoRegion}
        onRemoveRegion={handleRemoveClipVideoRegion}
      />
      <ClipAudioEditOperationOverlays
        overlays={audioEditOperationOverlays}
        onActivateOverlay={handleAudioEditOperationOverlayActivate}
      />
      {audioRegionContextMenu && (
        <ClipAudioRegionContextMenu
          menuRef={audioRegionContextMenuRef}
          position={audioRegionContextMenuRenderPosition ?? audioRegionContextMenu}
          model={audioRegionContextMenuModel}
          selection={audioRegionContextMenu.selection}
          onRunCommand={runAudioRegionContextMenuCommand}
        />
      )}
      <ClipSpectralRegionOverlays
        regionOverlay={spectralRegionOverlay}
        selectionMode={audioSpectralRegionSelection?.selectionMode}
        imageLayerOverlays={spectralImageLayerOverlays}
        canSelectSpectralRegion={canSelectSpectralRegion}
        selectedSpectralImageFile={selectedSpectralImageFile}
        onToolbarMouseDown={handleAudioEditStackMouseDown}
        onApplySpectralRegionEdit={handleApplySpectralRegionEdit}
        onAddSelectedImageSpectralLayer={handleAddSelectedImageSpectralLayer}
      />
      {isAudioClip && audioFocusMode && (audioEditStack.length > 0 || canUnbakeAudioEditStack) && (
        <ClipAudioEditStackControls
          operations={audioEditStack}
          activeCount={activeAudioEditCount}
          audioBakePending={audioBakePending}
          canUnbakeAudioEditStack={canUnbakeAudioEditStack}
          onMouseDown={handleAudioEditStackMouseDown}
          onToggleOperation={handleToggleAudioEditOperation}
          onRemoveOperation={handleRemoveAudioEditOperation}
          onBake={handleBakeAudioEditStack}
          onUnbake={handleUnbakeAudioEditStack}
          onClear={handleClearAudioEditStack}
        />
      )}
      <ClipSelectionHitareas
        canSelectAudioRegion={canSelectAudioRegion}
        canSelectVideoBakeRegion={canSelectVideoBakeRegion}
        canSelectSpectralRegion={canSelectSpectralRegion}
        onAudioRegionMouseDown={handleAudioRegionMouseDown}
        onAudioRegionDoubleClick={handleAudioRegionDoubleClick}
        onVideoBakeRegionMouseDown={handleVideoBakeRegionMouseDown}
        onVideoBakeRegionDoubleClick={handleVideoBakeRegionDoubleClick}
        onSpectralRegionMouseDown={handleSpectralRegionMouseDown}
        onSpectralRegionDragOver={handleSpectralImageLayerDragOver}
        onSpectralRegionDrop={handleSpectralImageLayerDrop}
        onSpectralRegionDoubleClick={handleSpectralRegionDoubleClick}
      />
      <ClipPassiveForegroundLayer
        passiveDecorationsEnabled={passiveDecorationsEnabled}
        clip={clip}
        waveformsEnabled={waveformsEnabled}
        width={width}
        trackBaseHeight={trackBaseHeight}
        displayInPoint={displayInPoint}
        displayOutPoint={displayOutPoint}
        audioDisplayMode={audioDisplayMode}
        pixelsPerSecond={zoom}
        waveformRenderStartPx={waveformRenderWindow.startPx}
        waveformRenderWidth={waveformRenderWindow.width}
        staticClipIconKind={staticClipIconKind}
        showSegmentThumbnails={showSegmentThumbnails}
        showRegularThumbnails={showRegularThumbnails}
        useSourceCache={useSourceCache}
        thumbnailRenderWindow={thumbnailRenderWindow}
        segmentThumbnailPlans={segmentThumbnailPlans}
        cachedThumbnails={cachedThumbnails}
        legacyThumbnailPlans={legacyThumbnailPlans}
        clipMetaOffset={clipMetaOffset}
        displayDuration={displayDuration}
        formatTime={formatTime}
        isSolidClip={isSolidClip}
        isTextClip={isTextClip}
        isText3DClip={isText3DClip}
        isMathSceneClip={isMathSceneClip}
        isVectorAnimationClip={isVectorAnimationClip}
        vectorAnimationIcon={vectorAnimationIcon}
        vectorAnimationTitle={vectorAnimationTitle}
        isSplatEffectorClip={isSplatEffectorClip}
        text3DProperties={text3DProperties}
        showTranscriptMarkers={showTranscriptMarkers}
        displayStartTime={displayStartTime}
        isAudioClip={isAudioClip}
      />
      <ClipKeyframeTicks
        groups={keyframeTickGroups}
        displayDuration={displayDuration}
        draggingKeyframeIds={keyframeGroupDrag?.keyframeIds}
        isTrackLocked={isTrackLocked}
        formatTime={formatTime}
        onTickMouseDown={handleKeyframeTickMouseDown}
      />
      <ClipFadeTrimControls
        fadeCurveKey={visibleFadeCurveKey}
        fadeCurveKeyframes={visibleFadeCurveKeyframes}
        displayDuration={displayDuration}
        width={width}
        trackBaseHeight={trackBaseHeight}
        isAudioClip={isAudioClip}
        isTrackLocked={isTrackLocked}
        canUseFadeHandles={canUseFadeHandles}
        canUseTrimHandles={canUseTrimHandles}
        fadeInDuration={fadeInDuration}
        fadeOutDuration={fadeOutDuration}
        timeToPixel={timeToPixel}
        leftTrimHandleDirections={leftTrimHandleDirections}
        rightTrimHandleDirections={rightTrimHandleDirections}
        onFadeStart={onFadeStart}
        onTrimStart={onTrimStart}
      />
    </div>
  );
}

export const TimelineClip = memo(TimelineClipComponent);
