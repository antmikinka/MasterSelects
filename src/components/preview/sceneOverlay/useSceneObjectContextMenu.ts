import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import type { PreviewSceneObject } from '../sceneObjectOverlayMath';
import type { ObjectContextMenuState } from './sceneOverlayTypes';

interface UseSceneObjectContextMenuParams {
  canSetObjectOrbitPivot: boolean;
  overlayRef: RefObject<HTMLDivElement | null>;
  onSetObjectOrbitPivot?: (object: PreviewSceneObject) => boolean;
}

export function useSceneObjectContextMenu({
  canSetObjectOrbitPivot,
  overlayRef,
  onSetObjectOrbitPivot,
}: UseSceneObjectContextMenuParams) {
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [objectContextMenu, setObjectContextMenu] = useState<ObjectContextMenuState | null>(null);

  useEffect(() => {
    if (!objectContextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && contextMenuRef.current?.contains(target)) {
        return;
      }
      setObjectContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setObjectContextMenu(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [objectContextMenu]);

  const openObjectContextMenu = useCallback((event: ReactMouseEvent<Element>, object: PreviewSceneObject) => {
    if (!canSetObjectOrbitPivot || object.kind === 'camera') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const overlayRect = overlayRef.current?.getBoundingClientRect();
    setObjectContextMenu({
      x: overlayRect ? event.clientX - overlayRect.left : event.clientX,
      y: overlayRect ? event.clientY - overlayRect.top : event.clientY,
      object,
    });
  }, [canSetObjectOrbitPivot, overlayRef]);

  const setContextMenuObjectOrbitPivot = useCallback(() => {
    if (!objectContextMenu) return;
    onSetObjectOrbitPivot?.(objectContextMenu.object);
    setObjectContextMenu(null);
  }, [objectContextMenu, onSetObjectOrbitPivot]);

  return {
    contextMenuRef,
    objectContextMenu,
    openObjectContextMenu,
    setContextMenuObjectOrbitPivot,
  };
}
