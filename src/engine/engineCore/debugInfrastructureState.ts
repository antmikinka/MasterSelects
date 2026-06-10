import type { WebGPUContext } from '../core/WebGPUContext';
import type { RenderTargetManager } from '../core/RenderTargetManager';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { OutputPipeline } from '../pipeline/OutputPipeline';
import type { Compositor } from '../render/Compositor';
import type { LayerCollector } from '../render/LayerCollector';
import type { RenderDispatcher } from '../render/RenderDispatcher';

export interface DebugInfrastructureState {
  hasDevice: boolean;
  hasRenderDispatcher: boolean;
  hasRenderTargetManager: boolean;
  hasPreviewContext: boolean;
  targetCanvasCount: number;
  hasLayerCollector: boolean;
  hasCompositor: boolean;
  hasSampler: boolean;
  hasCompositorPipeline: boolean;
  hasOutputPipeline: boolean;
  hasPingView: boolean;
  hasPongView: boolean;
}

export interface DebugInfrastructureStateDeps {
  context: WebGPUContext;
  renderDispatcher: RenderDispatcher | null;
  renderTargetManager: RenderTargetManager | null;
  previewContext: GPUCanvasContext | null;
  targetCanvases: Map<string, { canvas: HTMLCanvasElement; context: GPUCanvasContext }>;
  layerCollector: LayerCollector | null;
  compositor: Compositor | null;
  sampler: GPUSampler | null;
  compositorPipeline: CompositorPipeline | null;
  outputPipeline: OutputPipeline | null;
}

export function buildDebugInfrastructureState(deps: DebugInfrastructureStateDeps): DebugInfrastructureState {
  return {
    hasDevice: deps.context.getDevice() !== null,
    hasRenderDispatcher: deps.renderDispatcher !== null,
    hasRenderTargetManager: deps.renderTargetManager !== null,
    hasPreviewContext: deps.previewContext !== null,
    targetCanvasCount: deps.targetCanvases.size,
    hasLayerCollector: deps.layerCollector !== null,
    hasCompositor: deps.compositor !== null,
    hasSampler: deps.sampler !== null,
    hasCompositorPipeline: deps.compositorPipeline !== null,
    hasOutputPipeline: deps.outputPipeline !== null,
    hasPingView: deps.renderTargetManager?.getPingView() != null,
    hasPongView: deps.renderTargetManager?.getPongView() != null,
  };
}
