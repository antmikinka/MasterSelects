import type { TimelineClip } from '../../types';
import { getRuntimeFrameProvider } from '../mediaRuntime/runtimePlayback';

export function getTimelinePlaybackWarmupVideo(
  source: TimelineClip['source'] | undefined,
): HTMLVideoElement | null {
  if (!source?.videoElement) {
    return null;
  }

  const runtimeProvider = getRuntimeFrameProvider(source);
  const frameProvider =
    runtimeProvider?.isFullMode()
      ? runtimeProvider
      : source.webCodecsPlayer?.isFullMode()
        ? source.webCodecsPlayer
        : null;

  return frameProvider?.isFullMode() ? null : source.videoElement;
}
