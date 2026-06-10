import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import {
  MEDIA_BOARD_COMPACT_LOD_ZOOM,
  MEDIA_BOARD_GRID_PARALLAX,
  MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM,
  MEDIA_BOARD_PAN_ZOOM_MAX,
  MEDIA_BOARD_PAN_ZOOM_MIN,
  MEDIA_BOARD_THUMBNAIL_LOD_MIN_ZOOM,
  MEDIA_BOARD_THUMBNAIL_REQUEST_MIN_ZOOM,
  getMediaBoardGridSize,
  getMediaBoardUiScale,
} from './constants';
import { getMediaBoardVisibleRect } from './layout';
import { loadMediaBoardViewport, saveMediaBoardViewport } from './storage';
import type {
  MediaBoardRenderLod,
  MediaBoardViewport,
  MediaBoardViewportSize,
  MediaBoardVisibleRect,
} from './types';

export interface UseMediaBoardViewportOptions {
  viewMode: string;
}

export interface UseMediaBoardViewportResult {
  applyMediaBoardViewportPreview: (viewport: MediaBoardViewport) => void;
  boardAutoPanFrameRef: React.MutableRefObject<number | null>;
  boardCanvasInnerRef: React.MutableRefObject<HTMLDivElement | null>;
  boardCanvasRef: React.MutableRefObject<HTMLDivElement | null>;
  boardInteractionFrameRef: React.MutableRefObject<number | null>;
  boardWrapperRef: React.MutableRefObject<HTMLDivElement | null>;
  handleMediaBoardWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  mediaBoardCanvasSize: MediaBoardViewportSize;
  mediaBoardRenderLod: MediaBoardRenderLod;
  mediaBoardViewport: MediaBoardViewport;
  mediaBoardViewportRef: React.MutableRefObject<MediaBoardViewport>;
  mediaBoardVisibleRect: MediaBoardVisibleRect;
  reloadMediaBoardViewport: () => void;
  screenToMediaBoard: (clientX: number, clientY: number) => { x: number; y: number };
  setMediaBoardPerformanceMode: (enabled: boolean) => void;
  setMediaBoardViewport: Dispatch<SetStateAction<MediaBoardViewport>>;
}

