import type { Layer } from '../../core/types';
import { getMotionRenderSize } from '../../motion/MotionTypes';
import { useRenderTargetStore } from '../../../stores/renderTargetStore';
import type { RenderDeps } from '../RenderDispatcher';
import type { PreviewFrameRecorder } from './dispatcherTelemetry';
import { TargetPreviewLayerCollector } from './targetPreviewLayerCollector';

export class TargetPreviewRenderer {
  private readonly deps: RenderDeps;
  private readonly layerCollector: TargetPreviewLayerCollector;
  private readonly recordMainPreviewFrame: PreviewFrameRecorder;

  constructor(deps: RenderDeps, recordMainPreviewFrame: PreviewFrameRecorder) {
    this.deps = deps;
    this.layerCollector = new TargetPreviewLayerCollector(deps);
    this.recordMainPreviewFrame = recordMainPreviewFrame;
  }

  renderToPreviewCanvas(canvasId: string, layers: Layer[]): void {
    const d = this.deps;
    if (d.isRecovering()) return;

    const device = d.getDevice();
    const canvasContext = d.targetCanvases.get(canvasId)?.context;
    if (!device || !canvasContext || !d.compositorPipeline || !d.outputPipeline || !d.sampler) return;

    const indPingView = d.renderTargetManager?.getIndependentPingView();
    const indPongView = d.renderTargetManager?.getIndependentPongView();
    if (!indPingView || !indPongView) return;

    const layerData = this.layerCollector.collect(layers);

    const { width, height } = d.renderTargetManager!.getResolution();

    const target = useRenderTargetStore.getState().targets.get(canvasId);
    const showGrid = target?.showTransparencyGrid ?? false;

    d.outputPipeline.updateResolution(width, height);

    if (layerData.length === 0) {
      const commandEncoder = device.createCommandEncoder();
      const blackTex = d.renderTargetManager!.getBlackTexture();
      if (blackTex) {
        const blackView = blackTex.createView();
        const blackBindGroup = d.outputPipeline.createOutputBindGroup(d.sampler, blackView, showGrid ? 'grid' : 'normal');
        d.outputPipeline.renderToCanvas(commandEncoder, canvasContext, blackBindGroup);
        this.recordMainPreviewFrame('target-empty');
      }
      device.queue.submit([commandEncoder.finish()]);
      return;
    }

    const commandEncoder = device.createCommandEncoder();
    for (const data of layerData) {
      if (data.layer.source?.type !== 'motion') continue;
      const rendered = d.motionRenderer?.renderLayer(data.layer, commandEncoder);
      const size = rendered ?? getMotionRenderSize(data.layer.source.motion);
      data.textureView = rendered?.textureView ?? null;
      data.sourceWidth = size.width;
      data.sourceHeight = size.height;
    }

    let readView = indPingView;
    let writeView = indPongView;

    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: readView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
    });
    clearPass.end();

    for (const data of layerData) {
      const layer = data.layer;
      const uniformBuffer = d.compositorPipeline!.getOrCreateUniformBuffer(layer.id);
      const sourceAspect = data.sourceWidth / data.sourceHeight;
      const outputAspect = width / height;
      const maskLookupId = layer.maskClipId || layer.id;
      const maskManager = d.maskTextureManager!;
      const maskInfo = maskManager.getMaskInfo(maskLookupId) ?? { hasMask: false, view: maskManager.getWhiteMaskView() };
      const hasMask = maskInfo.hasMask;
      const maskTextureView = maskInfo.view;

      d.compositorPipeline!.updateLayerUniforms(layer, sourceAspect, outputAspect, hasMask, uniformBuffer);

      let pipeline: GPURenderPipeline;
      let bindGroup: GPUBindGroup;

      if (data.isVideo && data.externalTexture) {
        pipeline = d.compositorPipeline!.getExternalCompositePipeline()!;
        bindGroup = d.compositorPipeline!.createExternalCompositeBindGroup(d.sampler!, readView, data.externalTexture, uniformBuffer, maskTextureView);
      } else if (data.textureView) {
        pipeline = d.compositorPipeline!.getCompositePipeline()!;
        bindGroup = d.compositorPipeline!.createCompositeBindGroup(d.sampler!, readView, data.textureView, uniformBuffer, maskTextureView);
      } else {
        continue;
      }

      const compositePass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: writeView, loadOp: 'clear', storeOp: 'store' }],
      });
      compositePass.setPipeline(pipeline);
      compositePass.setBindGroup(0, bindGroup);
      compositePass.draw(6);
      compositePass.end();

      [readView, writeView] = [writeView, readView];
    }

    const outputBindGroup = d.outputPipeline!.createOutputBindGroup(d.sampler!, readView, showGrid ? 'grid' : 'normal');
    d.outputPipeline!.renderToCanvas(commandEncoder, canvasContext, outputBindGroup);
    this.recordMainPreviewFrame('target-canvas', layerData);

    device.queue.submit([commandEncoder.finish()]);
  }
}
