import type {
  HistoryListEntry,
  HistoryTimelineEvent,
  ProjectHistoryState,
} from '../../types/history';
import type { HistoryBranch, HistoryState, StateSnapshot } from './historyStoreTypes';
import { createHistoryEntries, markActiveHistoryEntry } from './historyNavigation';
import {
  limitBranchForProject,
  limitSnapshotStackForProject,
  normalizePersistedBranches,
  normalizePersistedEventLog,
  normalizePersistedSnapshot,
  normalizePersistedSnapshotStack,
  normalizePersistedVisibleEntries,
} from './projectHistoryPersistence';
import { cloneHistoryForProject } from './snapshotCloning';

export interface SerializeHistoryProjectStateInput {
  undoStack: StateSnapshot[];
  redoStack: StateSnapshot[];
  currentSnapshot: StateSnapshot | null;
  eventLog: HistoryTimelineEvent[];
  branches: HistoryBranch[];
  maxHistorySize: number;
  navigationEntries: HistoryListEntry[] | null;
  activeEntryId: string | null;
  isHistoryDisabled: boolean;
  maxEventLogSize: number;
  maxHistoryBranches: number;
  maxPersistedHistorySnapshots: number;
  persistHistorySnapshots: boolean;
}

export function serializeHistoryForProject(
  input: SerializeHistoryProjectStateInput
): ProjectHistoryState {
  if (input.isHistoryDisabled) {
    return {
      schemaVersion: 1,
      undoStack: [],
      redoStack: [],
      currentSnapshot: null,
      eventLog: [],
      visibleEntries: [],
      branches: [],
      maxHistorySize: input.maxHistorySize,
    };
  }

  const persistentEventLog = input.eventLog.filter((event) => event.type !== 'autosave');
  const visibleEntries = markActiveHistoryEntry(
    input.navigationEntries ?? createHistoryEntries(
      input.undoStack,
      input.currentSnapshot,
      input.redoStack,
      input.eventLog,
      input.branches
    ),
    input.activeEntryId
  ).slice(-input.maxEventLogSize);

  if (!input.persistHistorySnapshots) {
    return {
      schemaVersion: 1,
      undoStack: [],
      redoStack: [],
      currentSnapshot: null,
      eventLog: persistentEventLog.slice(-input.maxEventLogSize),
      visibleEntries,
      branches: [],
      maxHistorySize: input.maxHistorySize,
    };
  }

  const persistedMaxHistorySize = Math.min(
    input.maxHistorySize,
    input.maxPersistedHistorySnapshots
  );

  return cloneHistoryForProject({
    schemaVersion: 1,
    undoStack: limitSnapshotStackForProject(
      input.undoStack,
      input.maxHistorySize,
      input.maxPersistedHistorySnapshots
    ),
    redoStack: limitSnapshotStackForProject(
      input.redoStack,
      input.maxHistorySize,
      input.maxPersistedHistorySnapshots
    ),
    currentSnapshot: input.currentSnapshot,
    eventLog: persistentEventLog.slice(-input.maxEventLogSize),
    visibleEntries,
    branches: input.branches
      .slice(-input.maxHistoryBranches)
      .map((branch) => limitBranchForProject(
        branch,
        input.maxHistorySize,
        input.maxPersistedHistorySnapshots
      )),
    maxHistorySize: persistedMaxHistorySize,
  });
}

export interface CreateHistoryProjectHydrationStateInput {
  history: ProjectHistoryState | null | undefined;
  currentMaxHistorySize: number;
  isHistoryDisabled: boolean;
  createInitialHistorySnapshot: () => StateSnapshot | null;
  maxEventLogSize: number;
  maxHistoryBranches: number;
  persistHistorySnapshots: boolean;
}

export function createHistoryProjectHydrationState(
  input: CreateHistoryProjectHydrationStateInput
): Partial<HistoryState> {
  const { history } = input;
  const maxHistorySize = Math.max(
    1,
    Math.floor(history?.maxHistorySize ?? input.currentMaxHistorySize)
  );

  if (input.isHistoryDisabled) {
    return {
      undoStack: [],
      redoStack: [],
      eventLog: [],
      branches: [],
      currentSnapshot: null,
      maxHistorySize,
      navigationEntries: null,
      navigationSnapshotsByEntryId: {},
      activeEntryId: null,
      isApplying: false,
      batchId: null,
      batchLabel: null,
    };
  }

  if (!history || history.schemaVersion !== 1) {
    return {
      undoStack: [],
      redoStack: [],
      eventLog: [],
      branches: [],
      currentSnapshot: input.createInitialHistorySnapshot(),
      maxHistorySize,
      navigationEntries: null,
      navigationSnapshotsByEntryId: {},
      activeEntryId: null,
      isApplying: false,
      batchId: null,
      batchLabel: null,
    };
  }

  if (!input.persistHistorySnapshots) {
    const visibleEntries = normalizePersistedVisibleEntries(
      history.visibleEntries,
      input.maxEventLogSize
    );
    const activeEntry = visibleEntries.find((entry) => entry.active);

    return {
      undoStack: [],
      redoStack: [],
      eventLog: normalizePersistedEventLog(history.eventLog, input.maxEventLogSize),
      branches: [],
      currentSnapshot: input.createInitialHistorySnapshot(),
      maxHistorySize,
      navigationEntries: visibleEntries.length > 0 ? visibleEntries : null,
      navigationSnapshotsByEntryId: {},
      activeEntryId: activeEntry?.id ?? null,
      isApplying: false,
      batchId: null,
      batchLabel: null,
    };
  }

  return {
    undoStack: normalizePersistedSnapshotStack(history.undoStack, maxHistorySize),
    redoStack: normalizePersistedSnapshotStack(history.redoStack, maxHistorySize),
    eventLog: normalizePersistedEventLog(history.eventLog, input.maxEventLogSize),
    branches: normalizePersistedBranches(
      history.branches,
      maxHistorySize,
      input.maxHistoryBranches
    ),
    currentSnapshot: normalizePersistedSnapshot(history.currentSnapshot)
      ?? input.createInitialHistorySnapshot(),
    maxHistorySize,
    navigationEntries: null,
    navigationSnapshotsByEntryId: {},
    activeEntryId: null,
    isApplying: false,
    batchId: null,
    batchLabel: null,
  };
}
