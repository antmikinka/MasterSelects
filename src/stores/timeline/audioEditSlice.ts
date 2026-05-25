import type { ClipAudioEditOperation, SpectralImageLayer } from '../../types';
import { encodeAudioBufferToWavBlob } from '../../engine/audio/AudioFileEncoder';
import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import { Logger } from '../../services/logger';
import type {
  ApplyAudioRepairSuggestionInput,
  AudioEditActions,
  SliceCreator,
  TimelineAudioRegionEditType,
  TimelineClip,
} from './types';
import { generateClipId } from './helpers/idGenerator';
import { clearProcessedAudioAnalysisRefs } from './helpers/audioAnalysisStateHelpers';
import { ClipAudioRenderService } from '../../services/audio/ClipAudioRenderService';
import { generateTimelineWaveformAnalysisForFile } from '../../services/audio/timelineWaveformPyramidCache';
import { useMediaStore } from '../mediaStore';
import { createAudioElement } from './helpers/webCodecsHelpers';
import { captureSnapshot } from '../historyStore';

const log = Logger.create('TimelineAudioEdit');
const clipAudioRenderer = new ClipAudioRenderService();

function isAudioClip(clip: TimelineClip): boolean {
  const fileName = clip.file?.name || clip.name || '';
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return clip.source?.type === 'audio'
    || clip.file?.type?.startsWith('audio/') === true
    || ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus'].includes(extension);
}

function createAudioEditOperationId(): string {
  return generateClipId('audio-edit');
}

function operationLabel(type: TimelineAudioRegionEditType): string {
  switch (type) {
    case 'silence': return 'Silence region';
    case 'cut': return 'Cut region';
    case 'paste': return 'Paste region';
    case 'insert-silence': return 'Insert silence';
    case 'delete-silence': return 'Delete silence';
    case 'reverse': return 'Reverse region';
    case 'invert-polarity': return 'Invert polarity';
    case 'swap-channels': return 'Swap channels';
    case 'mono-sum': return 'Mono sum';
    case 'repair': return 'Repair region';
  }
}

function spectralOperationLabel(type: 'spectral-mask' | 'spectral-resynthesis'): string {
  switch (type) {
    case 'spectral-mask': return 'Spectral mask';
    case 'spectral-resynthesis': return 'Spectral resynthesis';
  }
}

function createSpectralLayerId(): string {
  return generateClipId('spectral-layer');
}

function normalizeSpectralLayer(layer: SpectralImageLayer): SpectralImageLayer {
  const frequencyMin = Math.max(0, Math.min(layer.frequencyMin, layer.frequencyMax));
  const frequencyMax = Math.max(frequencyMin, Math.max(layer.frequencyMin, layer.frequencyMax));
  const { keyframes: rawKeyframes, ...layerWithoutKeyframes } = layer;
  const keyframes = (rawKeyframes ?? [])
    .map(keyframe => {
      const normalized = {
        ...keyframe,
        time: Math.max(0, Math.min(Math.max(0.001, layer.duration), keyframe.time)),
      };
      if (typeof normalized.opacity === 'number') {
        normalized.opacity = Math.max(0, Math.min(1, normalized.opacity));
      }
      if (typeof normalized.gainDb === 'number') {
        normalized.gainDb = Math.max(-60, Math.min(24, normalized.gainDb));
      }
      if (typeof normalized.frequencyMin === 'number') {
        normalized.frequencyMin = Math.max(0, normalized.frequencyMin);
      }
      if (typeof normalized.frequencyMax === 'number') {
        normalized.frequencyMax = Math.max(0, normalized.frequencyMax);
      }
      if (
        typeof normalized.frequencyMin === 'number' &&
        typeof normalized.frequencyMax === 'number' &&
        normalized.frequencyMin > normalized.frequencyMax
      ) {
        const min = normalized.frequencyMax;
        normalized.frequencyMax = normalized.frequencyMin;
        normalized.frequencyMin = min;
      }
      return normalized;
    })
    .filter(keyframe => keyframe.id)
    .toSorted((a, b) => a.time - b.time);
  return {
    ...layerWithoutKeyframes,
    timeStart: Math.max(0, layer.timeStart),
    duration: Math.max(0.001, layer.duration),
    frequencyMin,
    frequencyMax,
    opacity: Math.max(0, Math.min(1, layer.opacity)),
    gainDb: Math.max(-60, Math.min(24, layer.gainDb)),
    featherTime: Math.max(0, layer.featherTime),
    featherFrequency: Math.max(0, layer.featherFrequency),
    ...(keyframes.length > 0 ? { keyframes } : {}),
  };
}

