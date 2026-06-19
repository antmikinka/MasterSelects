import { renderHostPort } from '../render/renderHostPort';

export type PreviewCaptureMode = 'auto' | 'gpu' | 'dom';

export interface PreviewCaptureSuccess {
  readonly success: true;
  readonly width: number;
  readonly height: number;
  readonly mode: 'gpu' | 'dom';
  readonly dataUrl: string;
  readonly canvasSource?: string;
}

export interface PreviewCaptureFailure {
  readonly success: false;
  readonly error: string;
}

export type PreviewCaptureResult = PreviewCaptureSuccess | PreviewCaptureFailure;

function normalizePreviewCaptureMode(mode: unknown): PreviewCaptureMode {
  return mode === 'gpu' || mode === 'dom' || mode === 'auto' ? mode : 'auto';
}

function captureDomPreviewCanvas(): PreviewCaptureResult {
  const captureCanvas = renderHostPort.getCaptureCanvas();
  if (!captureCanvas) {
    return { success: false, error: 'Failed to capture frame - preview canvas not available' };
  }

  try {
    return {
      success: true,
      width: captureCanvas.canvas.width,
      height: captureCanvas.canvas.height,
      mode: 'dom',
      canvasSource: captureCanvas.source,
      dataUrl: captureCanvas.canvas.toDataURL('image/png'),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error
        ? `Failed to capture frame from preview canvas: ${error.message}`
        : 'Failed to capture frame from preview canvas',
    };
  }
}

async function captureGpuReadback(): Promise<PreviewCaptureResult> {
  const pixels = await renderHostPort.readPixels();
  if (!pixels) {
    return { success: false, error: 'Failed to capture frame - GPU readback unavailable' };
  }

  const { width, height } = renderHostPort.getOutputDimensions();
  if (width <= 0 || height <= 0) {
    return { success: false, error: 'Failed to capture frame - invalid output dimensions' };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { success: false, error: 'Failed to create canvas context' };
  }

  const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
  ctx.putImageData(imageData, 0, 0);
  return {
    success: true,
    width,
    height,
    mode: 'gpu',
    dataUrl: canvas.toDataURL('image/png'),
  };
}

export async function captureRenderHostFrame(modeInput: unknown = 'auto'): Promise<PreviewCaptureResult> {
  const mode = normalizePreviewCaptureMode(modeInput);
  if (mode === 'dom') return captureDomPreviewCanvas();

  const gpuResult = await captureGpuReadback();
  if (gpuResult.success || mode === 'gpu') return gpuResult;

  return captureDomPreviewCanvas();
}

