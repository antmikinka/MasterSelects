import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { SelectorMenu } from './types';

export function useAIChatSelectorMenu(
  openSelectorMenu: SelectorMenu,
  setOpenSelectorMenu: Dispatch<SetStateAction<SelectorMenu>>,
): RefObject<HTMLDivElement | null> {
  const selectorMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openSelectorMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!selectorMenuRef.current?.contains(event.target as Node)) {
        setOpenSelectorMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenSelectorMenu(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openSelectorMenu, setOpenSelectorMenu]);

  return selectorMenuRef;
}
