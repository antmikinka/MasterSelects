import type { Layer, LayerRenderData } from '../../core/types';
import type { LayerCollectorDeps } from '../LayerCollector';

export function collectNativeDecoderFrame(
  layer: Layer,
  deps: LayerCollectorDeps
): LayerRenderData | null {
  const bitmap = layer.source?.nativeDecoder?.getCurrentFrame();
  if (!bitmap) {
    return null;
  }

  const texture = deps.textureManager.createImageBitmapTexture(bitmap, layer.id);
  if (!texture) {
    return null;
  }

  return {
    layer,
    isVideo: false,
    isDynamic: true,
    externalTexture: null,
    textureView: deps.textureManager.getDynamicTextureView(layer.id) ?? texture.createView(),
    sourceWidth: bitmap.width,
    sourceHeight: bitmap.height,
  };
}

export function collectParallelVideoFrame(
  layer: Layer,
  deps: LayerCollectorDeps
): LayerRenderData | null {
  const frame = layer.source?.videoFrame;
  if (!frame) {
    return null;
  }

  const extTex = deps.textureManager.importVideoTexture(frame);
  if (!extTex) {
    return null;
  }

  return {
    layer,
    isVideo: true,
    externalTexture: extTex,
    textureView: null,
    sourceWidth: frame.displayWidth,
    sourceHeight: frame.displayHeight,
  };
}
