import { useEffect, useRef, type RefObject } from 'react';
import type { Message } from './types';

export function useAIChatScroll(
  messages: Message[],
  currentToolAction: string | null,
): RefObject<HTMLDivElement | null> {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentToolAction]);

  return messagesEndRef;
}

export function useAIChatLoadingFocusGuard(
  isLoading: boolean,
  panelRef: RefObject<HTMLDivElement | null>,
  shouldRefocusInputAfterLoadingRef: RefObject<boolean>,
): void {
  useEffect(() => {
    if (!isLoading) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        shouldRefocusInputAfterLoadingRef.current = false;
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isLoading, panelRef, shouldRefocusInputAfterLoadingRef]);
}
