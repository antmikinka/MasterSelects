import { engine } from '../../engine/WebGPUEngine';
import { renderScheduler } from '../renderScheduler';
import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { useTimelineStore } from '../../stores/timeline';
import type { RenderSource } from '../../types/renderTarget';

export interface RegisterPreviewTargetOptions {
  id: string;
  name: string;
  source: RenderSource;
  showTransparencyGrid: boolean;
  canvas: HTMLCanvasElement;
  onIndependentRegistered?: () => void;
}

export function registerPreviewTarget({
  id,
  name,
  source,
  showTransparencyGrid,
  canvas,
  onIndependentRegistered,
}: RegisterPreviewTargetOptions): boolean {
  const isIndependent = source.type !== 'activeComp';

  const gpuContext = engine.registerTargetCanvas(id, canvas);
  if (!gpuContext) return false;

  useRenderTargetStore.getState().registerTarget({
    id,
    name,
    source,
    destinationType: 'canvas',
    enabled: true,
    showTransparencyGrid,
    canvas,
    context: gpuContext,
    window: null,
    isFullscreen: false,
  });

  if (useTimelineStore.getState().isPlaying) {
    engine.clearVideoCache();
    engine.clearScrubbingCache();
    engine.clearCompositeCache();
    engine.requestRender();
  }

  if (isIndependent) {
    renderScheduler.register(id);
    onIndependentRegistered?.();
  }

  return true;
}

export function unregisterPreviewTarget(id: string, source: RenderSource): void {
  const isIndependent = source.type !== 'activeComp';

  if (isIndependent) {
    renderScheduler.unregister(id);
  }
  useRenderTargetStore.getState().unregisterTarget(id);
  engine.unregisterTargetCanvas(id);
}

export function setPreviewTargetTransparency(id: string, showTransparencyGrid: boolean): void {
  useRenderTargetStore.getState().setTargetTransparencyGrid(id, showTransparencyGrid);
  engine.requestRender();
}
