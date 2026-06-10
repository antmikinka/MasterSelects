// Scene overlay gizmo pointer handlers — axis/ring/center mouse interactions
// that resolve hit targets and reset plans, then delegate drag starts and
// transform resets back to the overlay entry (which owns the pointer-lock core).

import {
  useCallback,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { TimelineClip } from '../../../types/timeline';
import type { ClipTransform } from '../../../types/timelineCore';
import type {
  PreviewSceneObject,
  SceneAxisScreenHandle,
  SceneGizmoAxis,
  SceneGizmoMode,
} from '../sceneObjectOverlayMath';
import {
  CENTER_SCALE_DIRECTION,
  getAveragePixelsPerUnit,
  resolveCenterFreePixelsPerUnit,
} from './sceneOverlayDisplayPlans';
import {
  getPointToRingAngle,
  getRotateRingEventPoint,
  resolveNearestRotateRing,
} from './sceneOverlayProjectionPlans';
import {
  buildAxisResetTransform,
  buildCenterResetTransform,
} from './sceneOverlayTransformPlans';
import type {
  ClipTransformPatch,
  ProjectedRotateRing,
  SceneGizmoDragStartParams,
} from './sceneOverlayTypes';

interface UseSceneOverlayGizmoHandlersParams {
  clips: TimelineClip[];
  selectedClipId: string | null;
  selectedObject: PreviewSceneObject | null;
  mode: SceneGizmoMode;
  axisHandles: SceneAxisScreenHandle[];
  rotateRings: ProjectedRotateRing[];
  selectClip: (id: string | null, addToSelection?: boolean, setPrimaryOnly?: boolean) => void;
  onSetObjectOrbitPivot?: (object: PreviewSceneObject) => boolean;
  getObjectTransform: (object: PreviewSceneObject, clip: TimelineClip) => ClipTransform;
  resetObjectTransform: (
    clipId: string,
    modeToReset: SceneGizmoMode,
    transform: ClipTransformPatch,
  ) => void;
  startGizmoDrag: (params: SceneGizmoDragStartParams) => void;
  updateHoveredAxis: (axis: SceneGizmoAxis | null) => void;
}

export function useSceneOverlayGizmoHandlers({
  clips,
  selectedClipId,
  selectedObject,
  mode,
  axisHandles,
  rotateRings,
  selectClip,
  onSetObjectOrbitPivot,
  getObjectTransform,
  resetObjectTransform,
  startGizmoDrag,
  updateHoveredAxis,
}: UseSceneOverlayGizmoHandlersParams) {
  const handleObjectPointerDown = useCallback((event: ReactPointerEvent, object: PreviewSceneObject) => {
    event.preventDefault();
    event.stopPropagation();
    selectClip(object.clipId, event.shiftKey);
  }, [selectClip]);

  const handleAxisMouseDown = useCallback((event: ReactMouseEvent<Element>, handle: SceneAxisScreenHandle) => {
    if (event.button !== 0) return;
    if (!selectedObject) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.detail > 1) {
      onSetObjectOrbitPivot?.(selectedObject);
      return;
    }

    startGizmoDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: event.currentTarget,
      object: selectedObject,
      axis: handle.axis,
      direction: handle.direction,
      axisVector: handle.axisVector,
      pixelsPerUnit: handle.pixelsPerUnit,
      freePixelsPerUnit: { x: handle.pixelsPerUnit, y: handle.pixelsPerUnit },
    });
  }, [onSetObjectOrbitPivot, selectedObject, startGizmoDrag]);

  const handleAxisDoubleClick = useCallback((event: ReactMouseEvent<Element>, handle: SceneAxisScreenHandle) => {
    if (!selectedObject) return;

    if (onSetObjectOrbitPivot?.(selectedObject)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const clip = clips.find((candidate) => candidate.id === selectedObject.clipId);
    if (!clip) return;

    event.preventDefault();
    event.stopPropagation();
    resetObjectTransform(
      selectedObject.clipId,
      mode,
      buildAxisResetTransform(mode, handle.axis, selectedObject, getObjectTransform(selectedObject, clip)),
    );
  }, [clips, getObjectTransform, mode, onSetObjectOrbitPivot, resetObjectTransform, selectedObject]);

  const resolveRotateRingFromEvent = useCallback((event: ReactMouseEvent<SVGSVGElement>) => (
    resolveNearestRotateRing(getRotateRingEventPoint(event), rotateRings)
  ), [rotateRings]);

  const handleRotateRingMouseMove = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    const ring = resolveRotateRingFromEvent(event);
    updateHoveredAxis(ring?.axis ?? null);
  }, [resolveRotateRingFromEvent, updateHoveredAxis]);

  const handleRotateRingMouseDown = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (!selectedObject) return;
    const ring = resolveRotateRingFromEvent(event);
    if (!ring) {
      updateHoveredAxis(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.detail > 1) {
      onSetObjectOrbitPivot?.(selectedObject);
      return;
    }

    const point = getRotateRingEventPoint(event);
    const startAngle = getPointToRingAngle(point, ring);
    const rect = event.currentTarget.getBoundingClientRect();
    updateHoveredAxis(ring.axis);
    startGizmoDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: event.currentTarget,
      object: selectedObject,
      axis: ring.axis,
      direction: ring.handle.direction,
      axisVector: ring.handle.axisVector,
      pixelsPerUnit: ring.handle.pixelsPerUnit,
      freePixelsPerUnit: { x: ring.handle.pixelsPerUnit, y: ring.handle.pixelsPerUnit },
      ...(startAngle !== null
        ? {
            rotationRingClientRect: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
            rotationRingPoints: ring.points,
            rotationStartRingAngle: startAngle,
          }
        : {}),
    });
  }, [onSetObjectOrbitPivot, resolveRotateRingFromEvent, selectedObject, startGizmoDrag, updateHoveredAxis]);

  const handleRotateRingDoubleClick = useCallback((event: ReactMouseEvent<SVGSVGElement>) => {
    const ring = resolveRotateRingFromEvent(event);
    if (!ring) {
      updateHoveredAxis(null);
      return;
    }

    updateHoveredAxis(ring.axis);
    handleAxisDoubleClick(event, ring.handle);
  }, [handleAxisDoubleClick, resolveRotateRingFromEvent, updateHoveredAxis]);

  const handleCenterPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, object: PreviewSceneObject) => {
    if (event.button !== 0) return;

    if (event.detail > 1) {
      onSetObjectOrbitPivot?.(object);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (object.clipId !== selectedClipId || (mode !== 'move' && mode !== 'scale')) {
      handleObjectPointerDown(event, object);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const freePixelsPerUnit = resolveCenterFreePixelsPerUnit(axisHandles);
    startGizmoDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: event.currentTarget,
      object,
      axis: 'all',
      direction: mode === 'scale' ? CENTER_SCALE_DIRECTION : { x: 1, y: 0 },
      axisVector: { x: 0, y: 0, z: 0 },
      pixelsPerUnit: getAveragePixelsPerUnit(freePixelsPerUnit),
      freePixelsPerUnit,
    });
  }, [axisHandles, handleObjectPointerDown, mode, onSetObjectOrbitPivot, selectedClipId, startGizmoDrag]);

  const handleCenterDoubleClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>, object: PreviewSceneObject) => {
    if (onSetObjectOrbitPivot?.(object)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (object.clipId !== selectedClipId) return;
    const clip = clips.find((candidate) => candidate.id === object.clipId);
    if (!clip) return;

    event.preventDefault();
    event.stopPropagation();
    resetObjectTransform(
      object.clipId,
      mode,
      buildCenterResetTransform(mode, object, getObjectTransform(object, clip)),
    );
  }, [clips, getObjectTransform, mode, onSetObjectOrbitPivot, resetObjectTransform, selectedClipId]);

  return {
    handleObjectPointerDown,
    handleAxisMouseDown,
    handleAxisDoubleClick,
    handleRotateRingMouseMove,
    handleRotateRingMouseDown,
    handleRotateRingDoubleClick,
    handleCenterPointerDown,
    handleCenterDoubleClick,
  };
}
