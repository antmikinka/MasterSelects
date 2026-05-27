export type HistoryEntryKind = 'undoable' | 'current' | 'redoable' | 'event' | 'branch';
export type HistoryEventType = 'manual-save' | 'autosave' | 'system';

export interface HistoryListEntry {
  id: string;
  kind: HistoryEntryKind;
  label: string;
  timestamp: number;
  stackIndex?: number;
  eventType?: HistoryEventType;
  branchId?: string;
  branchLabel?: string;
  branchIndex?: number;
  branchBaseStackIndex?: number;
  branchBaseTimestamp?: number;
  branchLength?: number;
  active?: boolean;
  highlighted?: boolean;
}

export interface HistoryTimelineEvent {
  id: string;
  type: HistoryEventType;
  label: string;
  timestamp: number;
}

export interface ProjectHistoryBranchState {
  id: string;
  label: string;
  createdAt: number;
  baseSnapshot: unknown | null;
  baseUndoStack: unknown[];
  snapshots: unknown[];
}

export interface ProjectHistoryState {
  schemaVersion: 1;
  undoStack: unknown[];
  redoStack: unknown[];
  currentSnapshot: unknown | null;
  eventLog?: HistoryTimelineEvent[];
  visibleEntries?: HistoryListEntry[];
  branches?: ProjectHistoryBranchState[];
  maxHistorySize?: number;
}
