import type { MediaFile, SignalAssetItem } from '../../stores/mediaStore';
import type { FileImportResult } from '../../stores/mediaStore/types';
import { isMediaFileImportResult } from '../../stores/mediaStore/helpers/importResult';
import type { AddClipOptions } from '../../stores/timeline/types';
import { classifyMediaType } from '../../stores/timeline/helpers/mediaTypeHelpers';
import { createSignalTimelineAdapterPlan } from '../../runtime/renderers/signalTimelineRendererAdapter';
import {
  getTimelineDropMediaTypeOverride,
  resolveMediaFileForTimelineDrop,
  resolveTimelineDropImportResult,
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

export type TimelineExternalDropArrangement = 'side-by-side' | 'stack';

export interface TimelineExternalDropFilePlacementActions {
  addTrack?: (type: 'video' | 'audio') => string | undefined;
  addClip: (
    trackId: string,
    file: File,
    startTime: number,
    duration?: number,
    mediaFileId?: string,
    mediaTypeOverride?: string,
    options?: AddClipOptions,
  ) => Promise<string | undefined> | string | undefined | void;
  addSignalAssetClip: (
    trackId: string,
    signalAsset: SignalAssetItem,
    startTime: number,
  ) => Promise<string | null | undefined> | string | null | undefined;
}

export interface PlaceTimelineExternalDropFilesParams {
  actions: TimelineExternalDropFilePlacementActions;
  baseStartTime: number;
  fallbackDuration?: number;
  filePath?: string;
  importResults?: FileImportResult[];
  arrangement?: TimelineExternalDropArrangement;
  records: TimelineExternalDropFileRecord[];
  resolveStartTime?: (desiredStartTime: number, duration?: number) => number;
  trackId: string;
  trackIsVideo: boolean;
}

interface TimelineExternalDropClipPlacement {
  startTime: number;
  endTime: number;
}

function getImportedResultDuration(importResult: FileImportResult, fallbackDuration?: number): number {
  if (isMediaFileImportResult(importResult)) {
    return importResult.duration ?? fallbackDuration ?? 5;
  }

  return createSignalTimelineAdapterPlan(importResult).duration;
}

function isImportedResultAudioOnly(importResult: FileImportResult): boolean {
  return isMediaFileImportResult(importResult) && importResult.type === 'audio';
}

function getImportedResultTrackType(importResult: FileImportResult): 'video' | 'audio' {
  return isImportedResultAudioOnly(importResult) ? 'audio' : 'video';
}

function getImportedResultName(importResult: FileImportResult): string {
  return importResult.name;
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

  const clipId = await actions.addClip(
    trackId,
    timelineFile,
    startTime,
    resolvedDuration,
    mediaFile.id,
    getTimelineDropMediaTypeOverride(mediaFile) ?? typeOverride,
  );
  if (!clipId) {
    log.warn('Could not place timeline drop media clip', {
      mediaFileId: mediaFile.id,
      name: mediaFile.name,
      trackId,
    });
    return null;
  }

  return { startTime, endTime: startTime + (resolvedDuration ?? 5) };
}

async function addTimelineExternalDropSignalClip(params: {
  actions: TimelineExternalDropFilePlacementActions;
  desiredStartTime: number;
  duration?: number;
  file: File;
  filePath?: string;
  handle?: FileSystemFileHandle;
  resolveStartTime?: (desiredStartTime: number, duration?: number) => number;
  trackId: string;
}): Promise<TimelineExternalDropClipPlacement | null> {
  const {
    actions,
    desiredStartTime,
    duration,
    file,
    filePath,
    handle,
    resolveStartTime,
    trackId,
  } = params;

  const importResult = await resolveTimelineDropImportResult({
    file,
    handle,
    absolutePath: filePath,
    waitForMediaPlaceholder: false,
  });

  if (!importResult) {
    log.warn('Could not import timeline drop file before creating signal clip', {
      name: file.name,
      filePath,
    });
    return null;
  }

  if (importResult.kind === 'media-file') {
    const mediaFile = importResult.mediaFile;
    const timelineFile = mediaFile.file ?? file;
    setTimelineDroppedFilePath(timelineFile, mediaFile.absolutePath ?? filePath);
    const resolvedDuration = mediaFile.duration ?? duration ?? 5;
    const startTime = resolveStartTime
      ? resolveStartTime(desiredStartTime, resolvedDuration)
      : desiredStartTime;

    const clipId = await actions.addClip(
      trackId,
      timelineFile,
      startTime,
      resolvedDuration,
      mediaFile.id,
      getTimelineDropMediaTypeOverride(mediaFile),
    );
    if (!clipId) {
      log.warn('Could not place timeline drop media clip for signal import result', {
        mediaFileId: mediaFile.id,
        name: mediaFile.name,
        trackId,
      });
      return null;
    }

    return { startTime, endTime: startTime + resolvedDuration };
  }

  const signalAsset = importResult.signalAsset;
  const plan = createSignalTimelineAdapterPlan(signalAsset);
  const startTime = resolveStartTime
    ? resolveStartTime(desiredStartTime, plan.duration)
    : desiredStartTime;
  const clipId = await actions.addSignalAssetClip(trackId, signalAsset, startTime);

  if (!clipId) {
    log.warn('Could not place timeline drop signal asset', {
      signalAssetId: signalAsset.id,
      name: signalAsset.name,
    });
    return null;
  }

  return { startTime, endTime: startTime + plan.duration };
}

async function addTimelineExternalDropImportedMediaClip(params: {
  actions: TimelineExternalDropFilePlacementActions;
  fallbackDuration?: number;
  mediaFile: MediaFile;
  startTime: number;
  trackId: string;
}): Promise<TimelineExternalDropClipPlacement | null> {
  const {
    actions,
    fallbackDuration,
    mediaFile,
    startTime,
    trackId,
  } = params;

  const file = await resolveMediaFileForTimelineDrop(mediaFile);
  if (!file) {
    log.warn('Could not resolve imported timeline drop media before creating clip', {
      mediaFileId: mediaFile.id,
      name: mediaFile.name,
    });
    return null;
  }

  setTimelineDroppedFilePath(file, mediaFile.absolutePath ?? mediaFile.filePath);
  const resolvedDuration = mediaFile.duration ?? fallbackDuration ?? 5;
  const clipId = await actions.addClip(
    trackId,
    file,
    startTime,
    resolvedDuration,
    mediaFile.id,
    getTimelineDropMediaTypeOverride(mediaFile),
  );
  if (!clipId) {
    log.warn('Could not place imported timeline drop media clip', {
      mediaFileId: mediaFile.id,
      name: mediaFile.name,
      trackId,
    });
    return null;
  }

  return { startTime, endTime: startTime + resolvedDuration };
}

async function addTimelineExternalDropImportedSignalClip(params: {
  actions: TimelineExternalDropFilePlacementActions;
  signalAsset: SignalAssetItem;
  startTime: number;
  trackId: string;
}): Promise<TimelineExternalDropClipPlacement | null> {
  const {
    actions,
    signalAsset,
    startTime,
    trackId,
  } = params;

  const plan = createSignalTimelineAdapterPlan(signalAsset);
  const clipId = await actions.addSignalAssetClip(trackId, signalAsset, startTime);

  if (!clipId) {
    log.warn('Could not place imported timeline drop signal asset', {
      signalAssetId: signalAsset.id,
      name: signalAsset.name,
    });
    return null;
  }

  return { startTime, endTime: startTime + plan.duration };
}

export async function placeTimelineExternalDropFiles(
  params: PlaceTimelineExternalDropFilesParams,
): Promise<boolean> {
  const {
    actions,
    arrangement = 'side-by-side',
    baseStartTime,
    fallbackDuration,
    filePath,
    importResults,
    records,
    resolveStartTime,
    trackId,
    trackIsVideo,
  } = params;

  if (records.length === 0 && (!importResults || importResults.length === 0)) return false;

  let cursorTime = baseStartTime;
  let stackStartTime: number | null = null;
  let placedAny = false;

  if (importResults && importResults.length > 0) {
    let placedCount = 0;

    for (const importResult of importResults) {
      const resultTrackType = getImportedResultTrackType(importResult);
      if (resultTrackType === 'audio' && trackIsVideo) {
        log.debug('Skipping imported audio file dropped on a video track', {
          name: getImportedResultName(importResult),
        });
        continue;
      }
      if (resultTrackType === 'video' && !trackIsVideo) {
        log.debug('Skipping imported non-audio file dropped on an audio track', {
          name: getImportedResultName(importResult),
        });
        continue;
      }

      const duration = getImportedResultDuration(importResult, fallbackDuration);
      const startTime = arrangement === 'stack'
        ? stackStartTime ?? (stackStartTime = resolveStartTime
          ? resolveStartTime(baseStartTime, duration)
          : baseStartTime)
        : resolveStartTime
          ? resolveStartTime(cursorTime, duration)
          : cursorTime;
      let placementTrackId = trackId;

      if (arrangement === 'stack' && placedCount > 0) {
        const nextTrackId = actions.addTrack?.(resultTrackType);
        if (!nextTrackId) {
          log.warn('Could not create stack track for timeline drop', {
            name: getImportedResultName(importResult),
            trackType: resultTrackType,
          });
          continue;
        }
        placementTrackId = nextTrackId;
      }

      const placement = isMediaFileImportResult(importResult)
        ? await addTimelineExternalDropImportedMediaClip({
          actions,
          trackId: placementTrackId,
          mediaFile: importResult,
          startTime,
          fallbackDuration,
        })
        : await addTimelineExternalDropImportedSignalClip({
          actions,
          trackId: placementTrackId,
          signalAsset: importResult,
          startTime,
        });

      if (placement) {
        placedAny = true;
        placedCount += 1;
        cursorTime = arrangement === 'stack' ? cursorTime : placement.endTime;
      }
    }

    return placedAny;
  }

  for (const record of records) {
    const { file, handle, absolutePath } = record;
    setTimelineDroppedFilePath(file, absolutePath ?? filePath);

    const typeOverride = await classifyMediaType(file);
    if (typeOverride === 'unknown') {
      if (!trackIsVideo) {
        log.debug('Skipping signal file dropped on a non-video track', { name: file.name });
        continue;
      }

      const placement = await addTimelineExternalDropSignalClip({
        actions,
        trackId,
        file,
        desiredStartTime: cursorTime,
        duration: fallbackDuration,
        filePath: absolutePath ?? filePath,
        handle,
        resolveStartTime,
      });

      if (placement) {
        placedAny = true;
        cursorTime = placement.endTime;
      }
      continue;
    }

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
