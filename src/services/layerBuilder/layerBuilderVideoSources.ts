import type { Layer, TimelineClip } from '../../types';
import type { MediaFile } from '../../stores/mediaStore/types';
import { flags } from '../../engine/featureFlags';
import {
  canUseSharedPreviewRuntimeSession,
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  getScrubRuntimeSource,
} from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import { renderHostPort } from '../render/renderHostPort';
import { scrubSettleState } from '../scrubSettleState';
import { getLazyTimelineVideoElementForClip } from '../timeline/lazyMediaElements';
import { selectPausedWebCodecsProvider } from './videoSyncWebCodecsPolicy';
import type { FrameContext } from './types';
import { getReverseWorkerRuntimeSource } from './reverseWorkerWebCodecsRuntime';

type LayerVideoSource = NonNullable<Layer['source']>;

interface WorkerGpuFileVideoSource {
  readonly file: File;
  readonly mediaFileId?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface LayerBuilderVideoSourceResolution {
  source: LayerVideoSource;
  intrinsicSize?: {
    width?: number;
    height?: number;
  };
}

function getLayerBuilderVideoElement(clip: TimelineClip): HTMLVideoElement | null {
  return getLazyTimelineVideoElementForClip(clip) ?? clip.source?.videoElement ?? null;
}

function isWorkerGpuOnlyRenderHost(): boolean {
  return renderHostPort.getTelemetry().mode === 'worker-gpu-only';
}

function resolveWorkerGpuFileVideoSource(
  clip: TimelineClip,
  mediaFile?: Pick<MediaFile, 'id' | 'file' | 'width' | 'height'>,
): WorkerGpuFileVideoSource | null {
  const file = mediaFile?.file ?? clip.source?.file ?? clip.file;
  if (!file) return null;
  return {
    file,
    mediaFileId: mediaFile?.id ?? clip.mediaFileId ?? clip.source?.mediaFileId,
    width: mediaFile?.width,
    height: mediaFile?.height,
  };
}

function shouldPresentReverseRuntimeProvider(input: {
  readonly provider: RuntimeFrameProvider | null | undefined;
  readonly hasFrame: boolean;
}): boolean {
  if (!input.provider?.isFullMode?.()) {
    return false;
  }
  return input.hasFrame;
}

export function resetLayerBuilderReverseRuntimePresentationForTests(): void {
  // Kept for tests that reset layer-builder preview policy between cases.
}

export interface LayerBuilderVideoSourceDebugInfo {
  hasVideoElement: boolean;
  videoReadyState: number | null;
  hasWebCodecsPlayer: boolean;
  webCodecsFullMode: boolean;
  webCodecsHasFrame: boolean;
  webCodecsPendingSeek: number | null;
}

export function hasLayerBuilderRenderableVideoSource(
  source: TimelineClip['source'] | undefined,
  clip?: TimelineClip,
  mediaFile?: Pick<MediaFile, 'id' | 'file' | 'width' | 'height'>,
): boolean {
  if (clip && isWorkerGpuOnlyRenderHost()) {
    return !!resolveWorkerGpuFileVideoSource(clip, mediaFile);
  }
  return !!(
    (clip ? getLayerBuilderVideoElement(clip) : source?.videoElement) ||
    source?.webCodecsPlayer?.isFullMode?.()
  );
}

export function selectLayerBuilderPausedVisualProvider(
  source: TimelineClip['source'],
  runtimeProvider: RuntimeFrameProvider | null,
  targetTime: number,
  options?: { preferFreshRuntime?: boolean },
): RuntimeFrameProvider | undefined {
  return selectPausedWebCodecsProvider(
    source?.webCodecsPlayer,
    runtimeProvider,
    targetTime,
    options,
  ) ?? undefined;
}

export function getLayerBuilderVideoSourceDebugInfo(clip: TimelineClip): LayerBuilderVideoSourceDebugInfo {
  const video = getLayerBuilderVideoElement(clip);
  const provider = clip.source?.webCodecsPlayer;
  return {
    hasVideoElement: !!video,
    videoReadyState: video?.readyState ?? null,
    hasWebCodecsPlayer: !!provider,
    webCodecsFullMode: provider?.isFullMode?.() ?? false,
    webCodecsHasFrame: provider?.hasFrame?.() ?? false,
    webCodecsPendingSeek: provider?.getPendingSeekTime?.() ?? null,
  };
}

export function pauseLayerBuilderVideoSource(clip: TimelineClip, ctx: FrameContext): void {
  const video = getLayerBuilderVideoElement(clip);
  if (video && !video.paused) {
    video.pause();
  }

  const allowSharedPreviewSession = canUseSharedPreviewRuntimeSession(clip, ctx.clipsAtTime);
  const previewSource = getPreviewRuntimeSource(clip.source, clip.trackId, allowSharedPreviewSession);
  const scrubSource = getScrubRuntimeSource(clip.source, clip.trackId, allowSharedPreviewSession);
  getRuntimeFrameProvider(previewSource)?.pause();
  getRuntimeFrameProvider(scrubSource)?.pause();
  clip.source?.webCodecsPlayer?.pause();
}

export function resolveLayerBuilderVideoSource(params: {
  clip: TimelineClip;
  ctx: FrameContext;
  targetTime: number;
  allowSharedPreviewSession: boolean;
  continuationVideo?: HTMLVideoElement | null;
  workerGpuMediaFile?: Pick<MediaFile, 'id' | 'file' | 'width' | 'height'>;
}): LayerBuilderVideoSourceResolution | null {
  const { clip, ctx, targetTime } = params;
  const workerGpuFileSource = isWorkerGpuOnlyRenderHost()
    ? resolveWorkerGpuFileVideoSource(clip, params.workerGpuMediaFile)
    : null;
  if (workerGpuFileSource) {
    return {
      source: {
        type: 'video',
        file: workerGpuFileSource.file,
        mediaTime: targetTime,
        targetMediaTime: targetTime,
        mediaFileId: workerGpuFileSource.mediaFileId,
        runtimeSourceId: clip.source?.runtimeSourceId,
        runtimeSessionKey: clip.source?.runtimeSessionKey,
      },
      intrinsicSize: {
        width: workerGpuFileSource.width,
        height: workerGpuFileSource.height,
      },
    };
  }
  if (isWorkerGpuOnlyRenderHost()) {
    return null;
  }

  const htmlVideoElement = params.continuationVideo ?? getLayerBuilderVideoElement(clip) ?? undefined;
  const isInteractivePreview = ctx.isDraggingPlayhead || ctx.hasClipDragPreview;
  const keepScrubRuntimeActive = isInteractivePreview || scrubSettleState.isPending(clip.id);
  const reverseWorkerRuntimeSource = getReverseWorkerRuntimeSource(clip, ctx);
  const baseRuntimeSource = reverseWorkerRuntimeSource ?? clip.source;
  const allowSharedRuntimeSession =
    reverseWorkerRuntimeSource ? false : params.allowSharedPreviewSession;
  const runtimeSource = keepScrubRuntimeActive
    ? getScrubRuntimeSource(baseRuntimeSource, clip.trackId, allowSharedRuntimeSession)
    : getPreviewRuntimeSource(baseRuntimeSource, clip.trackId, allowSharedRuntimeSession);
  const runtimeProvider = getRuntimeFrameProvider(runtimeSource);
  const reversePresentationProvider =
    runtimeProvider ?? runtimeSource?.webCodecsPlayer ?? clip.source?.webCodecsPlayer;
  const runtimeProviderHasFrame =
    reversePresentationProvider?.hasFrame?.() === true ||
    Boolean(reversePresentationProvider?.getCurrentFrame());
  const presentReverseRuntimeFrame = reverseWorkerRuntimeSource
    ? shouldPresentReverseRuntimeProvider({
        provider: reversePresentationProvider,
        hasFrame: runtimeProviderHasFrame,
      })
    : true;

  const preferHtmlScrubPreview =
    !flags.disableHtmlPreviewFallback &&
    isInteractivePreview &&
    !!htmlVideoElement &&
    (!flags.useFullWebCodecsPlayback || !clip.source?.webCodecsPlayer?.isFullMode?.());
  const playingVisualProvider =
    runtimeProvider?.isFullMode()
      ? runtimeProvider
      : runtimeSource?.webCodecsPlayer ?? clip.source?.webCodecsPlayer;
  const visualProvider = ctx.isPlaying
    ? playingVisualProvider
    : preferHtmlScrubPreview
      ? undefined
      : selectLayerBuilderPausedVisualProvider(clip.source, runtimeProvider, targetTime, {
          preferFreshRuntime: keepScrubRuntimeActive,
        });
  const presentedVisualProvider = reverseWorkerRuntimeSource && !presentReverseRuntimeFrame
    ? undefined
    : visualProvider;
  const presentedRuntimeSourceId = reverseWorkerRuntimeSource && !presentReverseRuntimeFrame
    ? undefined
    : runtimeSource?.runtimeSourceId;
  const presentedRuntimeSessionKey = reverseWorkerRuntimeSource && !presentReverseRuntimeFrame
    ? undefined
    : runtimeSource?.runtimeSessionKey;

  if (!htmlVideoElement && !presentedVisualProvider) {
    return null;
  }

  return {
    source: {
      type: 'video',
      videoElement: htmlVideoElement,
      mediaTime: targetTime,
      webCodecsPlayer: presentedVisualProvider,
      runtimeSourceId: preferHtmlScrubPreview ? undefined : presentedRuntimeSourceId,
      runtimeSessionKey: preferHtmlScrubPreview ? undefined : presentedRuntimeSessionKey,
      ...(reverseWorkerRuntimeSource && presentReverseRuntimeFrame && !preferHtmlScrubPreview && runtimeProviderHasFrame
        ? { forceRuntimeFramePreview: true }
        : {}),
    },
    intrinsicSize: {
      width: htmlVideoElement?.videoWidth,
      height: htmlVideoElement?.videoHeight,
    },
  };
}
