import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { TimelineAudioDisplayMode, TimelineTrackFocusMode } from '../../../stores/timeline/types';
import type { TimelineTrack as TimelineTrackType } from '../../../types';
import { getTimelineTrackBaseHeight } from '../utils/timelineAudioLayout';
import {
  COLLAPSED_TRACK_HEIGHT,
  FOCUS_CONTEXT_SECTION_HEIGHT,
  MIN_SPLIT_SECTION_HEIGHT,
  NEW_TRACK_PREVIEW_MARGIN_PX,
  SPLIT_DIVIDER_HEIGHT,
} from '../utils/timelineHostConstants';
import { buildSectionScrollSnapPositions } from '../utils/timelineHostLayout';
import type { TrackSectionKind, TrackSectionMetrics } from '../utils/timelineHostTypes';
import { isAudioSectionTrackType } from '../utils/trackSection';

interface UseTimelineSectionLayoutProps {
  timelineViewTracks: TimelineTrackType[];
  trackFocusMode: TimelineTrackFocusMode;
  timelineSplitRatio: number | null;
  splitDragVideoHeight: number | null;
  videoViewportHeight: number;
  audioViewportHeight: number;
  splitViewportHeight: number;
  audioDisplayMode: TimelineAudioDisplayMode;
  audioFocusMode: boolean;
  clipDragNewTrackType: string | null;
  externalDragNewTrackType?: string | null;
  externalDragAudioTrackId?: string | null;
  keyframeLayoutInputs: unknown;
  getRenderedTrackBaseHeight: (track: TimelineTrackType) => number;
  getExpandedTrackHeight: (trackId: string, baseHeight: number) => number;
  isTrackExpandedForRender: (trackId: string) => boolean;
}

interface UseTimelineSectionViewportMeasurementProps {
  scrollWrapperRef: RefObject<HTMLDivElement | null>;
  timelineRef: RefObject<HTMLDivElement | null>;
  timelineBodyRef: RefObject<HTMLDivElement | null>;
  trackHeaderWidth: number;
  setTimelineViewportWidth: Dispatch<SetStateAction<number>>;
}

interface TimelineSectionLayout {
  timelineViewVideoTracks: TimelineTrackType[];
  timelineViewAudioTracks: TimelineTrackType[];
  displayedVideoTracks: TimelineTrackType[];
  displayedAudioTracks: TimelineTrackType[];
  isVideoSectionCollapsed: boolean;
  isAudioSectionCollapsed: boolean;
  isSectionCollapsed: (sectionKind: TrackSectionKind) => boolean;
  getFocusContextTrackHeight: (sectionKind: TrackSectionKind) => number;
  getSectionTrackBaseHeight: (track: TimelineTrackType, sectionKind: TrackSectionKind) => number;
  getSectionTrackHeight: (track: TimelineTrackType, sectionKind: TrackSectionKind) => number;
  clampSplitDragVideoHeight: (nextVideoHeight: number, availableHeight: number) => number;
  videoSectionMetrics: TrackSectionMetrics;
  audioSectionMetrics: TrackSectionMetrics;
  expandedVideoSectionContentHeight: number;
  audioScrollableContentHeight: number;
  audioNewTrackPreviewHeight: number;
  videoScrollSnapPositions: number[];
  audioScrollSnapPositions: number[];
  videoSectionHeight: number;
  audioSectionHeight: number;
}

function buildSectionMetrics(
  sectionTracks: TimelineTrackType[],
  sectionKind: TrackSectionKind,
  getSectionTrackHeight: (track: TimelineTrackType, sectionKind: TrackSectionKind) => number,
): TrackSectionMetrics {
  let totalHeight = 0;
  for (const track of sectionTracks) {
    totalHeight += getSectionTrackHeight(track, sectionKind);
  }
  return { contentHeight: totalHeight };
}

function getResizeObserverBlockSize(entry: ResizeObserverEntry): number {
  const borderBox = entry.borderBoxSize;
  const borderBoxSize = Array.isArray(borderBox) ? borderBox[0] : borderBox;
  return borderBoxSize?.blockSize ?? entry.contentRect.height;
}

function getResizeObserverInlineSize(entry: ResizeObserverEntry): number {
  const borderBox = entry.borderBoxSize;
  const borderBoxSize = Array.isArray(borderBox) ? borderBox[0] : borderBox;
  return borderBoxSize?.inlineSize ?? entry.contentRect.width;
}

