import { useEffect } from 'react';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import type { TimelineEmptyContextMenuState } from './types';

interface TimelineEmptyContextMenuProps {
  menu: TimelineEmptyContextMenuState | null;
  onClose: () => void;
  onEraseGap: (time: number, trackId: string) => void;
  onEraseLayerGaps: (time: number, trackId: string) => void;
  onEraseAllGaps: () => void;
  onFitCompToWindow: () => void;
}

export function TimelineEmptyContextMenu({
  menu,
  onClose,
  onEraseGap,
  onEraseLayerGaps,
  onEraseAllGaps,
  onFitCompToWindow,
}: TimelineEmptyContextMenuProps) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(menu);

  useEffect(() => {
    if (!menu) return;

    const handleClickOutside = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('contextmenu', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="timeline-context-menu"
      style={{
        position: 'fixed',
        left: adjustedPosition?.x ?? menu.x,
        top: adjustedPosition?.y ?? menu.y,
        zIndex: 10000,
      }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div
        className="context-menu-item"
        onClick={() => {
          onEraseGap(menu.time, menu.trackId);
          onClose();
        }}
      >
        Erase Space Between Clips
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          onEraseLayerGaps(menu.time, menu.trackId);
          onClose();
        }}
      >
        Erase Space Between All Clips in This Layer
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          onEraseAllGaps();
          onClose();
        }}
      >
        Erase Space Between All Clips
      </div>
      <div className="context-menu-separator" />
      <div
        className="context-menu-item"
        onClick={() => {
          onFitCompToWindow();
          onClose();
        }}
      >
        Fit Comp to Window
      </div>
    </div>
  );
}
