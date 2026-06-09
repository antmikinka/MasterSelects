import type { Layer, TimelineClip } from '../../types';
import { flags } from '../../engine/featureFlags';
import {
  canUseSharedPreviewRuntimeSession,
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  getScrubRuntimeSource,
} from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import { scrubSettleState } from '../scrubSettleState';
import { getLazyTimelineVideoElementForClip } from '../timeline/lazyMediaElements';
import { selectPausedWebCodecsProvider } from './videoSyncWebCodecsPolicy';
import type { FrameContext } from './types';

type LayerVideoSource = NonNullable<Layer['source']>;

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
): boolean {
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
}): LayerBuilderVideoSourceResolution | null {
  const { clip, ctx, targetTime } = params;
  const htmlVideoElement = params.continuationVideo ?? getLayerBuilderVideoElement(clip) ?? undefined;
  const isInteractivePreview = ctx.isDraggingPlayhead || ctx.hasClipDragPreview;
  const keepScrubRuntimeActive = isInteractivePreview || scrubSettleState.isPending(clip.id);
  const runtimeSource = keepScrubRuntimeActive
    ? getScrubRuntimeSource(clip.source, clip.trackId, params.allowSharedPreviewSession)
    : getPreviewRuntimeSource(clip.source, clip.trackId, params.allowSharedPreviewSession);
  const runtimeProvider = getRuntimeFrameProvider(runtimeSource);

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

  if (!htmlVideoElement && !visualProvider) {
    return null;
  }

  return {
    source: {
      type: 'video',
      videoElement: htmlVideoElement,
      mediaTime: targetTime,
      webCodecsPlayer: visualProvider,
      runtimeSourceId: preferHtmlScrubPreview ? undefined : runtimeSource?.runtimeSourceId,
      runtimeSessionKey: preferHtmlScrubPreview ? undefined : runtimeSource?.runtimeSessionKey,
    },
    intrinsicSize: {
      width: htmlVideoElement?.videoWidth,
      height: htmlVideoElement?.videoHeight,
    },
  };
}