export function useMediaBoardViewport({
  viewMode,
}: UseMediaBoardViewportOptions): UseMediaBoardViewportResult {
  const boardWrapperRef = useRef<HTMLDivElement | null>(null);
  const boardCanvasRef = useRef<HTMLDivElement | null>(null);
  const boardCanvasInnerRef = useRef<HTMLDivElement | null>(null);
  const boardInteractionFrameRef = useRef<number | null>(null);
  const boardAutoPanFrameRef = useRef<number | null>(null);
  const boardWheelCommitTimerRef = useRef<number | null>(null);
  const [mediaBoardViewport, setMediaBoardViewport] = useState<MediaBoardViewport>(loadMediaBoardViewport);
  const mediaBoardViewportRef = useRef<MediaBoardViewport>(mediaBoardViewport);
  const [mediaBoardCanvasSize, setMediaBoardCanvasSize] = useState<MediaBoardViewportSize>(() => ({
    width: typeof window === 'undefined' ? 1280 : Math.max(1, window.innerWidth),
    height: typeof window === 'undefined' ? 720 : Math.max(1, window.innerHeight),
  }));

  useEffect(() => {
    mediaBoardViewportRef.current = mediaBoardViewport;
    saveMediaBoardViewport(mediaBoardViewport);
  }, [mediaBoardViewport]);

  useEffect(() => () => {
    if (boardWheelCommitTimerRef.current !== null) {
      window.clearTimeout(boardWheelCommitTimerRef.current);
      boardWheelCommitTimerRef.current = null;
    }
    if (boardInteractionFrameRef.current !== null) {
      window.cancelAnimationFrame(boardInteractionFrameRef.current);
    }
    if (boardAutoPanFrameRef.current !== null) {
      window.cancelAnimationFrame(boardAutoPanFrameRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    if (viewMode !== 'board') return;

    const canvas = boardCanvasRef.current;
    if (!canvas) return;

    const updateCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      setMediaBoardCanvasSize((current) => (
        current.width === width && current.height === height
          ? current
          : { width, height }
      ));
    };

    updateCanvasSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateCanvasSize);
      return () => window.removeEventListener('resize', updateCanvasSize);
    }

    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [viewMode]);

  const mediaBoardVisibleRect = useMemo(() => getMediaBoardVisibleRect(
    mediaBoardViewport,
    mediaBoardCanvasSize,
  ), [mediaBoardCanvasSize, mediaBoardViewport]);

  const mediaBoardRenderLod = useMemo(() => ({
    overviewCanvas: mediaBoardViewport.zoom <= MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM,
    compact: mediaBoardViewport.zoom <= MEDIA_BOARD_COMPACT_LOD_ZOOM,
    showImages: mediaBoardViewport.zoom > MEDIA_BOARD_THUMBNAIL_LOD_MIN_ZOOM,
    requestThumbnails: mediaBoardViewport.zoom >= MEDIA_BOARD_THUMBNAIL_REQUEST_MIN_ZOOM,
  }), [mediaBoardViewport.zoom]);

  const screenToMediaBoard = useCallback((clientX: number, clientY: number) => {
    const rect = boardCanvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const viewport = mediaBoardViewportRef.current;
    return {
      x: (clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (clientY - rect.top - viewport.panY) / viewport.zoom,
    };
  }, []);

  const setMediaBoardPerformanceMode = useCallback((enabled: boolean) => {
    boardWrapperRef.current?.classList.toggle('board-interacting', enabled);
  }, []);

  const reloadMediaBoardViewport = useCallback(() => {
    setMediaBoardViewport(loadMediaBoardViewport());
  }, []);

  const applyMediaBoardViewportPreview = useCallback((viewport: MediaBoardViewport) => {
    const inner = boardCanvasInnerRef.current;
    if (inner) {
      inner.style.transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`;
      inner.style.setProperty('--media-board-ui-scale', String(getMediaBoardUiScale(viewport.zoom)));
    }

    const wrapper = boardWrapperRef.current;
    if (wrapper) {
      wrapper.style.setProperty('--media-board-grid-x', `${viewport.panX * MEDIA_BOARD_GRID_PARALLAX}px`);
      wrapper.style.setProperty('--media-board-grid-y', `${viewport.panY * MEDIA_BOARD_GRID_PARALLAX}px`);
      wrapper.style.setProperty('--media-board-grid-size', `${getMediaBoardGridSize(viewport.zoom)}px`);
    }
  }, []);

  const handleMediaBoardWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = boardCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const zoomDelta = event.deltaY > 0 ? 0.9 : 1.1;
    const current = mediaBoardViewportRef.current;
    const nextZoom = Math.min(
      MEDIA_BOARD_PAN_ZOOM_MAX,
      Math.max(MEDIA_BOARD_PAN_ZOOM_MIN, current.zoom * zoomDelta),
    );
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const nextViewport = {
      zoom: nextZoom,
      panX: cursorX - ((cursorX - current.panX) * (nextZoom / current.zoom)),
      panY: cursorY - ((cursorY - current.panY) * (nextZoom / current.zoom)),
    };

    mediaBoardViewportRef.current = nextViewport;
    setMediaBoardPerformanceMode(true);

    if (boardInteractionFrameRef.current === null) {
      boardInteractionFrameRef.current = window.requestAnimationFrame(() => {
        boardInteractionFrameRef.current = null;
        applyMediaBoardViewportPreview(mediaBoardViewportRef.current);
      });
    }

    if (boardWheelCommitTimerRef.current !== null) {
      window.clearTimeout(boardWheelCommitTimerRef.current);
    }
    boardWheelCommitTimerRef.current = window.setTimeout(() => {
      boardWheelCommitTimerRef.current = null;
      const committedViewport = mediaBoardViewportRef.current;
      setMediaBoardViewport(committedViewport);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setMediaBoardPerformanceMode(false));
      });
    }, 90);
  }, [applyMediaBoardViewportPreview, setMediaBoardPerformanceMode]);

  return {
    applyMediaBoardViewportPreview,
    boardAutoPanFrameRef,
    boardCanvasInnerRef,
    boardCanvasRef,
    boardInteractionFrameRef,
    boardWrapperRef,
    handleMediaBoardWheel,
    mediaBoardCanvasSize,
    mediaBoardRenderLod,
    mediaBoardViewport,
    mediaBoardViewportRef,
    mediaBoardVisibleRect,
    reloadMediaBoardViewport,
    screenToMediaBoard,
    setMediaBoardPerformanceMode,
    setMediaBoardViewport,
  };
}
