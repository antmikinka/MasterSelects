import type { FileImportResult, MediaFile, MediaSliceCreator, MediaState } from '../../types';
import { processGaussianSplatSequenceImport } from '../../helpers/gaussianSplatSequenceImport';
import { processModelSequenceImport } from '../../helpers/modelSequenceImport';
import { processImport } from '../../helpers/importPipeline';
import { fileSystemService } from '../../../../services/fileSystemService';
import { projectDB } from '../../../../services/projectDB';
import type { FileImportActions } from '../fileImportSlice';
import { commitSignalAsset } from './signalAssetCommit';
import {
  resolveImportEntry,
  runSignalImport,
  type ResolvedImportEntry,
  type ResolvedLegacyImportEntry,
  type ResolvedSignalImportEntry,
} from './importPlanning';
import {
  createGaussianSplatSequencePlaceholder,
  createPlaceholder,
  createSequencePlaceholder,
  finalizeImportedMediaFile,
  updatePlaceholderImportProgress,
} from './placeholderLifecycle';
import { splitModelSequenceEntries } from './sequencePlanning';
import { fileImportLog as log } from './log';

type MediaSliceSet = (
  partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)
) => void;

type MediaSliceGet = () => MediaState;

function splitResolvedEntries(entries: ResolvedImportEntry[]): {
  signalEntries: ResolvedSignalImportEntry[];
  modelSequences: ReturnType<typeof splitModelSequenceEntries>['modelSequences'];
  gaussianSplatSequences: ReturnType<typeof splitModelSequenceEntries>['gaussianSplatSequences'];
  singles: ResolvedLegacyImportEntry[];
} {
  const signalEntries = entries.filter((entry): entry is ResolvedSignalImportEntry => entry.route === 'signal');
  const legacyEntries = entries.filter((entry): entry is ResolvedLegacyImportEntry => entry.route === 'legacy-media');
  return {
    signalEntries,
    ...splitModelSequenceEntries(legacyEntries),
  };
}

function addLegacyPlaceholders(
  set: MediaSliceSet,
  groups: ReturnType<typeof splitResolvedEntries>,
  parentId?: string | null,
): void {
  set((state) => ({
    files: [
      ...state.files,
      ...groups.singles.map((entry) => createPlaceholder(entry.file, entry.id, entry.type, parentId)),
      ...groups.modelSequences.map((sequence) => createSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
      ...groups.gaussianSplatSequences.map((sequence) => createGaussianSplatSequencePlaceholder(sequence, sequence.entries[0]!.id, parentId)),
    ],
  }));
}

async function importSignalEntries(
  set: MediaSliceSet,
  entries: ResolvedSignalImportEntry[],
  imported: FileImportResult[],
  parentId?: string | null,
): Promise<void> {
  for (const entry of entries) {
    try {
      const signalAsset = await runSignalImport(entry, parentId);
      commitSignalAsset(set, signalAsset);
      imported.push(signalAsset);
    } catch (err) {
      log.error(`Signal import failed: ${entry.file.name}`, err);
    }
  }
}

async function importModelSequences(
  set: MediaSliceSet,
  get: MediaSliceGet,
  sequences: ReturnType<typeof splitModelSequenceEntries>['modelSequences'],
  imported: FileImportResult[],
  options: { parentId?: string | null; includeParentId: boolean },
): Promise<void> {
  for (const sequence of sequences) {
    const sequenceId = sequence.entries[0]!.id;
    try {
      let lastProgress = -1;
      const result = await processModelSequenceImport({
        id: sequenceId,
        ...(options.includeParentId ? { parentId: options.parentId } : {}),
        sequence,
        onProgress: (progress) => {
          const normalized = Math.max(0, Math.min(100, Math.round(progress)));
          if (normalized === lastProgress) return;
          lastProgress = normalized;
          set((state) => updatePlaceholderImportProgress(state, sequenceId, normalized));
        },
      });
      finalizeImportedMediaFile(set, get, sequenceId, result);
      imported.push(result);
    } catch (err) {
      log.error(`Sequence import failed: ${sequence.displayName}`, err);
      set((state) => ({
        files: state.files.filter((f) => f.id !== sequenceId),
      }));
    }
  }
}

async function importGaussianSplatSequences(
  set: MediaSliceSet,
  get: MediaSliceGet,
  sequences: ReturnType<typeof splitModelSequenceEntries>['gaussianSplatSequences'],
  imported: FileImportResult[],
  options: { parentId?: string | null; includeParentId: boolean },
): Promise<void> {
  for (const sequence of sequences) {
    const sequenceId = sequence.entries[0]!.id;
    try {
      let lastProgress = -1;
      const result = await processGaussianSplatSequenceImport({
        id: sequenceId,
        ...(options.includeParentId ? { parentId: options.parentId } : {}),
        sequence,
        onProgress: (progress) => {
          const normalized = Math.max(0, Math.min(100, Math.round(progress)));
          if (normalized === lastProgress) return;
          lastProgress = normalized;
          set((state) => updatePlaceholderImportProgress(state, sequenceId, normalized));
        },
      });
      finalizeImportedMediaFile(set, get, sequenceId, result);
      imported.push(result);
    } catch (err) {
      log.error(`Sequence import failed: ${sequence.displayName}`, err);
      set((state) => ({
        files: state.files.filter((f) => f.id !== sequenceId),
      }));
    }
  }
}

async function importPlainSinglesInBatches(
  set: MediaSliceSet,
  get: MediaSliceGet,
  singles: ResolvedLegacyImportEntry[],
  imported: FileImportResult[],
  parentId?: string | null,
): Promise<void> {
  const batchSize = 3;
  for (let i = 0; i < singles.length; i += batchSize) {
    const batch = singles.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async ({ file, id, type }) => {
        try {
          const result = await processImport({ file, id, parentId, typeOverride: type });
          finalizeImportedMediaFile(set, get, id, result.mediaFile);
          return result.mediaFile;
        } catch (err) {
          log.error(`Import failed: ${file.name}`, err);
          set((state) => ({
            files: state.files.filter((f) => f.id !== id),
          }));
          return null;
        }
      })
    );
    imported.push(...results.filter((result): result is MediaFile => result !== null));
  }
}