function clipSourceRange(clip: TimelineClip): { start: number; end: number } {
  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = Math.max(sourceStart + 0.001, clip.outPoint ?? sourceStart + clip.duration);
  return {
    start: Math.min(sourceStart, sourceEnd),
    end: Math.max(sourceStart, sourceEnd),
  };
}

function serializeRepairSuggestionEvidence(
  evidence: ApplyAudioRepairSuggestionInput['evidence'],
): string | undefined {
  if (!evidence || Object.keys(evidence).length === 0) {
    return undefined;
  }

  return JSON.stringify(evidence);
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

function getBaseFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

async function renderClipEditStackOnly(
  clip: TimelineClip,
  extractor: AudioExtractor = audioExtractor,
): Promise<AudioBuffer> {
  const sourceBuffer = await extractor.extractAudio(
    clip.file,
    getClipMediaFileId(clip) ?? clip.id,
  );
  const renderClip: TimelineClip = {
    ...clip,
    speed: 1,
    reversed: false,
    preservesPitch: true,
    effects: [],
    audioState: {
      ...(clip.audioState ?? {}),
      muted: false,
      effectStack: [],
    },
  };
  return (await clipAudioRenderer.render({ clip: renderClip, sourceBuffer })).buffer;
}

export const createAudioEditSlice: SliceCreator<AudioEditActions> = (set, get) => ({
  applyAudioRegionEdit: (type, options = {}) => {
    const { audioRegionSelection, clips, tracks } = get();
    if (!audioRegionSelection) {
      log.warn('Cannot apply audio edit without an active region selection');
      return null;
    }

    const clip = clips.find(c => c.id === audioRegionSelection.clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot apply audio edit to missing or non-audio clip', {
        clipId: audioRegionSelection.clipId,
      });
      return null;
    }

    const track = tracks.find(t => t.id === audioRegionSelection.trackId);
    if (track?.locked) {
      log.warn('Cannot apply audio edit on locked track', {
        clipId: clip.id,
        trackId: audioRegionSelection.trackId,
      });
      return null;
    }

    const start = Math.max(0, Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint));
    const end = Math.max(start, Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint));
    if (end - start <= 0.0005) {
      log.warn('Cannot apply audio edit to an empty region', { clipId: clip.id, start, end });
      return null;
    }

    const operation: ClipAudioEditOperation = {
      id: createAudioEditOperationId(),
      type,
      enabled: true,
      params: {
        label: operationLabel(type),
        timelineStart: audioRegionSelection.startTime,
        timelineEnd: audioRegionSelection.endTime,
        preserveClipDuration: true,
        ...(options.params ?? {}),
      },
      timeRange: { start, end },
      ...(options.channelMask ? { channelMask: [...options.channelMask] } : {}),
      createdAt: Date.now(),
    };

    captureSnapshot(operationLabel(type));
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clip.id) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            editStack: [
              ...(audioState.editStack ?? []),
              operation,
            ],
          },
        });
      }),
      ...(options.keepSelection ? {} : { audioRegionSelection: null }),
    });
    get().invalidateCache();
    return operation.id;
  },

  applyAudioRepairSuggestion: (clipId, suggestion) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot apply repair suggestion to missing or non-audio clip', { clipId });
      return null;
    }

    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot apply repair suggestion on locked track', { clipId, trackId: clip.trackId });
      return null;
    }

    const sourceRange = clipSourceRange(clip);
    if (sourceRange.end - sourceRange.start <= 0.0005) {
      log.warn('Cannot apply repair suggestion to an empty clip range', { clipId });
      return null;
    }

    const evidence = serializeRepairSuggestionEvidence(suggestion.evidence);
    const operation: ClipAudioEditOperation = {
      id: createAudioEditOperationId(),
      type: suggestion.operation.editType,
      enabled: true,
      params: {
        ...(suggestion.operation.params ?? {}),
        label: suggestion.operation.params?.label ?? suggestion.label,
        timelineStart: clip.startTime,
        timelineEnd: clip.startTime + clip.duration,
        preserveClipDuration: true,
        repairSuggestionId: suggestion.id,
        repairSuggestionKind: suggestion.kind,
        ...(suggestion.severity ? { repairSuggestionSeverity: suggestion.severity } : {}),
        ...(typeof suggestion.confidence === 'number' ? { repairSuggestionConfidence: suggestion.confidence } : {}),
        ...(suggestion.reason ? { repairSuggestionReason: suggestion.reason } : {}),
        ...(evidence ? { repairSuggestionEvidence: evidence } : {}),
      },
      timeRange: sourceRange,
      createdAt: Date.now(),
    };

    captureSnapshot(`Apply ${suggestion.label}`);
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            editStack: [
              ...(audioState.editStack ?? []),
              operation,
            ],
          },
        });
      }),
    });
    get().invalidateCache();
    return operation.id;
  },

  copySelectedAudioRegion: () => {
    const { audioRegionSelection, clips } = get();
    if (!audioRegionSelection) {
      log.warn('Cannot copy audio without an active region selection');
      return false;
    }

    const clip = clips.find(c => c.id === audioRegionSelection.clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot copy audio from missing or non-audio clip', {
        clipId: audioRegionSelection.clipId,
      });
      return false;
    }

    const sourceInPoint = Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const sourceOutPoint = Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    if (sourceOutPoint - sourceInPoint <= 0.0005) {
      log.warn('Cannot copy an empty audio region', { clipId: clip.id });
      return false;
    }

    set({
      audioRegionClipboard: {
        sourceClipId: clip.id,
        sourceTrackId: audioRegionSelection.trackId,
        sourceMediaFileId: getClipMediaFileId(clip),
        sourceAudioRevisionId: clip.audioState?.sourceAudioRevisionId,
        startTime: audioRegionSelection.startTime,
        endTime: audioRegionSelection.endTime,
        sourceInPoint,
        sourceOutPoint,
        duration: sourceOutPoint - sourceInPoint,
        copiedAt: Date.now(),
      },
    });
    return true;
  },

  pasteAudioRegionToSelection: () => {
    const { audioRegionClipboard, audioRegionSelection } = get();
    if (!audioRegionClipboard) {
      log.warn('Cannot paste audio without copied audio region data');
      return null;
    }
    if (!audioRegionSelection) {
      log.warn('Cannot paste audio without an active target region selection');
      return null;
    }

    return get().applyAudioRegionEdit('paste', {
      keepSelection: true,
      params: {
        label: 'Paste region',
        sourceClipId: audioRegionClipboard.sourceClipId,
        sourceTrackId: audioRegionClipboard.sourceTrackId,
        sourceMediaFileId: audioRegionClipboard.sourceMediaFileId ?? null,
        sourceAudioRevisionId: audioRegionClipboard.sourceAudioRevisionId ?? null,
        sourceInPoint: audioRegionClipboard.sourceInPoint,
        sourceOutPoint: audioRegionClipboard.sourceOutPoint,
        sourceDuration: audioRegionClipboard.duration,
        replaceSelection: true,
      },
    });
  },

  setClipAudioEditOperationEnabled: (clipId, operationId, enabled) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot toggle audio edit on locked track', { clipId, operationId });
      return;
    }

    captureSnapshot(enabled ? 'Enable audio edit' : 'Bypass audio edit');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.editStack?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            editStack: currentClip.audioState.editStack.map(operation =>
              operation.id === operationId ? { ...operation, enabled } : operation
            ),
          },
        });
      }),
    });
    get().invalidateCache();
  },

  removeClipAudioEditOperation: (clipId, operationId) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot remove audio edit on locked track', { clipId, operationId });
      return;
    }

    captureSnapshot('Remove audio edit');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.editStack?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            editStack: currentClip.audioState.editStack.filter(operation => operation.id !== operationId),
          },
        });
      }),
    });
    get().invalidateCache();
  },

  clearClipAudioEditStack: (clipId) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot clear audio edits on locked track', { clipId });
      return;
    }

    captureSnapshot('Clear audio edit stack');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.editStack?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            editStack: [],
          },
        });
      }),
    });
    get().invalidateCache();
  },

  bakeClipAudioEditStack: async (clipId) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot bake missing or non-audio clip', { clipId });
      return null;
    }
    if (!clip.audioState?.editStack?.some(operation => operation.enabled !== false)) {
      log.warn('Cannot bake clip without active audio edit operations', { clipId });
      return null;
    }
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot bake audio edits on locked track', { clipId, trackId: clip.trackId });
      return null;
    }

    const rendered = await renderClipEditStackOnly(clip);
    const wavBlob = encodeAudioBufferToWavBlob(rendered);
    const bakedFileName = `${getBaseFileName(clip.name)} - baked audio.wav`;
    const bakedFile = new File([wavBlob], bakedFileName, {
      type: 'audio/wav',
      lastModified: Date.now(),
    });

    const mediaStore = useMediaStore.getState();
    const imported = await mediaStore.importFile(bakedFile, null, { forceCopyToProject: true });
    if (imported.type !== 'audio') {
      log.warn('Baked audio import did not produce an audio media file', { clipId, importedType: imported.type });
      return null;
    }

    const audioElement = createAudioElement(bakedFile);
    const analysis = await generateTimelineWaveformAnalysisForFile(bakedFile, {
      mediaFileId: imported.id,
    });
    const oldEditStack = clip.audioState.editStack ?? [];
    const oldSourceMediaFileId = getClipMediaFileId(clip);
    const nextOutPoint = rendered.duration;
    const nextDuration = Math.max(0.001, Math.min(clip.duration, nextOutPoint));

    captureSnapshot('Bake audio edit stack');
    set({
      clips: get().clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        return {
          ...currentClip,
          name: bakedFileName,
          file: bakedFile,
          mediaFileId: imported.id,
          duration: nextDuration,
          inPoint: 0,
          outPoint: nextOutPoint,
          waveform: analysis.waveform,
          waveformGenerating: false,
          waveformProgress: 100,
          source: {
            ...(currentClip.source ?? { type: 'audio' as const }),
            type: 'audio' as const,
            audioElement,
            naturalDuration: nextOutPoint,
            mediaFileId: imported.id,
            file: bakedFile,
          },
          audioState: {
            ...(currentClip.audioState ?? {}),
            sourceAudioRevisionId: imported.id,
            editStack: [],
            sourceAnalysisRefs: analysis.audioAnalysisRefs,
            processedAnalysisRefs: undefined,
            bakeHistory: [
              ...(currentClip.audioState?.bakeHistory ?? []),
              {
                id: generateClipId('audio-bake'),
                mediaFileId: imported.id,
                sourceMediaFileId: oldSourceMediaFileId,
                sourceClipId: currentClip.id,
                operationIds: oldEditStack.map(operation => operation.id),
                createdAt: Date.now(),
                provenance: {
                  operationCount: oldEditStack.length,
                  duration: nextOutPoint,
                },
              },
            ],
          },
        };
      }),
    });
    get().updateDuration();
    get().invalidateCache();
    return imported.id;
  },

  applySpectralRegionEdit: (type, options = {}) => {
    const { audioSpectralRegionSelection, clips, tracks } = get();
    if (!audioSpectralRegionSelection) {
      log.warn('Cannot apply spectral edit without an active spectral selection');
      return null;
    }

    const clip = clips.find(c => c.id === audioSpectralRegionSelection.clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot apply spectral edit to missing or non-audio clip', {
        clipId: audioSpectralRegionSelection.clipId,
      });
      return null;
    }

    const track = tracks.find(t => t.id === audioSpectralRegionSelection.trackId);
    if (track?.locked) {
      log.warn('Cannot apply spectral edit on locked track', {
        clipId: clip.id,
        trackId: audioSpectralRegionSelection.trackId,
      });
      return null;
    }

    const start = Math.max(0, Math.min(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint));
    const end = Math.max(start, Math.max(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint));
    const frequencyMinHz = Math.max(0, Math.min(audioSpectralRegionSelection.frequencyMinHz, audioSpectralRegionSelection.frequencyMaxHz));
    const frequencyMaxHz = Math.max(frequencyMinHz, Math.max(audioSpectralRegionSelection.frequencyMinHz, audioSpectralRegionSelection.frequencyMaxHz));

    if (end - start <= 0.0005 || frequencyMaxHz - frequencyMinHz <= 1) {
      log.warn('Cannot apply spectral edit to an empty time/frequency region', {
        clipId: clip.id,
        start,
        end,
        frequencyMinHz,
        frequencyMaxHz,
      });
      return null;
    }

    const operation: ClipAudioEditOperation = {
      id: createAudioEditOperationId(),
      type,
      enabled: true,
      params: {
        label: spectralOperationLabel(type),
        timelineStart: audioSpectralRegionSelection.startTime,
        timelineEnd: audioSpectralRegionSelection.endTime,
        frequencyMinHz,
        frequencyMaxHz,
        blendMode: type === 'spectral-mask' ? 'attenuate' : 'replace',
        gainDb: type === 'spectral-mask' ? -18 : 6,
        featherTime: 0.015,
        featherFrequencyHz: Math.max(12, (frequencyMaxHz - frequencyMinHz) * 0.05),
        ...(options.params ?? {}),
      },
      timeRange: { start, end },
      ...(options.channelMask ? { channelMask: [...options.channelMask] } : {}),
      createdAt: Date.now(),
    };

    captureSnapshot(spectralOperationLabel(type));
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clip.id) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            editStack: [
              ...(audioState.editStack ?? []),
              operation,
            ],
          },
        });
      }),
      ...(options.keepSelection ? {} : { audioSpectralRegionSelection: null }),
    });
    get().invalidateCache();
    return operation.id;
  },

  addClipSpectralImageLayer: (clipId, layerInput) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot add spectral image layer to missing or non-audio clip', { clipId });
      return null;
    }
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot add spectral image layer on locked track', { clipId, trackId: clip.trackId });
      return null;
    }

    const layer = normalizeSpectralLayer({
      ...layerInput,
      id: layerInput.id ?? createSpectralLayerId(),
    });

    captureSnapshot('Add spectral image layer');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            spectralLayers: [
              ...(audioState.spectralLayers ?? []),
              layer,
            ],
          },
        });
      }),
    });
    get().invalidateCache();
    return layer.id;
  },

  updateClipSpectralImageLayer: (clipId, layerId, patch) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot update spectral image layer on locked track', { clipId, layerId });
      return;
    }

    captureSnapshot('Update spectral image layer');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.spectralLayers?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            spectralLayers: currentClip.audioState.spectralLayers.map(layer =>
              layer.id === layerId
                ? normalizeSpectralLayer({ ...layer, ...patch })
                : layer
            ),
          },
        });
      }),
    });
    get().invalidateCache();
  },

  removeClipSpectralImageLayer: (clipId, layerId) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot remove spectral image layer on locked track', { clipId, layerId });
      return;
    }

    captureSnapshot('Remove spectral image layer');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.spectralLayers?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            spectralLayers: currentClip.audioState.spectralLayers.filter(layer => layer.id !== layerId),
          },
        });
      }),
    });
    get().invalidateCache();
  },
});
