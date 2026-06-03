export interface TimelineHorizontalRenderWindow {
  startPx: number;
  width: number;
}

export interface ResolveTimelineViewportWidthInput {
  timelineViewportWidth: number;
  fallbackPx: number;
  minPx: number;
}

export interface ResolveHorizontalRenderWindowInput {
  scrollX: number;
  contentLeft: number;
  contentWidth: number;
  viewportWidth: number;
  overscanPx: number;
}

export interface ResolveVisibleSourceWindowInput {
  inPoint: number;
  outPoint: number;
  clipWidth: number;
  renderWindow: TimelineHorizontalRenderWindow;
}

export interface ResolveStableWaveformRenderGeometryInput {
  isAudioClip: boolean;
  isTrimming: boolean;
  isLinkedToTrimming: boolean;
  hasClipTrim: boolean;
  usesProcessedPyramid: boolean;
  clipWidth: number;
  clipLeft: number;
  scrollX: number;
  viewportWidth: number;
  overscanPx: number;
  baseRenderWindow: TimelineHorizontalRenderWindow;
  waveformInPoint: number;
  waveformOutPoint: number;
  originalInPoint: number;
  originalOutPoint: number;
  displayDuration: number;
}

export interface StableWaveformRenderGeometry {
  useStableTrimWindow: boolean;
  contentInPoint: number;
  contentOutPoint: number;
  contentWidth: number;
  contentOffsetPx: number;
  renderWindow: TimelineHorizontalRenderWindow;
  clipDuration: number;
  sourceSecondsPerPixel: number;
  normalizationInPoint?: number;
  normalizationOutPoint?: number;
  normalizationWidth?: number;
}

export function resolveTimelineViewportWidth(input: ResolveTimelineViewportWidthInput): number {
  const visibleWidth = input.timelineViewportWidth > 0
    ? input.timelineViewportWidth
    : input.fallbackPx;
  return Math.max(input.minPx, visibleWidth);
}

export function resolveHorizontalRenderWindow(input: ResolveHorizontalRenderWindowInput): TimelineHorizontalRenderWindow {
  const startPx = Math.max(0, input.scrollX - input.contentLeft - input.overscanPx);
  const endPx = Math.min(
    input.contentWidth,
    input.scrollX - input.contentLeft + input.viewportWidth + input.overscanPx,
  );

  return {
    startPx,
    width: Math.max(0, endPx - startPx),
  };
}

export function resolveVisibleSourceWindow(input: ResolveVisibleSourceWindowInput): { inPoint: number; outPoint: number } {
  const sourceSpan = Math.max(0, input.outPoint - input.inPoint);
  const safeWidth = Math.max(1, input.clipWidth);
  const windowStart = input.renderWindow.startPx / safeWidth;
  const windowEnd = (input.renderWindow.startPx + input.renderWindow.width) / safeWidth;

  return {
    inPoint: input.inPoint + sourceSpan * windowStart,
    outPoint: input.inPoint + sourceSpan * windowEnd,
  };
}

export function resolveStableWaveformRenderGeometry(input: ResolveStableWaveformRenderGeometryInput): StableWaveformRenderGeometry {
  const useStableTrimWindow = Boolean(
    input.isAudioClip &&
    (input.isTrimming || input.isLinkedToTrimming) &&
    input.hasClipTrim &&
    !input.usesProcessedPyramid &&
    input.clipWidth > 1,
  );
  const sourceSpan = Math.max(0.001, input.waveformOutPoint - input.waveformInPoint);
  const sourceSecondsPerPixel = sourceSpan / Math.max(1, input.clipWidth);
  const contentInPoint = useStableTrimWindow
    ? Math.max(0, Math.min(input.originalInPoint, input.waveformInPoint))
    : input.waveformInPoint;
  const contentOutPoint = useStableTrimWindow
    ? Math.max(contentInPoint + 0.001, Math.max(input.originalOutPoint, input.waveformOutPoint))
    : input.waveformOutPoint;
  const contentWidth = useStableTrimWindow
    ? Math.max(1, (contentOutPoint - contentInPoint) / sourceSecondsPerPixel)
    : input.clipWidth;
  const contentOffsetPx = useStableTrimWindow
    ? (contentInPoint - input.waveformInPoint) / sourceSecondsPerPixel
    : 0;
  const renderStartPx = useStableTrimWindow
    ? Math.max(0, input.scrollX - (input.clipLeft + contentOffsetPx) - input.overscanPx)
    : input.baseRenderWindow.startPx;
  const renderEndPx = useStableTrimWindow
    ? Math.min(
        contentWidth,
        input.scrollX - (input.clipLeft + contentOffsetPx) + input.viewportWidth + input.overscanPx,
      )
    : input.baseRenderWindow.startPx + input.baseRenderWindow.width;
  const renderWindow = useStableTrimWindow
    ? {
        startPx: renderStartPx,
        width: Math.max(0, renderEndPx - renderStartPx),
      }
    : input.baseRenderWindow;
  const clipDuration = useStableTrimWindow
    ? Math.max(0.001, (contentOutPoint - contentInPoint) * input.displayDuration / sourceSpan)
    : input.displayDuration;

  return {
    useStableTrimWindow,
    contentInPoint,
    contentOutPoint,
    contentWidth,
    contentOffsetPx,
    renderWindow,
    clipDuration,
    sourceSecondsPerPixel,
    normalizationInPoint: useStableTrimWindow ? input.originalInPoint : undefined,
    normalizationOutPoint: useStableTrimWindow ? input.originalOutPoint : undefined,
    normalizationWidth: useStableTrimWindow
      ? Math.max(1, (input.originalOutPoint - input.originalInPoint) / sourceSecondsPerPixel)
      : undefined,
  };
}