export function useTimelineSectionLayout({
  timelineViewTracks,
  trackFocusMode,
  timelineSplitRatio,
  splitDragVideoHeight,
  videoViewportHeight,
  audioViewportHeight,
  splitViewportHeight,
  audioDisplayMode,
  audioFocusMode,
  clipDragNewTrackType,
  externalDragNewTrackType,
  externalDragAudioTrackId,
  keyframeLayoutInputs,
  getRenderedTrackBaseHeight,
  getExpandedTrackHeight,
  isTrackExpandedForRender,
}: UseTimelineSectionLayoutProps): TimelineSectionLayout {
  const isVideoSectionCollapsed = trackFocusMode === 'audio';
  const isAudioSectionCollapsed = trackFocusMode === 'video';
  const timelineViewVideoTracks = useMemo(
    () => timelineViewTracks.filter(track => track.type === 'video'),
    [timelineViewTracks],
  );
  const timelineViewAudioTracks = useMemo(
    () => timelineViewTracks.filter(track => isAudioSectionTrackType(track.type)),
    [timelineViewTracks],
  );
  const displayedVideoTracks = useMemo(() => timelineViewVideoTracks, [timelineViewVideoTracks]);
  const displayedAudioTracks = useMemo(() => timelineViewAudioTracks, [timelineViewAudioTracks]);

  const isSectionCollapsed = useCallback(
    (sectionKind: TrackSectionKind) => sectionKind === 'video' ? isVideoSectionCollapsed : isAudioSectionCollapsed,
    [isAudioSectionCollapsed, isVideoSectionCollapsed],
  );

  const getFocusContextTrackHeight = useCallback((sectionKind: TrackSectionKind) => {
    const trackCount = sectionKind === 'video' ? timelineViewVideoTracks.length : timelineViewAudioTracks.length;
    return trackCount > 0 ? FOCUS_CONTEXT_SECTION_HEIGHT / trackCount : FOCUS_CONTEXT_SECTION_HEIGHT;
  }, [timelineViewAudioTracks.length, timelineViewVideoTracks.length]);

  const getSectionTrackBaseHeight = useCallback(
    (track: TimelineTrackType, sectionKind: TrackSectionKind) =>
      isSectionCollapsed(sectionKind) ? getFocusContextTrackHeight(sectionKind) : getRenderedTrackBaseHeight(track),
    [getFocusContextTrackHeight, getRenderedTrackBaseHeight, isSectionCollapsed],
  );

  const getSectionTrackHeight = useCallback((track: TimelineTrackType, sectionKind: TrackSectionKind) => {
    void keyframeLayoutInputs;
    const baseHeight = getSectionTrackBaseHeight(track, sectionKind);
    if (isSectionCollapsed(sectionKind)) return baseHeight;
    return isTrackExpandedForRender(track.id) ? getExpandedTrackHeight(track.id, baseHeight) : baseHeight;
  }, [getExpandedTrackHeight, getSectionTrackBaseHeight, isSectionCollapsed, isTrackExpandedForRender, keyframeLayoutInputs]);

  const videoSectionMetrics = useMemo(
    () => buildSectionMetrics(displayedVideoTracks, 'video', getSectionTrackHeight),
    [displayedVideoTracks, getSectionTrackHeight],
  );
  const audioSectionMetrics = useMemo(
    () => buildSectionMetrics(displayedAudioTracks, 'audio', getSectionTrackHeight),
    [displayedAudioTracks, getSectionTrackHeight],
  );
  const expandedVideoSectionContentHeight = useMemo(() => {
    void keyframeLayoutInputs;
    return timelineViewVideoTracks.reduce((total, track) => {
      const baseHeight = getTimelineTrackBaseHeight(track, audioDisplayMode, false);
      return total + (isTrackExpandedForRender(track.id) ? getExpandedTrackHeight(track.id, baseHeight) : baseHeight);
    }, 0);
  }, [audioDisplayMode, getExpandedTrackHeight, isTrackExpandedForRender, keyframeLayoutInputs, timelineViewVideoTracks]);

  const audioNewTrackPreviewHeight = useMemo(
    () => getTimelineTrackBaseHeight({ type: 'audio', height: 40 }, audioDisplayMode, audioFocusMode),
    [audioDisplayMode, audioFocusMode],
  );
  const hasActiveAudioNewTrackPreview =
    clipDragNewTrackType === 'audio' ||
    externalDragNewTrackType === 'audio' ||
    externalDragAudioTrackId === '__new_audio_track__';
  const audioScrollableContentHeight = audioSectionMetrics.contentHeight + (
    hasActiveAudioNewTrackPreview ? audioNewTrackPreviewHeight + NEW_TRACK_PREVIEW_MARGIN_PX : 0
  );

  const videoScrollSnapPositions = useMemo(
    () => buildSectionScrollSnapPositions(
      displayedVideoTracks,
      'video',
      videoViewportHeight,
      videoSectionMetrics.contentHeight,
      (track) => getSectionTrackHeight(track, 'video'),
    ),
    [displayedVideoTracks, getSectionTrackHeight, videoSectionMetrics.contentHeight, videoViewportHeight],
  );
  const audioScrollSnapPositions = useMemo(
    () => buildSectionScrollSnapPositions(
      displayedAudioTracks,
      'audio',
      audioViewportHeight,
      audioScrollableContentHeight,
      (track) => getSectionTrackHeight(track, 'audio'),
    ),
    [audioScrollableContentHeight, audioViewportHeight, displayedAudioTracks, getSectionTrackHeight],
  );

  const clampSplitDragVideoHeight = useCallback((nextVideoHeight: number, availableHeight: number) => {
    const minVideoHeight = timelineViewVideoTracks.length > 0 ? COLLAPSED_TRACK_HEIGHT : 0;
    const minAudioHeight = timelineViewAudioTracks.length > 0 ? COLLAPSED_TRACK_HEIGHT : 0;
    const maxVideoHeight = Math.max(minVideoHeight, availableHeight - minAudioHeight);
    return Math.max(minVideoHeight, Math.min(maxVideoHeight, nextVideoHeight));
  }, [timelineViewAudioTracks.length, timelineViewVideoTracks.length]);

  const { videoSectionHeight, audioSectionHeight } = useMemo(() => {
    const availableHeight = Math.max(0, splitViewportHeight - SPLIT_DIVIDER_HEIGHT);
    const videoContentHeight = videoSectionMetrics.contentHeight;
    const audioContentHeight = audioSectionMetrics.contentHeight;
    if (splitDragVideoHeight !== null) {
      const videoHeight = clampSplitDragVideoHeight(splitDragVideoHeight, availableHeight);
      return { videoSectionHeight: videoHeight, audioSectionHeight: Math.max(0, availableHeight - videoHeight) };
    }
    if (trackFocusMode === 'balanced' && timelineSplitRatio !== null) {
      const ratioVideoHeight = clampSplitDragVideoHeight(availableHeight * timelineSplitRatio, availableHeight);
      const videoHeight = videoContentHeight > 0 ? Math.min(ratioVideoHeight, videoContentHeight) : ratioVideoHeight;
      return { videoSectionHeight: videoHeight, audioSectionHeight: Math.max(0, availableHeight - videoHeight) };
    }
    if (trackFocusMode === 'audio') {
      return { videoSectionHeight: videoContentHeight, audioSectionHeight: Math.max(0, availableHeight - videoContentHeight) };
    }
    if (trackFocusMode === 'video') {
      return { videoSectionHeight: Math.max(0, availableHeight - audioContentHeight), audioSectionHeight: audioContentHeight };
    }
    const totalContentHeight = videoContentHeight + audioContentHeight;
    if (totalContentHeight <= 0) return { videoSectionHeight: availableHeight / 2, audioSectionHeight: availableHeight / 2 };
    if (totalContentHeight <= availableHeight) {
      return { videoSectionHeight: videoContentHeight, audioSectionHeight: Math.max(0, availableHeight - videoContentHeight) };
    }
    if (videoContentHeight <= 0) return { videoSectionHeight: 0, audioSectionHeight: availableHeight };
    if (audioContentHeight <= 0) return { videoSectionHeight: availableHeight, audioSectionHeight: 0 };
    const minSectionHeight = Math.min(MIN_SPLIT_SECTION_HEIGHT, availableHeight / 2);
    const proportionalVideoHeight = availableHeight * (videoContentHeight / totalContentHeight);
    const videoHeight = Math.max(minSectionHeight, Math.min(availableHeight - minSectionHeight, proportionalVideoHeight));
    return { videoSectionHeight: videoHeight, audioSectionHeight: Math.max(0, availableHeight - videoHeight) };
  }, [
    audioSectionMetrics.contentHeight,
    clampSplitDragVideoHeight,
    splitDragVideoHeight,
    splitViewportHeight,
    timelineSplitRatio,
    trackFocusMode,
    videoSectionMetrics.contentHeight,
  ]);

  return {
    timelineViewVideoTracks,
    timelineViewAudioTracks,
    displayedVideoTracks,
    displayedAudioTracks,
    isVideoSectionCollapsed,
    isAudioSectionCollapsed,
    isSectionCollapsed,
    getFocusContextTrackHeight,
    getSectionTrackBaseHeight,
    getSectionTrackHeight,
    clampSplitDragVideoHeight,
    videoSectionMetrics,
    audioSectionMetrics,
    expandedVideoSectionContentHeight,
    audioScrollableContentHeight,
    audioNewTrackPreviewHeight,
    videoScrollSnapPositions,
    audioScrollSnapPositions,
    videoSectionHeight,
    audioSectionHeight,
  };
}

