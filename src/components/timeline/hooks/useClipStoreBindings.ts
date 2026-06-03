import type { TimelineClip } from '../../../types';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { resolveClipLabelHex } from '../utils/resolveClipLabelHex';
import { isTimelineBladeTool } from '../tools/pointer/timelineToolPointerDispatcher';

const EMPTY_CLIP_KEYFRAMES = [] as const;

export function useClipStoreBindings(clip: TimelineClip) {
  const thumbnailsEnabled = useTimelineStore(state => state.thumbnailsEnabled);
  const waveformsEnabled = useTimelineStore(state => state.waveformsEnabled);
  const audioDisplayMode = useTimelineStore(state => state.audioDisplayMode);
  const audioFocusMode = useTimelineStore(state => state.audioFocusMode);
  const trackFocusMode = useTimelineStore(state => state.trackFocusMode);
  const showAudioRegionEditMarkers = useTimelineStore(state => state.showAudioRegionEditMarkers);
  const activeTimelineToolId = useTimelineStore(state => state.activeTimelineToolId);
  const timelineToolPreview = useTimelineStore(state => state.timelineToolPreview);
  const isBladeToolActive = isTimelineBladeTool(activeTimelineToolId);
  const playheadPosition = useTimelineStore(state => isBladeToolActive ? state.playheadPosition : 0);
  const clipStemSeparationJob = useTimelineStore(state => {
    const directJob = state.clipStemSeparationJobs[clip.id];
    if (directJob && (directJob.clipId === clip.id || directJob.requestedClipId === clip.id)) {
      return directJob;
    }

    const linkedJob = clip.linkedClipId ? state.clipStemSeparationJobs[clip.linkedClipId] : undefined;
    if (linkedJob && (linkedJob.clipId === clip.id || linkedJob.requestedClipId === clip.id || linkedJob.clipId === clip.linkedClipId)) {
      return linkedJob;
    }

    return Object.values(state.clipStemSeparationJobs).find(job =>
      job.clipId === clip.id ||
      job.requestedClipId === clip.id ||
      (clip.linkedClipId ? job.clipId === clip.linkedClipId || job.requestedClipId === clip.linkedClipId : false)
    ) ?? null;
  });
  const setTimelineToolPreview = useTimelineStore(state => state.setTimelineToolPreview);
  const applyTimelineEditOperation = useTimelineStore(state => state.applyTimelineEditOperation);
  const setActiveTimelineTool = useTimelineStore(state => state.setActiveTimelineTool);
  const timelineTrackColorsVisible = useTimelineStore(state => state.audioLayerAdvancedMode !== false);
  const audioRegionSelection = useTimelineStore(state =>
    state.audioRegionSelection?.clipId === clip.id ? state.audioRegionSelection : null
  );
  const audioRegionGainPreview = useTimelineStore(state =>
    state.audioRegionGainPreview?.clipId === clip.id ? state.audioRegionGainPreview : null
  );
  const audioSpectralRegionSelection = useTimelineStore(state =>
    state.audioSpectralRegionSelection?.clipId === clip.id ? state.audioSpectralRegionSelection : null
  );
  const videoBakeRegionSelection = useTimelineStore(state =>
    state.videoBakeRegionSelection?.scope === 'clip' && state.videoBakeRegionSelection.clipId === clip.id
      ? state.videoBakeRegionSelection
      : null
  );
  const setAudioRegionSelection = useTimelineStore(state => state.setAudioRegionSelection);
  const clearAudioRegionSelection = useTimelineStore(state => state.clearAudioRegionSelection);
  const setVideoBakeRegionSelection = useTimelineStore(state => state.setVideoBakeRegionSelection);
  const clearVideoBakeRegionSelection = useTimelineStore(state => state.clearVideoBakeRegionSelection);
  const addClipVideoBakeRegion = useTimelineStore(state => state.addClipVideoBakeRegion);
  const bakeClipVideoBakeRegion = useTimelineStore(state => state.bakeClipVideoBakeRegion);
  const unbakeClipVideoBakeRegion = useTimelineStore(state => state.unbakeClipVideoBakeRegion);
  const removeClipVideoBakeRegion = useTimelineStore(state => state.removeClipVideoBakeRegion);
  const setAudioSpectralRegionSelection = useTimelineStore(state => state.setAudioSpectralRegionSelection);
  const clearAudioSpectralRegionSelection = useTimelineStore(state => state.clearAudioSpectralRegionSelection);
  const hasAudioRegionClipboard = useTimelineStore(state => state.audioRegionClipboard !== null);
  const applyAudioRegionEdit = useTimelineStore(state => state.applyAudioRegionEdit);
  const setAudioRegionGainPreview = useTimelineStore(state => state.setAudioRegionGainPreview);
  const clearAudioRegionGainPreview = useTimelineStore(state => state.clearAudioRegionGainPreview);
  const setAudioRegionGainEdit = useTimelineStore(state => state.setAudioRegionGainEdit);
  const applySpectralRegionEdit = useTimelineStore(state => state.applySpectralRegionEdit);
  const addClipSpectralImageLayer = useTimelineStore(state => state.addClipSpectralImageLayer);
  const copySelectedAudioRegion = useTimelineStore(state => state.copySelectedAudioRegion);
  const pasteAudioRegionToSelection = useTimelineStore(state => state.pasteAudioRegionToSelection);
  const setClipAudioEditOperationEnabled = useTimelineStore(state => state.setClipAudioEditOperationEnabled);
  const setClipAudioEditOperationRange = useTimelineStore(state => state.setClipAudioEditOperationRange);
  const removeClipAudioEditOperation = useTimelineStore(state => state.removeClipAudioEditOperation);
  const clearClipAudioEditStack = useTimelineStore(state => state.clearClipAudioEditStack);
  const bakeClipAudioEditStack = useTimelineStore(state => state.bakeClipAudioEditStack);
  const unbakeClipAudioEditStack = useTimelineStore(state => state.unbakeClipAudioEditStack);
  const setClipSourceToStem = useTimelineStore(state => state.setClipSourceToStem);
  const prewarmStemSourceMediaFiles = useTimelineStore(state => state.prewarmStemSourceMediaFiles);
  const mediaFiles = useMediaStore(state => state.files);
  const mediaLabelHex = useMediaStore(state => resolveClipLabelHex(clip, state));
  const selectClip = useTimelineStore(state => state.selectClip);
  const clipAudioKeyframes = useTimelineStore(state => state.clipKeyframes.get(clip.id) ?? EMPTY_CLIP_KEYFRAMES);

  return {
    thumbnailsEnabled,
    waveformsEnabled,
    audioDisplayMode,
    audioFocusMode,
    trackFocusMode,
    showAudioRegionEditMarkers,
    activeTimelineToolId,
    timelineToolPreview,
    isBladeToolActive,
    playheadPosition,
    clipStemSeparationJob,
    setTimelineToolPreview,
    applyTimelineEditOperation,
    setActiveTimelineTool,
    timelineTrackColorsVisible,
    audioRegionSelection,
    audioRegionGainPreview,
    audioSpectralRegionSelection,
    videoBakeRegionSelection,
    setAudioRegionSelection,
    clearAudioRegionSelection,
    setVideoBakeRegionSelection,
    clearVideoBakeRegionSelection,
    addClipVideoBakeRegion,
    bakeClipVideoBakeRegion,
    unbakeClipVideoBakeRegion,
    removeClipVideoBakeRegion,
    setAudioSpectralRegionSelection,
    clearAudioSpectralRegionSelection,
    hasAudioRegionClipboard,
    applyAudioRegionEdit,
    setAudioRegionGainPreview,
    clearAudioRegionGainPreview,
    setAudioRegionGainEdit,
    applySpectralRegionEdit,
    addClipSpectralImageLayer,
    copySelectedAudioRegion,
    pasteAudioRegionToSelection,
    setClipAudioEditOperationEnabled,
    setClipAudioEditOperationRange,
    removeClipAudioEditOperation,
    clearClipAudioEditStack,
    bakeClipAudioEditStack,
    unbakeClipAudioEditStack,
    setClipSourceToStem,
    prewarmStemSourceMediaFiles,
    mediaFiles,
    mediaLabelHex,
    selectClip,
    clipAudioKeyframes,
  };
}
