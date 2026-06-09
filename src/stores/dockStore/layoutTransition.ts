export const DOCK_LAYOUT_TRANSITION_EVENT = 'masterselects:dock-layout-transition';

const DOCK_LAYOUT_TRANSITION_DURATION_MS = 500;

export function requestDockLayoutTransition(durationMs = DOCK_LAYOUT_TRANSITION_DURATION_MS): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(DOCK_LAYOUT_TRANSITION_EVENT, {
    detail: { durationMs },
  }));
}
