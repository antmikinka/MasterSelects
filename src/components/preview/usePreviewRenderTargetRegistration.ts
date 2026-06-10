import { useEffect, type RefObject } from 'react';

import { Logger } from '../../services/logger';
import {
  registerPreviewTarget,
  setPreviewTargetTransparency,
  unregisterPreviewTarget,
} from '../../services/render/previewTargetRegistration';
import type { RenderSource } from '../../types/renderTarget';

const log = Logger.create('Preview');

interface UsePreviewRenderTargetRegistrationOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isEngineReady: boolean;
  panelId: string;
  setCompReady: (ready: boolean) => void;
  showTransparencyGrid: boolean;
  stableRenderSource: RenderSource;
}

export function usePreviewRenderTargetRegistration({
  canvasRef,
  isEngineReady,
  panelId,
  setCompReady,
  showTransparencyGrid,
  stableRenderSource,
}: UsePreviewRenderTargetRegistrationOptions): void {
  useEffect(() => {
    if (!isEngineReady || !canvasRef.current) return;

    const isIndependent = stableRenderSource.type !== 'activeComp';
    log.debug(`[${panelId}] Registering render target`, { source: stableRenderSource, isIndependent });

    const registered = registerPreviewTarget({
      id: panelId,
      name: 'Preview',
      source: stableRenderSource,
      showTransparencyGrid,
      canvas: canvasRef.current,
      onIndependentRegistered: () => setCompReady(true),
    });
    if (!registered) return;

    return () => {
      log.debug(`[${panelId}] Unregistering render target`);
      unregisterPreviewTarget(panelId, stableRenderSource);
    };
  }, [canvasRef, isEngineReady, panelId, setCompReady, stableRenderSource, showTransparencyGrid]);

  useEffect(() => {
    if (!isEngineReady) return;
    setPreviewTargetTransparency(panelId, showTransparencyGrid);
  }, [isEngineReady, panelId, showTransparencyGrid]);
}