export function useTimelineSectionViewportMeasurement({
  scrollWrapperRef,
  timelineRef,
  timelineBodyRef,
  trackHeaderWidth,
  setTimelineViewportWidth,
}: UseTimelineSectionViewportMeasurementProps) {
  const videoSectionViewportRef = useRef<HTMLDivElement>(null);
  const audioSectionViewportRef = useRef<HTMLDivElement>(null);
  const [videoViewportHeight, setVideoViewportHeight] = useState(160);
  const [audioViewportHeight, setAudioViewportHeight] = useState(160);
  const [splitViewportHeight, setSplitViewportHeight] = useState(320);

  useLayoutEffect(() => {
    const updateViewportHeights = (entryByElement?: Map<Element, ResizeObserverEntry>) => {
      const scrollWrapper = scrollWrapperRef.current;
      const timeline = timelineRef.current;
      const timelineBody = timelineBodyRef.current;
      const videoViewport = videoSectionViewportRef.current;
      const audioViewport = audioSectionViewportRef.current;

      if (scrollWrapper) {
        const entry = entryByElement?.get(scrollWrapper);
        setSplitViewportHeight(entry ? getResizeObserverBlockSize(entry) : scrollWrapper.clientHeight);
      }
      if (videoViewport) {
        const entry = entryByElement?.get(videoViewport);
        setVideoViewportHeight(entry ? getResizeObserverBlockSize(entry) : videoViewport.clientHeight);
      }
      if (audioViewport) {
        const entry = entryByElement?.get(audioViewport);
        setAudioViewportHeight(entry ? getResizeObserverBlockSize(entry) : audioViewport.clientHeight);
      }

      const timelineEntry = timeline ? entryByElement?.get(timeline) : undefined;
      const timelineBodyEntry = timelineBody ? entryByElement?.get(timelineBody) : undefined;
      const nextTimelineViewportWidth =
        (timelineEntry ? getResizeObserverInlineSize(timelineEntry) : timeline?.clientWidth) ??
        (timelineBody
          ? (timelineBodyEntry ? getResizeObserverInlineSize(timelineBodyEntry) : timelineBody.clientWidth) - trackHeaderWidth
          : null);
      if (nextTimelineViewportWidth && nextTimelineViewportWidth > 0) {
        setTimelineViewportWidth(Math.max(1, nextTimelineViewportWidth));
      }
    };
    updateViewportHeights();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          const entryByElement = new Map<Element, ResizeObserverEntry>();
          entries.forEach((entry) => entryByElement.set(entry.target, entry));
          updateViewportHeights(entryByElement);
        })
      : null;
    [scrollWrapperRef.current, timelineRef.current, timelineBodyRef.current, videoSectionViewportRef.current, audioSectionViewportRef.current]
      .forEach((element) => {
        if (element) observer?.observe(element);
      });
    const handleWindowResize = () => updateViewportHeights();
    window.addEventListener('resize', handleWindowResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [scrollWrapperRef, setTimelineViewportWidth, timelineBodyRef, timelineRef, trackHeaderWidth]);

  return {
    videoSectionViewportRef,
    audioSectionViewportRef,
    videoViewportHeight,
    audioViewportHeight,
    splitViewportHeight,
  };
}
