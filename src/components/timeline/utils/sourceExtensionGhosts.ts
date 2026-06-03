export type SourceExtensionGhostEdge = 'left' | 'right';

export interface SourceExtensionGhost {
  edge: SourceExtensionGhostEdge;
  left: number;
  width: number;
}

export interface ResolveSourceExtensionGhostsInput {
  enabled: boolean;
  isTrimming: boolean;
  isLinkedToTrimming: boolean;
  trimEdge?: SourceExtensionGhostEdge;
  clipWidth: number;
  clipLeft: number;
  clipStartTime: number;
  clipDuration: number;
  displayStartTime: number;
  displayDuration: number;
  displayInPoint: number;
  displayOutPoint: number;
  sourceDuration: number;
  scrollX: number;
  viewportWidth: number;
  overscanPx: number;
  timeToPixel: (time: number) => number;
}

const SOURCE_EXTENSION_EPSILON = 0.001;

export function resolveSourceExtensionGhosts(input: ResolveSourceExtensionGhostsInput): SourceExtensionGhost[] {
  if (!input.enabled) return [];
  if ((!input.isTrimming && !input.isLinkedToTrimming) || !input.trimEdge || input.clipWidth <= 0) return [];

  const originalStart = input.clipStartTime;
  const originalEnd = input.clipStartTime + input.clipDuration;
  const displayEnd = input.displayStartTime + input.displayDuration;
  const visibleStartPx = input.scrollX - input.clipLeft - input.overscanPx;
  const visibleEndPx = input.scrollX - input.clipLeft + input.viewportWidth + input.overscanPx;
  const ghosts: SourceExtensionGhost[] = [];

  const pushVisibleGhost = (edge: SourceExtensionGhostEdge, startTime: number, endTime: number) => {
    const ghostStartTime = Math.max(0, Math.min(startTime, endTime));
    const ghostEndTime = Math.max(ghostStartTime, Math.max(startTime, endTime));
    if (ghostEndTime - ghostStartTime <= SOURCE_EXTENSION_EPSILON) return;

    const rawLeft = input.timeToPixel(ghostStartTime - input.displayStartTime);
    const rawRight = input.timeToPixel(ghostEndTime - input.displayStartTime);
    const clippedLeft = Math.max(rawLeft, visibleStartPx);
    const clippedRight = Math.min(rawRight, visibleEndPx);
    if (clippedRight - clippedLeft < 1) return;

    ghosts.push({
      edge,
      left: clippedLeft,
      width: Math.max(1, clippedRight - clippedLeft),
    });
  };

  if (input.trimEdge === 'left') {
    const availableLeftDuration = Math.min(
      Math.max(0, input.displayInPoint),
      Math.max(0, input.displayStartTime),
    );
    if (availableLeftDuration > SOURCE_EXTENSION_EPSILON) {
      pushVisibleGhost('left', input.displayStartTime - availableLeftDuration, input.displayStartTime);
    }
  }

  if (input.trimEdge === 'right') {
    const availableRightDuration = Math.max(0, input.sourceDuration - input.displayOutPoint);
    if (availableRightDuration > SOURCE_EXTENSION_EPSILON) {
      pushVisibleGhost('right', displayEnd, displayEnd + availableRightDuration);
    }
  }

  if (ghosts.length === 0 && input.trimEdge === 'left' && Math.abs(input.displayStartTime - originalStart) > SOURCE_EXTENSION_EPSILON) {
    pushVisibleGhost('left', Math.min(input.displayStartTime, originalStart), Math.max(input.displayStartTime, originalStart));
  }

  if (ghosts.length === 0 && input.trimEdge === 'right' && Math.abs(displayEnd - originalEnd) > SOURCE_EXTENSION_EPSILON) {
    pushVisibleGhost('right', Math.min(displayEnd, originalEnd), Math.max(displayEnd, originalEnd));
  }

  return ghosts;
}
