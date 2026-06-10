import type { HistoryListEntry } from '../../types/history';
import type { HistoryRestoreResult, HistoryState, StateSnapshot } from './historyStoreTypes';
import { createHistoryNavigationState } from './historyNavigation';
import { cloneSnapshotStack, deepClone } from './snapshotCloning';

type HistoryStateSetter = (state: Partial<HistoryState>) => void;

export interface HistoryRestoreActionContext {
  get: () => HistoryState;
  set: HistoryStateSetter;
  applySnapshot: (snapshot: StateSnapshot) => void;
  isHistoryDisabledForDebug: () => boolean;
  isTimelineHistoryLocked: () => boolean;
  flushPendingCapture: () => void;
  suppressCaptures: () => void;
  log: {
    warn: (message: string) => void;
    debug: (message: string) => void;
  };
}

export function restoreHistoryEntryAction(
  entry: HistoryListEntry,
  context: HistoryRestoreActionContext
): HistoryRestoreResult | null {
  if (context.isHistoryDisabledForDebug()) return null;

  if (entry.kind === 'branch' && entry.branchId) {
    return context.get().restoreBranch(entry.branchId, entry.stackIndex);
  }
  if (entry.kind === 'event' || entry.kind === 'current') {
    return null;
  }
  if (typeof entry.stackIndex !== 'number') {
    return null;
  }
  if (context.isTimelineHistoryLocked()) {
    context.log.warn('Blocked history jump during timeline export');
    return null;
  }

  if (context.get().batchId !== null) {
    context.get().endBatch();
  }

  context.flushPendingCapture();

  const {
    undoStack,
    currentSnapshot,
    redoStack,
    eventLog,
    branches,
    navigationEntries,
    navigationSnapshotsByEntryId,
  } = context.get();
  const navigationState = navigationEntries
    ? { entries: navigationEntries, snapshotsByEntryId: navigationSnapshotsByEntryId }
    : createHistoryNavigationState(undoStack, currentSnapshot, redoStack, eventLog, branches);
  let targetSnapshot: StateSnapshot | undefined;
  let nextUndoStack: StateSnapshot[] = [];
  let nextRedoStack: StateSnapshot[] = [];

  if (entry.kind === 'undoable') {
    targetSnapshot = undoStack[entry.stackIndex];
    nextUndoStack = undoStack.slice(0, entry.stackIndex);
    nextRedoStack = [
      ...undoStack.slice(entry.stackIndex + 1),
      ...(currentSnapshot ? [currentSnapshot] : []),
      ...redoStack.slice().reverse(),
    ].reverse();
  } else if (entry.kind === 'redoable') {
    const redoPath = redoStack.slice().reverse();
    targetSnapshot = redoPath[entry.stackIndex];
    nextUndoStack = [
      ...undoStack,
      ...(currentSnapshot ? [currentSnapshot] : []),
      ...redoPath.slice(0, entry.stackIndex),
    ];
    nextRedoStack = redoPath.slice(entry.stackIndex + 1).reverse();
  }

  if (!targetSnapshot) return null;

  context.set({ isApplying: true });
  context.applySnapshot(targetSnapshot);
  context.set({
    undoStack: cloneSnapshotStack(nextUndoStack),
    redoStack: cloneSnapshotStack(nextRedoStack),
    currentSnapshot: deepClone(targetSnapshot),
    navigationEntries: navigationState.entries,
    navigationSnapshotsByEntryId: navigationState.snapshotsByEntryId,
    activeEntryId: entry.id,
    isApplying: false,
  });

  context.suppressCaptures();

  context.log.debug(`Jump to history entry: ${entry.label}`);
  return { operation: 'restore-branch', label: entry.label };
}

export function restoreHistoryBranchAction(
  branchId: string,
  snapshotIndex: number | undefined,
  context: HistoryRestoreActionContext
): HistoryRestoreResult | null {
  if (context.isHistoryDisabledForDebug()) return null;

  if (context.isTimelineHistoryLocked()) {
    context.log.warn('Blocked branch restore during timeline export');
    return null;
  }

  if (context.get().batchId !== null) {
    context.get().endBatch();
  }

  context.flushPendingCapture();

  const {
    undoStack,
    currentSnapshot,
    redoStack,
    eventLog,
    branches,
    navigationEntries,
    navigationSnapshotsByEntryId,
  } = context.get();
  const branch = branches.find((candidate) => candidate.id === branchId);
  if (!branch) return null;

  const targetSnapshotIndex = Math.max(
    0,
    Math.min(
      branch.snapshots.length - 1,
      typeof snapshotIndex === 'number' ? Math.floor(snapshotIndex) : branch.snapshots.length - 1
    )
  );
  const branchPath = [
    ...branch.baseUndoStack,
    ...(branch.baseSnapshot ? [branch.baseSnapshot] : []),
    ...branch.snapshots.slice(0, targetSnapshotIndex + 1),
  ];
  const branchTip = branchPath[branchPath.length - 1];
  if (!branchTip) return null;

  const nextRedoStack = branch.snapshots.slice(targetSnapshotIndex + 1).reverse();
  const navigationState = navigationEntries
    ? { entries: navigationEntries, snapshotsByEntryId: navigationSnapshotsByEntryId }
    : createHistoryNavigationState(undoStack, currentSnapshot, redoStack, eventLog, branches);
  const activeEntryId = navigationState.entries.find((candidate) => (
    candidate.kind === 'branch' &&
    candidate.branchId === branchId &&
    candidate.stackIndex === targetSnapshotIndex
  ))?.id ?? null;

  context.set({ isApplying: true });
  context.applySnapshot(branchTip);
  context.set({
    undoStack: cloneSnapshotStack(branchPath.slice(0, -1)),
    redoStack: cloneSnapshotStack(nextRedoStack),
    currentSnapshot: deepClone(branchTip),
    navigationEntries: navigationState.entries,
    navigationSnapshotsByEntryId: navigationState.snapshotsByEntryId,
    activeEntryId,
    isApplying: false,
  });

  context.suppressCaptures();

  context.log.debug(`Restore branch: ${branch.label}`);
  return { operation: 'restore-branch', label: branch.label };
}
