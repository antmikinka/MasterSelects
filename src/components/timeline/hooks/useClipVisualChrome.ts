import { useMemo, type CSSProperties } from 'react';
import type { TimelineClipProps } from '../types';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from '../trackColor';
import { getTimelineClipSourceDuration } from '../utils/clipSourceTiming';
import { resolveSourceExtensionGhosts } from '../utils/sourceExtensionGhosts';

const TIMELINE_RENDER_OVERSCAN_PX = 512;
const CLIP_RIGHT_STICKY_PADDING_PX = 8;

export function useClipVisualChrome(input: {
  clip: TimelineClipProps['clip'];
  track: TimelineClipProps['track'];
  tracks: TimelineClipProps['tracks'];
  clipDrag: TimelineClipProps['clipDrag'];
  clipTrim: TimelineClipProps['clipTrim'];
  isSelected: boolean;
  isInLinkedGroup: boolean;
  isDragging: boolean;
  isClipDragActive: boolean;
  isTrimming: boolean;
  isFading: boolean;
  isLinkedToDragging: boolean;
  isLinkedToTrimming: boolean;
  isAudioClip: boolean;
  audioFocusMode: boolean;
  audioDisplayMode: string;
  audioRegionSelected: boolean;
  spectralRegionSelected: boolean;
  videoBakeRegionSelected: boolean;
  clipTypeClass: string;
  hasProxy: boolean;
  isGeneratingProxy: boolean;
  hasProxyError: boolean;
  hasAudioProxy: boolean;
  isGeneratingAudioProxy: boolean;
  hasAudioProxyError: boolean;
  showActiveStemSeparation: boolean;
  hasKeyframes: (clipId: string) => boolean;
  showWaveformGenerationIndicator: boolean;
  waveformProcessingState: string;
  spectrogramProcessingState: string;
  processedWaveformStatusClassName: string;
  processedSpectrogramStatusClassName: string;
  audioWaveformDiagnosticClassNames: readonly string[];
  aiMovePhase: 'idle' | 'initial' | 'animating';
  aiMove: { fromStartTime: number; animationDuration: number } | undefined;
  animationDelay: number;
  timelineToolCursor: string;
  trackFocusMode: string;
  timelineTrackColorsVisible: boolean;
  isSolidClip: boolean;
  mediaLabelHex: string | null;
  passiveDecorationsEnabled: boolean;
  left: number;
  width: number;
  scrollX: number;
  visibleTimelineViewportWidth: number;
  displayStartTime: number;
  displayDuration: number;
  displayInPoint: number;
  displayOutPoint: number;
  renderTimelineViewportWidth: number;
  timeToPixel: TimelineClipProps['timeToPixel'];
}) {
  const isInMultiSelectDrag = input.clipDrag?.multiSelectClipIds?.includes(input.clip.id) && input.clipDrag.multiSelectTimeDelta !== undefined;
  const isClipBodyDragging = input.isDragging || input.isLinkedToDragging || Boolean(isInMultiSelectDrag);
  const showFocusCollisionHighlight = input.trackFocusMode !== 'balanced' && !!input.clipDrag?.overlapClipIds?.length;
  const isOverlapCollisionTarget = showFocusCollisionHighlight && !!input.clipDrag?.overlapClipIds?.includes(input.clip.id);
  const isOverlapCollisionSource = showFocusCollisionHighlight && isClipBodyDragging;
  const isTrackLocked = input.track.locked === true;
  const canHandleTimelineToolPointer = !input.isClipDragActive && !isTrackLocked && !isClipBodyDragging;
  const trackTypeIndex = useMemo(
    () => input.tracks.filter(candidate => candidate.type === input.track.type).findIndex(candidate => candidate.id === input.track.id),
    [input.track.id, input.track.type, input.tracks],
  );
  const trackColor = input.timelineTrackColorsVisible ? getTimelineTrackColor(input.track, trackTypeIndex) : TIMELINE_TRACK_COLOR_HIDDEN;

  const clipMetaOffset = input.clip.isLoading
    ? 0
    : Math.min(
        Math.max(0, input.scrollX - input.left),
        Math.max(0, input.width - 48)
      );
  const clipRightOverflow = input.left + input.width - (input.scrollX + input.visibleTimelineViewportWidth);
  const clipRightStickyOffset = Math.max(
    0,
    Math.min(
      Math.max(0, input.width - 18),
      clipRightOverflow > 0 ? clipRightOverflow + CLIP_RIGHT_STICKY_PADDING_PX : 0
    )
  );

  const clipClass = [
    'timeline-clip',
    input.isSelected ? 'selected' : '',
    input.isInLinkedGroup ? 'linked-group' : '',
    input.isDragging ? 'dragging' : '',
    input.clipDrag?.toolGesture === 'slip' && (input.isDragging || input.isLinkedToDragging) ? 'slipping' : '',
    input.clipDrag?.toolGesture === 'slide' && (input.isDragging || input.isLinkedToDragging) ? 'sliding' : '',
    isInMultiSelectDrag ? 'dragging multiselect-dragging' : '',
    input.isLinkedToDragging ? 'linked-dragging' : '',
    input.isTrimming ? 'trimming' : '',
    input.isLinkedToTrimming ? 'linked-trimming' : '',
    input.isFading ? 'fading' : '',
    input.isDragging && input.clipDrag?.forcingOverlap ? 'forcing-overlap' : '',
    isOverlapCollisionSource ? 'overlap-collision-source' : '',
    isOverlapCollisionTarget ? 'overlap-collision-target' : '',
    input.clipTypeClass,
    input.isAudioClip ? `audio-mode-${input.audioDisplayMode}` : '',
    input.isAudioClip && input.audioFocusMode ? 'audio-focus-active' : '',
    input.audioRegionSelected ? 'audio-region-selected' : '',
    input.spectralRegionSelected ? 'spectral-region-selected' : '',
    input.videoBakeRegionSelected ? 'video-bake-region-selected' : '',
    input.clip.videoState?.bakeRegions?.length ? 'has-video-bake-regions' : '',
    input.clip.isLoading ? 'loading' : '',
    input.clip.needsReload ? 'needs-reload' : '',
    input.hasProxy ? 'has-proxy' : '',
    input.isGeneratingProxy ? 'generating-proxy' : '',
    input.hasProxyError ? 'proxy-error' : '',
    input.hasAudioProxy ? 'has-audio-proxy' : '',
    input.isGeneratingAudioProxy ? 'generating-audio-proxy' : '',
    input.hasAudioProxyError ? 'audio-proxy-error' : '',
    input.showActiveStemSeparation ? 'separating-stems' : '',
    input.hasKeyframes(input.clip.id) ? 'has-keyframes' : '',
    input.clip.reversed ? 'reversed' : '',
    input.clip.transcriptStatus === 'ready' ? 'has-transcript' : '',
    input.showWaveformGenerationIndicator ? 'generating-waveform' : '',
    input.waveformProcessingState,
    input.spectrogramProcessingState,
    input.audioDisplayMode === 'spectral' ? '' : input.processedWaveformStatusClassName,
    input.audioDisplayMode === 'spectral' ? input.processedSpectrogramStatusClassName : '',
    ...input.audioWaveformDiagnosticClassNames,
    input.clip.parentClipId ? 'has-parent' : '',
    input.clip.isPendingDownload ? 'pending-download' : '',
    input.clip.downloadError ? 'download-error' : '',
    input.clip.isComposition ? 'composition' : '',
    input.aiMovePhase !== 'idle' ? 'ai-moving' : '',
    isTrackLocked ? 'track-locked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const clipStyle = {
    left: input.left,
    width: input.width,
    cursor: isTrackLocked ? 'not-allowed' : input.timelineToolCursor,
    animationDelay: `${input.animationDelay}s`,
    '--track-color': trackColor,
    '--clip-right-sticky-offset': `${clipRightStickyOffset}px`,
    ...(input.aiMovePhase === 'initial' && input.aiMove ? {
      transform: `translateX(${input.timeToPixel(input.aiMove.fromStartTime) - input.left}px)`,
    } : input.aiMovePhase === 'animating' && input.aiMove ? {
      transform: 'translateX(0)',
      transition: `transform ${input.aiMove.animationDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
    } : {}),
    ...(input.isAudioClip && input.audioFocusMode ? {
      background: `linear-gradient(180deg, color-mix(in srgb, ${trackColor} 72%, #202020), color-mix(in srgb, ${trackColor} 34%, #101010))`,
      borderColor: trackColor,
    } : input.isSolidClip && input.clip.solidColor ? {
      background: input.clip.solidColor,
      borderColor: input.clip.solidColor,
    } : input.mediaLabelHex ? {
      background: input.mediaLabelHex,
      borderColor: input.mediaLabelHex,
    } : {}),
  } as CSSProperties & {
    '--track-color'?: string;
    '--clip-right-sticky-offset'?: string;
  };

  const sourceExtensionGhosts = useMemo(() => resolveSourceExtensionGhosts({
    enabled: input.passiveDecorationsEnabled,
    isTrimming: input.isTrimming,
    isLinkedToTrimming: input.isLinkedToTrimming,
    trimEdge: input.clipTrim?.edge,
    clipWidth: input.width,
    clipLeft: input.left,
    clipStartTime: input.clip.startTime,
    clipDuration: input.clip.duration,
    displayStartTime: input.displayStartTime,
    displayDuration: input.displayDuration,
    displayInPoint: input.displayInPoint,
    displayOutPoint: input.displayOutPoint,
    sourceDuration: getTimelineClipSourceDuration(input.clip),
    scrollX: input.scrollX,
    viewportWidth: input.renderTimelineViewportWidth,
    overscanPx: TIMELINE_RENDER_OVERSCAN_PX,
    timeToPixel: input.timeToPixel,
  }), [
    input.clip,
    input.clip.duration,
    input.clip.inPoint,
    input.clip.outPoint,
    input.clip.source?.naturalDuration,
    input.clip.startTime,
    input.clipTrim?.edge,
    input.displayDuration,
    input.displayInPoint,
    input.displayOutPoint,
    input.displayStartTime,
    input.isLinkedToTrimming,
    input.isTrimming,
    input.left,
    input.passiveDecorationsEnabled,
    input.renderTimelineViewportWidth,
    input.scrollX,
    input.timeToPixel,
    input.width,
  ]);

  return {
    clipClass,
    clipStyle,
    clipMetaOffset,
    sourceExtensionGhosts,
    isTrackLocked,
    isClipBodyDragging,
    canHandleTimelineToolPointer,
  };
}
