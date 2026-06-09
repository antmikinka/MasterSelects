import type { MediaFile } from '../../stores/mediaStore';
import type { AddClipOptions } from '../../stores/timeline/types';
import { classifyMediaType } from '../../stores/timeline/helpers/mediaTypeHelpers';
import {
  getTimelineDropMediaTypeOverride,
  resolveTimelineDropMediaFile,
  setTimelineDroppedFilePath,
} from './timelineExternalDropMediaResolver';
import { Logger } from '../logger';

const log = Logger.create('TimelineExternalDropFilePlacement');

export interface TimelineExternalDropFileRecord {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
}

export interface TimelineExternalDropFilePlacementActions {
  addClip: (
    trackId: string,
    file: File,
    startTime: number,
    duration?: number,
    mediaFileId?: string,
    mediaTypeOverride?: string,
    options?: AddClipOptions,
  ) => Promise<string | undefined> | string | undefined | void;
}

export interface PlaceTimelineExternalDropFilesParams {
  actions: TimelineExternalDropFilePlacementActions;
  baseStartTime: number;
  fallbackDuration?: number;
  filePath?: string;
  records: TimelineExternalDropFileRecord[];
  resolveStartTime?: (desiredStartTime: number, duration?: number) => number;
  trackId: string;
  trackIsVideo: boolean;
}

interface TimelineExternalDropClipPlacement {
  startTime: number;
  endTime: number;
}

async function addTimelineExternalDropMediaClip(params: {
  actions: TimelineExternalDropFilePlacementActions;
  duration?: number;
  file: File;
  filePath?: string;
  handle?: FileSystemFileHandle;
  startTime: number;
  trackId: string;
  typeOverride?: string;
}): Promise<TimelineExternalDropClipPlacement | null> {
  const {
    actions,
    duration,
    file,
    filePath,
    handle,
    startTime,
    trackId,
    typeOverride,
  } = params;

  const mediaFile: MediaFile | null = await resolveTimelineDropMediaFile({
    file,
    handle,
    absolutePath: filePath,
  });

  if (!mediaFile) {
    log.warn('Could not import timeline drop media before creating clip', {
      name: file.name,
      filePath,
    });
    return null;
  }

  const timelineFile = mediaFile.file ?? file;
  setTimelineDroppedFilePath(timelineFile, mediaFile.absolutePath ?? filePath);
  const resolvedDuration = mediaFile.duration ?? duration;

  actions.addClip(
    trackId,
    timelineFile,
    startTime,
    resolvedDuration,
    mediaFile.id,
    getTimelineDropMediaTypeOverride(mediaFile) ?? typeOverride,
  );

  return { startTime, endTime: startTime + (resolvedDuration ?? 5) };
}

export async function placeTimelineExternalDropFiles(
  params: PlaceTimelineExternalDropFilesParams,
): Promise<boolean> {
  const {
    actions,
    baseStartTime,
    fallbackDuration,
    filePath,
    records,
    resolveStartTime,
    trackId,
    trackIsVideo,
  } = params;

  if (records.length === 0) return false;

  let cursorTime = baseStartTime;
  let placedAny = false;

  for (const record of records) {
    const { file, handle, absolutePath } = record;
    setTimelineDroppedFilePath(file, absolutePath ?? filePath);

    const typeOverride = await classifyMediaType(file);
    if (typeOverride === 'unknown') continue;

    const fileIsAudio = typeOverride === 'audio';
    if (fileIsAudio && trackIsVideo) {
      log.debug('Skipping audio file dropped on a video track', { name: file.name });
      continue;
    }
    if (!fileIsAudio && !trackIsVideo) {
      log.debug('Skipping non-audio file dropped on an audio track', { name: file.name });
      continue;
    }

    const startTime = resolveStartTime
      ? resolveStartTime(cursorTime, fallbackDuration)
      : cursorTime;

    const placement = await addTimelineExternalDropMediaClip({
      actions,
      trackId,
      file,
      startTime,
      duration: fallbackDuration,
      filePath: absolutePath ?? filePath,
      handle,
      typeOverride,
    });

    if (placement) {
      placedAny = true;
      cursorTime = placement.endTime;
    }
  }

  return placedAny;
}
