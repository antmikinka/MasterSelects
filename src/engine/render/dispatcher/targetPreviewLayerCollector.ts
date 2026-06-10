import type { Layer, LayerRenderData } from '../../core/types';
import { flags } from '../../featureFlags';
import { getMotionRenderSize } from '../../motion/MotionTypes';
import { scrubSettleState } from '../../../services/scrubSettleState';
import { useTimelineStore } from '../../../stores/timeline';
import { getCopiedHtmlVideoPreviewFrame } from '../htmlVideoPreviewFallback';
import type { RenderDeps } from '../RenderDispatcher';

const MAX_DRAG_FALLBACK_DRIFT_SECONDS = 0.35;
const MAX_DRAG_LIVE_IMPORT_DRIFT_SECONDS = 0.35;

interface PreviewFallbackFrame {
  view: GPUTextureView;
  width: number;
  height: number;
  mediaTime?: number;
}

export class TargetPreviewLayerCollector {
  private readonly deps: RenderDeps;

  constructor(deps: RenderDeps) {
    this.deps = deps;
  }

  collect(layers: Layer[]): LayerRenderData[] {
    const d = this.deps;
    const layerData: LayerRenderData[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer?.visible || !layer.source || layer.opacity === 0) continue;

      if (layer.source.videoElement) {
        const video = layer.source.videoElement;
        const htmlPreviewDebugDisabled =
          flags.useFullWebCodecsPlayback &&
          flags.disableHtmlPreviewFallback;
        if (htmlPreviewDebugDisabled) {
          continue;
        }
        const scrubbingCache = d.cacheManager.getScrubbingCache();
        const targetTime = this.getTargetVideoTime(layer, video);
        const isDragging = useTimelineStore.getState().isDraggingPlayhead;
        if (!d.exportCanvasManager.getIsExporting()) {
          scrubbingCache?.preloadAroundTime?.(video, targetTime, {
            isDragging,
            isPlaying: d.renderLoop?.getIsPlaying() ?? false,
          });
        }
        const isSettling = scrubSettleState.isPending(layer.sourceClipId);
        const isPausedSettle = !(d.renderLoop?.getIsPlaying() ?? false) && !isDragging && isSettling;
        const lastPresentedTime = scrubbingCache?.getLastPresentedTime(video);
        const lastPresentedOwner = scrubbingCache?.getLastPresentedOwner(video);
        const hasPresentedOwnerMismatch =
          !!layer.sourceClipId &&
          !!lastPresentedOwner &&
          lastPresentedOwner !== layer.sourceClipId;
        const hasConfirmedPresentedFrame =
          !hasPresentedOwnerMismatch &&
          typeof lastPresentedTime === 'number' &&
          Number.isFinite(lastPresentedTime);
        const displayedTime = hasConfirmedPresentedFrame ? lastPresentedTime : undefined;
        const isPlaybackActive = (d.renderLoop?.getIsPlaying() ?? false) && !video.paused;
        const reportedDisplayedTime =
          isPlaybackActive &&
          !video.seeking &&
          Number.isFinite(video.currentTime)
            ? video.currentTime
            : displayedTime;
        const hasFreshPresentedFrame =
          hasConfirmedPresentedFrame &&
          Math.abs(lastPresentedTime - targetTime) <= 0.12;
        const presentedDriftSeconds = hasConfirmedPresentedFrame
          ? Math.abs(lastPresentedTime - targetTime)
          : undefined;
        const currentTimeDriftSeconds = Math.abs(video.currentTime - targetTime);
        const awaitingPausedTargetFrame =
          hasPresentedOwnerMismatch ||
          !(d.renderLoop?.getIsPlaying() ?? false) &&
          !isDragging &&
          (!isSettling &&
            (!hasConfirmedPresentedFrame || Math.abs(lastPresentedTime - targetTime) > 0.05));
        const cacheSearchDistanceFrames = isDragging ? 10 : 6;
        const lastSameClipFrame = layer.sourceClipId
          ? scrubbingCache?.getLastFrame(video, layer.sourceClipId) ?? null
          : null;
        const dragHoldFrame = isDragging
          ? this.isFrameNearTarget(
            lastSameClipFrame,
            targetTime,
            MAX_DRAG_FALLBACK_DRIFT_SECONDS
          )
            ? lastSameClipFrame
            : null
          : (isSettling || awaitingPausedTargetFrame) && this.isFrameNearTarget(lastSameClipFrame, targetTime)
            ? lastSameClipFrame
            : null;
        const emergencyHoldFrame = dragHoldFrame;
        const sameClipHoldFrame =
          !(d.renderLoop?.getIsPlaying() ?? false) &&
          (isDragging || isSettling || awaitingPausedTargetFrame || video.seeking)
            ? this.isFrameNearTarget(
              lastSameClipFrame,
              targetTime,
              isDragging
                ? MAX_DRAG_FALLBACK_DRIFT_SECONDS
                : 0.35
            )
              ? lastSameClipFrame
              : null
            : null;
        const safeFallback = this.getSafePreviewFallback(layer, video) ?? dragHoldFrame;
        const allowDragLiveVideoImport =
          !video.seeking &&
          (presentedDriftSeconds ?? currentTimeDriftSeconds) <=
            MAX_DRAG_LIVE_IMPORT_DRIFT_SECONDS;
        const allowLiveVideoImport = !hasPresentedOwnerMismatch && (isPausedSettle
          ? hasFreshPresentedFrame
          : !awaitingPausedTargetFrame &&
            (((!isDragging && !isSettling) || hasFreshPresentedFrame || (isDragging ? allowDragLiveVideoImport : !safeFallback))));
        const allowConfirmedFrameCaching = !hasPresentedOwnerMismatch && (isPausedSettle
          ? hasFreshPresentedFrame
          : !awaitingPausedTargetFrame &&
            (((!isDragging && !isSettling) || hasFreshPresentedFrame)));
        const captureOwnerId = allowConfirmedFrameCaching ? layer.sourceClipId : undefined;
        if (video.readyState >= 2) {
          if ((video.seeking || awaitingPausedTargetFrame) && scrubbingCache) {
            const cachedView =
              scrubbingCache.getCachedFrame(video.src, targetTime) ??
              scrubbingCache.getNearestCachedFrame(video.src, targetTime, cacheSearchDistanceFrames);
            if (cachedView) {
              layerData.push({
                layer,
                isVideo: false,
                externalTexture: null,
                textureView: cachedView,
                sourceWidth: video.videoWidth,
                sourceHeight: video.videoHeight,
              });
              continue;
            }
            if (!allowLiveVideoImport && safeFallback) {
              layerData.push({
                layer,
                isVideo: false,
                externalTexture: null,
                textureView: safeFallback.view,
                sourceWidth: safeFallback.width,
                sourceHeight: safeFallback.height,
              });
              continue;
            }
            if (!allowLiveVideoImport && emergencyHoldFrame) {
              layerData.push({
                layer,
                isVideo: false,
                externalTexture: null,
                textureView: emergencyHoldFrame.view,
                sourceWidth: emergencyHoldFrame.width,
                sourceHeight: emergencyHoldFrame.height,
              });
              continue;
            }
            if (!allowLiveVideoImport && sameClipHoldFrame) {
              layerData.push({
                layer,
                isVideo: false,
                externalTexture: null,
                textureView: sameClipHoldFrame.view,
                sourceWidth: sameClipHoldFrame.width,
                sourceHeight: sameClipHoldFrame.height,
                displayedMediaTime: sameClipHoldFrame.mediaTime,
                targetMediaTime: targetTime,
                previewPath: 'same-clip-hold',
              });
              continue;
            }
          }

          const copiedFrame = getCopiedHtmlVideoPreviewFrame(
            video,
            scrubbingCache,
            targetTime,
            layer.sourceClipId,
            captureOwnerId
          );
          if (allowLiveVideoImport && copiedFrame) {
            layerData.push({
              layer,
              isVideo: false,
              externalTexture: null,
              textureView: copiedFrame.view,
              sourceWidth: copiedFrame.width,
              sourceHeight: copiedFrame.height,
              displayedMediaTime: copiedFrame.mediaTime ?? reportedDisplayedTime,
              targetMediaTime: targetTime,
              previewPath: 'copied-preview',
            });
            continue;
          }

          const extTex = allowLiveVideoImport
            ? d.textureManager?.importVideoTexture(video)
            : null;
          if (extTex) {
            if (scrubbingCache && allowConfirmedFrameCaching && !(d.renderLoop?.getIsPlaying() ?? false)) {
              const now = performance.now();
              const lastCapture = scrubbingCache.getLastCaptureTime(video);
              if (now - lastCapture > 50) {
                scrubbingCache.captureVideoFrame(video, captureOwnerId);
                scrubbingCache.setLastCaptureTime(video, now);
              }
              scrubbingCache.cacheFrameAtTime(video, targetTime);
            } else if (scrubbingCache && !(d.renderLoop?.getIsPlaying() ?? false)) {
              if (typeof displayedTime === 'number' && Number.isFinite(displayedTime)) {
                scrubbingCache.captureVideoFrameIfCloser(
                  video,
                  targetTime,
                  displayedTime,
                  layer.sourceClipId
                );
              }
              if (typeof displayedTime === 'number' && Number.isFinite(displayedTime)) {
                scrubbingCache.cacheFrameAtTime(video, displayedTime);
              }
            }
            layerData.push({
              layer,
              isVideo: true,
              externalTexture: extTex,
              textureView: null,
              sourceWidth: video.videoWidth,
              sourceHeight: video.videoHeight,
              displayedMediaTime: reportedDisplayedTime,
              targetMediaTime: targetTime,
              previewPath: 'live-import',
            });
            continue;
          }

          const notReadyCachedFrame =
            scrubbingCache?.getCachedFrameEntry(video.src, targetTime) ??
            scrubbingCache?.getNearestCachedFrameEntry(video.src, targetTime, cacheSearchDistanceFrames);
          if (notReadyCachedFrame) {
            layerData.push({
              layer,
              isVideo: false,
              externalTexture: null,
              textureView: notReadyCachedFrame.view,
              sourceWidth: video.videoWidth,
              sourceHeight: video.videoHeight,
              displayedMediaTime: notReadyCachedFrame.mediaTime,
              targetMediaTime: targetTime,
              previewPath: 'not-ready-scrub-cache',
            });
            continue;
          }

          if (safeFallback) {
            layerData.push({
              layer,
              isVideo: false,
              externalTexture: null,
              textureView: safeFallback.view,
              sourceWidth: safeFallback.width,
              sourceHeight: safeFallback.height,
              displayedMediaTime: safeFallback.mediaTime,
              targetMediaTime: targetTime,
              previewPath: 'final-cache',
            });
            continue;
          }
          if (emergencyHoldFrame) {
            layerData.push({
              layer,
              isVideo: false,
              externalTexture: null,
              textureView: emergencyHoldFrame.view,
              sourceWidth: emergencyHoldFrame.width,
              sourceHeight: emergencyHoldFrame.height,
              displayedMediaTime: emergencyHoldFrame.mediaTime,
              targetMediaTime: targetTime,
              previewPath: 'emergency-hold',
            });
            continue;
          }
          if (sameClipHoldFrame) {
            layerData.push({
              layer,
              isVideo: false,
              externalTexture: null,
              textureView: sameClipHoldFrame.view,
              sourceWidth: sameClipHoldFrame.width,
              sourceHeight: sameClipHoldFrame.height,
              displayedMediaTime: sameClipHoldFrame.mediaTime,
              targetMediaTime: targetTime,
              previewPath: 'same-clip-hold',
            });
            continue;
          }
        }
      }
      if (layer.source.imageElement) {
        const img = layer.source.imageElement;
        let texture = d.textureManager?.getCachedImageTexture(img);
        if (!texture) texture = d.textureManager?.createImageTexture(img) ?? undefined;
        if (texture) {
          layerData.push({
            layer,
            isVideo: false,
            isDynamic: layer.source?.proxyFrameIndex !== undefined,
            externalTexture: null,
            textureView: d.textureManager!.getImageView(texture),
            sourceWidth: img.naturalWidth,
            sourceHeight: img.naturalHeight,
            displayedMediaTime: layer.source?.mediaTime,
            targetMediaTime: layer.source?.targetMediaTime ?? layer.source?.mediaTime,
            previewPath: layer.source?.previewPath,
          });
        }
      }
      if (layer.source.textCanvas) {
        const canvas = layer.source.textCanvas;
        const texture = d.textureManager?.createCanvasTexture(canvas);
        if (texture) {
          layerData.push({ layer, isVideo: false, externalTexture: null, textureView: d.textureManager!.getImageView(texture), sourceWidth: canvas.width, sourceHeight: canvas.height });
        }
      }
      if (layer.source.type === 'motion') {
        const size = getMotionRenderSize(layer.source.motion);
        layerData.push({
          layer,
          isVideo: false,
          externalTexture: null,
          textureView: null,
          sourceWidth: size.width,
          sourceHeight: size.height,
        });
      }
    }
    return layerData;
  }

  private getTargetVideoTime(layer: Layer, video: HTMLVideoElement): number {
    return layer.source?.mediaTime ?? video.currentTime;
  }

  private getSafePreviewFallback(
    layer: Layer,
    video: HTMLVideoElement
  ): PreviewFallbackFrame | null {
    const scrubbingCache = this.deps.cacheManager.getScrubbingCache();
    if (!scrubbingCache) {
      return null;
    }
    const isDragging = useTimelineStore.getState().isDraggingPlayhead;
    const tolerance = video.seeking || isDragging ? 0.35 : 0.2;
    return scrubbingCache.getLastFrameNearTime(
      video,
      this.getTargetVideoTime(layer, video),
      tolerance,
      layer.sourceClipId
    );
  }

  private isFrameNearTarget(
    frame: { mediaTime?: number } | null | undefined,
    targetTime: number,
    maxDeltaSeconds: number = 0.35
  ): boolean {
    return (
      typeof frame?.mediaTime === 'number' &&
      Number.isFinite(frame.mediaTime) &&
      Math.abs(frame.mediaTime - targetTime) <= maxDeltaSeconds
    );
  }
}
