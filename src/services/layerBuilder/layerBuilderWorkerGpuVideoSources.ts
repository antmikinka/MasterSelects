import type { TimelineClip } from '../../types';
import type { MediaFile } from '../../stores/mediaStore/types';
import { renderHostPort } from '../render/renderHostPort';

export interface WorkerGpuFileVideoSource {
  readonly file: File;
  readonly mediaFileId?: string;
  readonly width?: number;
  readonly height?: number;
}

export function isWorkerGpuOnlyRenderHost(): boolean {
  return renderHostPort.getTelemetry().mode === 'worker-gpu-only';
}

export function resolveWorkerGpuFileVideoSource(
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
