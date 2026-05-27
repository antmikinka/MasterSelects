// Root dock container - wraps docked panels and renders floating panels

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { DOCK_LAYOUT_TRANSITION_EVENT, useDockStore } from '../../stores/dockStore';
import type { DropTarget } from '../../types/dock';
import { calculateRootEdgeDropPosition } from '../../utils/dockLayout';
import { DockNode } from './DockNode';
import { FloatingPanel } from './FloatingPanel';
import { getShortcutRegistry } from '../../services/shortcutRegistry';
import './dock.css';

interface DockLayoutAnimationRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DockLayoutAnimationItem {
  id: string;
  title: string;
  rect: DockLayoutAnimationRect;
}

interface DockLayoutAnimationSnapshot {
  durationMs: number;
  items: Map<string, DockLayoutAnimationItem>;
}

const DOCK_LAYOUT_ANIMATION_SELECTOR = '[data-dock-layout-anim-id]';
const DOCK_LAYOUT_ANIMATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function toAnimationRect(rect: DOMRect): DockLayoutAnimationRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function captureDockLayoutAnimationSnapshot(container: HTMLElement, durationMs: number): DockLayoutAnimationSnapshot {
  const items = new Map<string, DockLayoutAnimationItem>();
  const elements = container.querySelectorAll<HTMLElement>(DOCK_LAYOUT_ANIMATION_SELECTOR);

  elements.forEach((element) => {
    const id = element.dataset.dockLayoutAnimId;
    if (!id || items.has(id)) return;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    items.set(id, {
      id,
      title: element.dataset.dockLayoutAnimTitle ?? '',
      rect: toAnimationRect(rect),
    });
  });

  return { durationMs, items };
}

function createDockLayoutExitGhost(
  container: HTMLElement,
  item: DockLayoutAnimationItem,
  durationMs: number,
): Animation | null {
  const containerRect = container.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'dock-layout-transition-ghost';
  ghost.textContent = item.title;
  ghost.style.left = `${item.rect.left - containerRect.left}px`;
  ghost.style.top = `${item.rect.top - containerRect.top}px`;
  ghost.style.width = `${item.rect.width}px`;
  ghost.style.height = `${item.rect.height}px`;
  container.appendChild(ghost);

  const animation = ghost.animate(
    [
      { opacity: 0.82, transform: 'translate3d(0, 0, 0) scale(1)' },
      { opacity: 0, transform: 'translate3d(0, 10px, 0) scale(0.96)' },
    ],
    {
      duration: Math.min(durationMs, 360),
      easing: 'cubic-bezier(0.4, 0, 0.22, 1)',
      fill: 'forwards',
    },
  );
  const removeGhost = () => ghost.remove();
  animation.addEventListener('finish', removeGhost, { once: true });
  animation.addEventListener('cancel', removeGhost, { once: true });
  return animation;
}

function animateDockLayoutTransition(container: HTMLElement, snapshot: DockLayoutAnimationSnapshot): Animation[] {
  if (
    typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return [];
  }

  const animations: Animation[] = [];
  const nextIds = new Set<string>();
  const nextElements = container.querySelectorAll<HTMLElement>(DOCK_LAYOUT_ANIMATION_SELECTOR);

  nextElements.forEach((element) => {
    const id = element.dataset.dockLayoutAnimId;
    if (!id) return;

    nextIds.add(id);
    const previous = snapshot.items.get(id);
    const nextRect = element.getBoundingClientRect();
    if (nextRect.width <= 0 || nextRect.height <= 0) return;

    if (previous) {
      const deltaX = previous.rect.left - nextRect.left;
      const deltaY = previous.rect.top - nextRect.top;
      const scaleX = previous.rect.width / nextRect.width;
      const scaleY = previous.rect.height / nextRect.height;
      const didMove = Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5;
      const didResize = Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;

      if (!didMove && !didResize) return;

      animations.push(element.animate(
        [
          {
            transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
            opacity: 0.94,
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1, 1)',
            opacity: 1,
          },
        ],
        {
          duration: snapshot.durationMs,
          easing: DOCK_LAYOUT_ANIMATION_EASING,
        },
      ));
      return;
    }

    animations.push(element.animate(
      [
        { opacity: 0, transform: 'translate3d(0, 12px, 0) scale(0.97)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
      ],
      {
        duration: Math.min(snapshot.durationMs, 420),
        easing: DOCK_LAYOUT_ANIMATION_EASING,
      },
    ));
  });

  snapshot.items.forEach((item, id) => {
    if (nextIds.has(id)) return;
    const ghostAnimation = createDockLayoutExitGhost(container, item, snapshot.durationMs);
    if (ghostAnimation) {
      animations.push(ghostAnimation);
    }
  });

  return animations;
}

