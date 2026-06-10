import type { RenderDeps } from '../RenderDispatcher';
import type { RenderOutputRouter } from '../contracts';
import type { PreviewFrameRecorder } from './dispatcherTelemetry';

export class EmptyFrameRenderer {
  private readonly deps: RenderDeps;
  private readonly outputRouter: RenderOutputRouter;
  private readonly recordMainPreviewFrame: PreviewFrameRecorder;

  constructor(
    deps: RenderDeps,
    outputRouter: RenderOutputRouter,
    recordMainPreviewFrame: PreviewFrameRecorder,
  ) {
    this.deps = deps;
    this.outputRouter = outputRouter;
    this.recordMainPreviewFrame = recordMainPreviewFrame;
  }

  renderEmptyFrame(device: GPUDevice): void {
    const d = this.deps;
    const commandEncoder = device.createCommandEncoder();
    const pingView = d.renderTargetManager?.getPingView();

    // Use output pipeline to render empty frame (allows shader to generate checkerboard)
    if (pingView && d.outputPipeline && d.sampler) {
      // Clear ping texture to transparent
      const clearPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: pingView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      clearPass.end();
    }

    const outputSnapshot = pingView && d.outputPipeline && d.sampler
      ? this.outputRouter.captureSnapshot()
      : undefined;
    this.outputRouter.routeEmptyFrame({
      commandEncoder,
      sourceView: pingView ?? undefined,
      sampler: d.sampler ?? undefined,
      snapshot: outputSnapshot,
      targetIds: outputSnapshot?.activeCompositionTargetIds,
    });
    if (pingView && d.outputPipeline && d.sampler && d.previewContext) {
      this.recordMainPreviewFrame('empty');
    }
    device.queue.submit([commandEncoder.finish()]);
  }
}
