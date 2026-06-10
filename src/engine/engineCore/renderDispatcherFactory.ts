import type { RenderTargetManager } from '../core/RenderTargetManager';
import type { CacheManager } from '../managers/CacheManager';
import type { ExportCanvasManager } from '../managers/ExportCanvasManager';
import type { MotionRenderer } from '../motion/MotionRenderer';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { OutputPipeline } from '../pipeline/OutputPipeline';
import type { SlicePipeline } from '../pipeline/SlicePipeline';
import type { PerformanceStats } from '../stats/PerformanceStats';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import type { TextureManager } from '../texture/TextureManager';
import type { Compositor } from '../render/Compositor';
import type { LayerCollector } from '../render/LayerCollector';
import type { NestedCompRenderer } from '../render/NestedCompRenderer';
import { RenderDispatcher, type RenderDeps } from '../render/RenderDispatcher';
import { RenderLoop } from '../render/RenderLoop';
import { RenderOutputRouterAdapter } from '../render/RenderOutputRouterAdapter';

export interface EngineRenderDispatcherFactoryDeps {
  getDevice(): GPUDevice | null;
  isRecovering(): boolean;
  getSampler(): GPUSampler | null;
  getPreviewContext(): GPUCanvasContext | null;
  getTargetCanvases(): Map<string, { canvas: HTMLCanvasElement; context: GPUCanvasContext }>;
  getCompositorPipeline(): CompositorPipeline | null;
  getOutputPipeline(): OutputPipeline | null;
  getSlicePipeline(): SlicePipeline | null;
  getTextureManager(): TextureManager | null;
  getMaskTextureManager(): MaskTextureManager | null;
  getRenderTargetManager(): RenderTargetManager | null;
  getLayerCollector(): LayerCollector | null;
  getCompositor(): Compositor | null;
  getNestedCompRenderer(): NestedCompRenderer | null;
  getMotionRenderer(): MotionRenderer | null;
  getCacheManager(): CacheManager;
  getExportCanvasManager(): ExportCanvasManager;
  getPerformanceStats(): PerformanceStats;
  getRenderLoop(): RenderLoop | null;
  registerTargetCanvas(targetId: string, canvas: HTMLCanvasElement): GPUCanvasContext | null;
  unregisterTargetCanvas(targetId: string): void;
  getTargetContext(targetId: string): GPUCanvasContext | null;
}

export function createEngineRenderDispatcher(deps: EngineRenderDispatcherFactoryDeps): RenderDispatcher {
  const renderDeps = {
    getDevice: deps.getDevice,
    isRecovering: deps.isRecovering,
  } as RenderDeps;
  Object.defineProperties(renderDeps, {
    sampler: { get: deps.getSampler },
    previewContext: { get: deps.getPreviewContext },
    targetCanvases: { get: deps.getTargetCanvases },
    compositorPipeline: { get: deps.getCompositorPipeline },
    outputPipeline: { get: deps.getOutputPipeline },
    slicePipeline: { get: deps.getSlicePipeline },
    textureManager: { get: deps.getTextureManager },
    maskTextureManager: { get: deps.getMaskTextureManager },
    renderTargetManager: { get: deps.getRenderTargetManager },
    layerCollector: { get: deps.getLayerCollector },
    compositor: { get: deps.getCompositor },
    nestedCompRenderer: { get: deps.getNestedCompRenderer },
    motionRenderer: { get: deps.getMotionRenderer },
    cacheManager: { get: deps.getCacheManager },
    exportCanvasManager: { get: deps.getExportCanvasManager },
    performanceStats: { get: deps.getPerformanceStats },
    renderLoop: { get: deps.getRenderLoop },
  });
  const renderOutputRouter = new RenderOutputRouterAdapter({
    canvasTargets: {
      registerTargetCanvas: deps.registerTargetCanvas,
      unregisterTargetCanvas: deps.unregisterTargetCanvas,
      getTargetContext: deps.getTargetContext,
    },
    getPreviewContext: deps.getPreviewContext,
    getOutputPipeline: deps.getOutputPipeline,
    getSlicePipeline: deps.getSlicePipeline,
    getResolution: () => deps.getRenderTargetManager()?.getResolution() ?? null,
    shouldSkipPreviewOutput: () => deps.getExportCanvasManager().shouldSkipPreviewOutput(),
    getExportCanvasContext: () => deps.getExportCanvasManager().getExportCanvasContext(),
    isExporting: () => deps.getExportCanvasManager().getIsExporting(),
  });
  return new RenderDispatcher(renderDeps, renderOutputRouter);
}