async function importHandleSingles(
  set: MediaSliceSet,
  get: MediaSliceGet,
  singles: ResolvedLegacyImportEntry[],
  imported: FileImportResult[],
  options: { parentId?: string | null; includeParentId: boolean; includeAbsolutePath: boolean },
): Promise<void> {
  for (const { file, handle, absolutePath, id, type } of singles) {
    if (handle) {
      fileSystemService.storeFileHandle(id, handle);
      await projectDB.storeHandle(`media_${id}`, handle);
      log.debug('Stored file handle for ID:', id);
    }

    try {
      const importResult = await processImport({
        file,
        id,
        handle,
        ...(options.includeAbsolutePath ? { absolutePath } : {}),
        ...(options.includeParentId ? { parentId: options.parentId } : {}),
        typeOverride: type,
      });
      finalizeImportedMediaFile(set, get, id, importResult.mediaFile);
      imported.push(importResult.mediaFile);
    } catch (err) {
      log.error(`Import failed: ${file.name}`, err);
      set((state) => ({
        files: state.files.filter((f) => f.id !== id),
      }));
    }
  }
}

async function importGroupedLegacyEntries(
  set: MediaSliceSet,
  get: MediaSliceGet,
  groups: ReturnType<typeof splitResolvedEntries>,
  imported: FileImportResult[],
  options: {
    parentId?: string | null;
    includeParentId: boolean;
    handleSingles: boolean;
    includeAbsolutePath?: boolean;
  },
): Promise<void> {
  await importModelSequences(set, get, groups.modelSequences, imported, options);
  await importGaussianSplatSequences(set, get, groups.gaussianSplatSequences, imported, options);

  if (options.handleSingles) {
    await importHandleSingles(set, get, groups.singles, imported, {
      parentId: options.parentId,
      includeParentId: options.includeParentId,
      includeAbsolutePath: options.includeAbsolutePath === true,
    });
    return;
  }

  await importPlainSinglesInBatches(set, get, groups.singles, imported, options.parentId);
}

export const createBatchFileImportActions: MediaSliceCreator<Pick<
  FileImportActions,
  'importFiles' | 'importFilesWithPicker' | 'importFilesWithHandles'
>> = (set, get) => ({
  importFiles: async (files: FileList | File[], parentId?: string | null) => {
    const fileArray = Array.from(files);
    const imported: FileImportResult[] = [];

    const entries = await Promise.all(fileArray.map(async (file) => resolveImportEntry(file)));
    const groups = splitResolvedEntries(entries);

    addLegacyPlaceholders(set, groups, parentId);
    await importSignalEntries(set, groups.signalEntries, imported, parentId);
    await importGroupedLegacyEntries(set, get, groups, imported, {
      parentId,
      includeParentId: true,
      handleSingles: false,
    });

    return imported;
  },

  importFilesWithPicker: async () => {
    const result = await fileSystemService.pickFiles();
    if (!result || result.length === 0) return [];

    const imported: FileImportResult[] = [];
    const entries = await Promise.all(result.map(async ({ file, handle }) => (
      resolveImportEntry(file, { handle })
    )));
    const groups = splitResolvedEntries(entries);

    addLegacyPlaceholders(set, groups);
    await importSignalEntries(set, groups.signalEntries, imported);
    await importGroupedLegacyEntries(set, get, groups, imported, {
      includeParentId: false,
      handleSingles: true,
    });

    return imported;
  },

  importFilesWithHandles: async (filesWithHandles, parentId?: string | null) => {
    const imported: FileImportResult[] = [];

    const entries = await Promise.all(filesWithHandles.map(async ({ file, handle, absolutePath }) => (
      resolveImportEntry(file, { handle, absolutePath })
    )));
    const groups = splitResolvedEntries(entries);

    addLegacyPlaceholders(set, groups, parentId);
    await importSignalEntries(set, groups.signalEntries, imported, parentId);
    await importGroupedLegacyEntries(set, get, groups, imported, {
      parentId,
      includeParentId: true,
      handleSingles: true,
      includeAbsolutePath: true,
    });

    return imported;
  },
});