export function DockContainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const maximizeAnimationTimeoutRef = useRef<number | null>(null);
  const layoutAnimationTimeoutRef = useRef<number | null>(null);
  const pendingLayoutAnimationRef = useRef<DockLayoutAnimationSnapshot | null>(null);
  const { layout, dragState, endDrag, cancelDrag, updateDrag, toggleHoveredTabMaximized, maximizedPanelId } = useDockStore();

  const getRootEdgeDropTarget = useCallback((mouseX: number, mouseY: number): DropTarget | null => {
    const container = containerRef.current;
    if (!container) return null;

    const position = calculateRootEdgeDropPosition(container.getBoundingClientRect(), mouseX, mouseY);
    if (!position) return null;

    return {
      groupId: layout.root.id,
      position,
      scope: 'root-edge',
    };
  }, [layout.root.id]);

  const rootEdgeDropPosition = dragState.dropTarget?.scope === 'root-edge'
    ? dragState.dropTarget.position
    : null;

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    container.classList.add('maximize-animating');
    if (maximizeAnimationTimeoutRef.current) {
      window.clearTimeout(maximizeAnimationTimeoutRef.current);
    }
    maximizeAnimationTimeoutRef.current = window.setTimeout(() => {
      container.classList.remove('maximize-animating');
      maximizeAnimationTimeoutRef.current = null;
    }, 320);

    return () => {
      if (maximizeAnimationTimeoutRef.current) {
        window.clearTimeout(maximizeAnimationTimeoutRef.current);
        maximizeAnimationTimeoutRef.current = null;
      }
      container.classList.remove('maximize-animating');
    };
  }, [maximizedPanelId]);

  useEffect(() => {
    const handleLayoutTransition = (event: Event) => {
      const container = containerRef.current;
      if (!container) return;

      const durationMs = event instanceof CustomEvent && typeof event.detail?.durationMs === 'number'
        ? event.detail.durationMs
        : 500;
      pendingLayoutAnimationRef.current = captureDockLayoutAnimationSnapshot(container, durationMs);
      container.classList.add('layout-switch-animating');
    };

    window.addEventListener(DOCK_LAYOUT_TRANSITION_EVENT, handleLayoutTransition);
    return () => {
      window.removeEventListener(DOCK_LAYOUT_TRANSITION_EVENT, handleLayoutTransition);
    };
  }, []);

  useLayoutEffect(() => {
    const snapshot = pendingLayoutAnimationRef.current;
    if (!snapshot) return;

    pendingLayoutAnimationRef.current = null;
    const container = containerRef.current;
    if (!container) return;

    if (layoutAnimationTimeoutRef.current) {
      window.clearTimeout(layoutAnimationTimeoutRef.current);
      layoutAnimationTimeoutRef.current = null;
    }

    const animations = animateDockLayoutTransition(container, snapshot);
    layoutAnimationTimeoutRef.current = window.setTimeout(() => {
      animations.forEach((animation) => animation.cancel());
      container.classList.remove('layout-switch-animating');
      layoutAnimationTimeoutRef.current = null;
    }, snapshot.durationMs + 80);
  }, [layout]);

  useEffect(() => () => {
    if (layoutAnimationTimeoutRef.current) {
      window.clearTimeout(layoutAnimationTimeoutRef.current);
      layoutAnimationTimeoutRef.current = null;
    }
    containerRef.current?.classList.remove('layout-switch-animating');
  }, []);

  // Global mouse handlers for drag operations
  useEffect(() => {
    const registry = getShortcutRegistry();

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.isDragging) return;

      const rootEdgeTarget = getRootEdgeDropTarget(e.clientX, e.clientY);
      const nextDropTarget = rootEdgeTarget
        ?? (dragState.dropTarget?.scope === 'root-edge' ? null : dragState.dropTarget);

      updateDrag({ x: e.clientX, y: e.clientY }, nextDropTarget);
    };

    const handleMouseUp = () => {
      if (!dragState.isDragging) return;
      endDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        !!target?.isContentEditable;

      if (!isTextInput && registry.matches('panel.toggleHoveredFullscreen', e)) {
        e.preventDefault();
        e.stopPropagation();
        toggleHoveredTabMaximized();
        return;
      }

      if (e.key === 'Escape') {
        cancelDrag();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [dragState.isDragging, dragState.dropTarget, endDrag, cancelDrag, updateDrag, toggleHoveredTabMaximized, getRootEdgeDropTarget]);

  return (
    <div
      ref={containerRef}
      className={`dock-container ${dragState.isDragging ? 'dragging' : ''} ${maximizedPanelId ? 'is-panel-maximized' : ''}`}
    >
      {/* Main docked layout */}
      <div className="dock-root">
        <DockNode node={layout.root} />
      </div>

      {/* Full-root edge target preview */}
      {dragState.isDragging && rootEdgeDropPosition && (
        <div className={`dock-root-drop-overlay ${rootEdgeDropPosition}`} />
      )}

      {/* Floating panels */}
      {layout.floatingPanels.map((floating) => (
        <FloatingPanel key={floating.id} floating={floating} />
      ))}

      {/* Drag preview */}
      {dragState.isDragging && dragState.draggedPanel && (
        <div
          className="dock-drag-preview"
          style={{
            left: dragState.currentPos.x - dragState.dragOffset.x,
            top: dragState.currentPos.y - dragState.dragOffset.y,
          }}
        >
          {dragState.draggedPanel.title}
        </div>
      )}
    </div>
  );
}
