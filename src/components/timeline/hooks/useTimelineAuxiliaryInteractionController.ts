import { usePickWhipDrag } from './usePickWhipDrag';
import { useTimelineAuxiliaryLayerProps } from './useTimelineAuxiliaryLayerProps';
import { useTimelineAuxiliaryMenuState } from './useTimelineAuxiliaryMenuState';
import { useTimelineRightDragScrub } from './useTimelineRightDragScrub';

type AuxiliaryLayerParams = Parameters<typeof useTimelineAuxiliaryLayerProps>[0];
type AuxiliaryMenuParams = Parameters<typeof useTimelineAuxiliaryMenuState>[0];
type PickWhipParams = Parameters<typeof usePickWhipDrag>[0];
type RightDragScrubParams = Parameters<typeof useTimelineRightDragScrub>[0];

interface UseTimelineAuxiliaryInteractionControllerParams extends Omit<
  AuxiliaryLayerParams,
  | 'contextMenu'
  | 'emptyContextMenu'
  | 'handleDeleteInOutPoint'
  | 'inOutContextMenu'
  | 'markerContextMenu'
  | 'multicamDialogOpen'
  | 'pickWhipProps'
  | 'setContextMenu'
  | 'setEmptyContextMenu'
  | 'setInOutContextMenu'
  | 'setMarkerContextMenu'
  | 'setMulticamDialogOpen'
  | 'setTrackContextMenu'
  | 'trackContextMenu'
> {
  cancelRamPreview: RightDragScrubParams['cancelRamPreview'];
  duration: RightDragScrubParams['duration'];
  handleClipMouseDown: RightDragScrubParams['handleClipMouseDown'];
  isExporting: AuxiliaryMenuParams['isExporting'];
  isPlaying: RightDragScrubParams['isPlaying'];
  isRamPreviewing: RightDragScrubParams['isRamPreviewing'];
  pause: RightDragScrubParams['pause'];
  pixelToTime: RightDragScrubParams['pixelToTime'];
  scrollX: RightDragScrubParams['scrollX'];
  setClipParent: PickWhipParams['setClipParent'];
  setDraggingPlayhead: RightDragScrubParams['setDraggingPlayhead'];
  setInPoint: AuxiliaryMenuParams['setInPoint'];
  setOutPoint: AuxiliaryMenuParams['setOutPoint'];
  setPlayheadPosition: RightDragScrubParams['setPlayheadPosition'];
  setTrackParent: PickWhipParams['setTrackParent'];
  timelineRef: RightDragScrubParams['timelineRef'];
}

export function useTimelineAuxiliaryInteractionController({
  cancelRamPreview,
  duration,
  handleClipMouseDown,
  isExporting,
  isPlaying,
  isRamPreviewing,
  pause,
  pixelToTime,
  scrollX,
  selectedClipIds,
  selectClip,
  setClipParent,
  setDraggingPlayhead,
  setInPoint,
  setOutPoint,
  setPlayheadPosition,
  setTrackParent,
  timelineRef,
  ...auxiliaryLayerParams
}: UseTimelineAuxiliaryInteractionControllerParams) {
  const {
    contextMenu,
    setContextMenu,
    emptyContextMenu,
    setEmptyContextMenu,
    trackContextMenu,
    setTrackContextMenu,
    markerContextMenu,
    setMarkerContextMenu,
    inOutContextMenu,
    setInOutContextMenu,
    multicamDialogOpen,
    setMulticamDialogOpen,
    openClipContextMenu,
    closeTimelineContextMenus,
    handleInOutMarkerContextMenu,
    handleTimelineMarkerContextMenu,
    handleDeleteInOutPoint,
  } = useTimelineAuxiliaryMenuState({
    selectedClipIds,
    selectClip,
    isExporting,
    setInPoint,
    setOutPoint,
  });

  const {
    handleEmptyTimelineMouseDown,
    handleEmptyTimelineContextMenu,
    handleClipContextMenu,
    handleTimelineClipMouseDown,
  } = useTimelineRightDragScrub({
    timelineRef,
    scrollX,
    duration,
    isExporting,
    isPlaying,
    isRamPreviewing,
    pixelToTime,
    pause,
    cancelRamPreview,
    setDraggingPlayhead,
    setPlayheadPosition,
    closeTimelineContextMenus,
    setEmptyContextMenu,
    openClipContextMenu,
    handleClipMouseDown,
  });

  const {
    pickWhipDrag,
    trackPickWhipDrag,
    handleTrackPickWhipDragStart,
    handleTrackPickWhipDragEnd,
  } = usePickWhipDrag({ setClipParent, setTrackParent });

  const auxiliaryLayerProps = useTimelineAuxiliaryLayerProps({
    ...auxiliaryLayerParams,
    contextMenu,
    setContextMenu,
    emptyContextMenu,
    setEmptyContextMenu,
    trackContextMenu,
    setTrackContextMenu,
    markerContextMenu,
    setMarkerContextMenu,
    inOutContextMenu,
    setInOutContextMenu,
    multicamDialogOpen,
    setMulticamDialogOpen,
    handleDeleteInOutPoint,
    pickWhipProps: { pickWhipDrag, trackPickWhipDrag },
    selectedClipIds,
    selectClip,
  });

  return {
    auxiliaryLayerProps,
    contextMenu,
    setContextMenu,
    setEmptyContextMenu,
    setInOutContextMenu,
    setMarkerContextMenu,
    setTrackContextMenu,
    handleClipContextMenu,
    handleEmptyTimelineContextMenu,
    handleEmptyTimelineMouseDown,
    handleInOutMarkerContextMenu,
    handleTimelineClipMouseDown,
    handleTimelineMarkerContextMenu,
    handleTrackPickWhipDragEnd,
    handleTrackPickWhipDragStart,
  };
}
