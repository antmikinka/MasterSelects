import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useHistoryStore } from '../../stores/historyStore';
import type { HistoryListEntry } from '../../types/history';
import './HistoryPanel.css';

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const chunkTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const HISTORY_CHUNK_MS = 10 * 60 * 1000;
const BRANCH_GRAPH_LANES = [1, -1, 2, -2] as const;
type BranchGraphLane = typeof BRANCH_GRAPH_LANES[number];
type GraphLane = 0 | BranchGraphLane;

const GRAPH_VIEWBOX_WIDTH = 826;
const GRAPH_ROW_HEIGHT = 52;
const MAIN_LANE_X = 444;
const LANE_X_BY_LANE: Record<GraphLane, number> = {
  [-2]: 136,
  [-1]: 290,
  0: MAIN_LANE_X,
  1: 598,
  2: 752,
};

interface HistoryGraphEntry extends HistoryListEntry {
  graphLane: GraphLane;
  pathIndex: number | null;
  branchStart: boolean;
  branchTip: boolean;
}

interface HistoryEntryGroup {
  id: string;
  title: string;
  rows: HistoryGraphRow[];
}

interface HistoryGraphRow {
  id: string;
  timestamp: number;
  pathIndex: number | null;
  entries: HistoryGraphEntry[];
}

interface HistoryBranchLine {
  id: string;
  lane: BranchGraphLane;
  d: string;
}

interface HistoryGraphLines {
  height: number;
  mainPath: string | null;
  branchLines: HistoryBranchLine[];
}

interface HistoryGraphPoint {
  rowIndex: number;
  x: number;
  y: number;
}

function formatHistoryLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : 'History change';
}

function formatEntryKind(entry: HistoryListEntry): string {
  if (entry.active) {
    return 'Current';
  }

  if (entry.kind === 'event') {
    switch (entry.eventType) {
      case 'manual-save':
        return 'Save';
      case 'autosave':
        return 'Autosave';
      default:
        return 'Event';
    }
  }

  if (entry.kind === 'branch') {
    return 'Branch';
  }

  switch (entry.kind) {
    case 'undoable':
      return 'Undo';
    case 'redoable':
      return 'Redo';
    case 'current':
      return 'Current';
  }

  return 'Event';
}

function getDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (getDayKey(timestamp) === getDayKey(today.getTime())) {
    return 'Today';
  }
  if (getDayKey(timestamp) === getDayKey(yesterday.getTime())) {
    return 'Yesterday';
  }
  return dateFormatter.format(date);
}

function formatChunkTitle(timestamp: number): string {
  const chunkStart = Math.floor(timestamp / HISTORY_CHUNK_MS) * HISTORY_CHUNK_MS;
  const chunkEnd = chunkStart + HISTORY_CHUNK_MS - 1;
  return `${formatDayLabel(timestamp)} / ${chunkTimeFormatter.format(new Date(chunkStart))}-${chunkTimeFormatter.format(new Date(chunkEnd))}`;
}

function createBranchLaneMap(entries: HistoryListEntry[]): Map<string, BranchGraphLane> {
  const branchIds = entries
    .filter((entry) => entry.kind === 'branch' && entry.branchId)
    .sort((left, right) => {
      const leftBase = left.branchBaseTimestamp ?? left.timestamp;
      const rightBase = right.branchBaseTimestamp ?? right.timestamp;
      return rightBase - leftBase || right.timestamp - left.timestamp;
    })
    .map((entry) => entry.branchId!)
    .filter((branchId, index, ids) => ids.indexOf(branchId) === index);

  return new Map(branchIds.map((branchId, index) => [
    branchId,
    BRANCH_GRAPH_LANES[index % BRANCH_GRAPH_LANES.length],
  ]));
}

function getOppositeBranchLane(lane: BranchGraphLane): BranchGraphLane {
  switch (lane) {
    case 1:
      return -1;
    case -1:
      return 1;
    case 2:
      return -2;
    case -2:
      return 2;
  }
}

function createMainLaneMap(entries: HistoryListEntry[], branchLaneById: Map<string, BranchGraphLane>): Map<number, GraphLane> {
  const laneByPathIndex = new Map<number, GraphLane>();

  for (const entry of entries) {
    if (
      entry.kind !== 'branch' ||
      !entry.branchId ||
      entry.branchBaseStackIndex === undefined ||
      entry.branchIndex === undefined
    ) {
      continue;
    }

    const branchLane = branchLaneById.get(entry.branchId);
    if (!branchLane) continue;

    const pathIndex = entry.branchBaseStackIndex + entry.branchIndex;
    if (!laneByPathIndex.has(pathIndex)) {
      laneByPathIndex.set(pathIndex, getOppositeBranchLane(branchLane));
    }
  }

  return laneByPathIndex;
}

function createGraphEntries(entries: HistoryListEntry[]): HistoryGraphEntry[] {
  const branchLaneById = createBranchLaneMap(entries);
  const mainLaneByPathIndex = createMainLaneMap(entries, branchLaneById);
  const currentPathIndex = entries.find((entry) => entry.kind === 'current')?.stackIndex ?? 0;

  return entries.map((entry) => {
    const branchIndex = entry.branchIndex ?? entry.stackIndex ?? -1;
    const branchLength = entry.branchLength ?? 0;
    const pathIndex = (() => {
      if (entry.kind === 'branch') {
        if (entry.branchBaseStackIndex === undefined || entry.branchIndex === undefined) return null;
        return entry.branchBaseStackIndex + entry.branchIndex;
      }
      if (entry.kind === 'redoable') {
        return currentPathIndex + (entry.stackIndex ?? 0) + 1;
      }
      if (entry.kind === 'undoable' || entry.kind === 'current') {
        return entry.stackIndex ?? null;
      }
      return null;
    })();
    const graphLane = (() => {
      if (entry.kind === 'branch' && entry.branchId) {
        return branchLaneById.get(entry.branchId) ?? 1;
      }
      if (pathIndex !== null) {
        return mainLaneByPathIndex.get(pathIndex) ?? 0;
      }
      return 0;
    })();

    return {
      ...entry,
      graphLane,
      pathIndex,
      branchStart: entry.kind === 'branch' && branchIndex === 0,
      branchTip: entry.kind === 'branch' && branchLength > 0 && branchIndex === branchLength - 1,
    };
  });
}

function createGraphRows(entries: HistoryGraphEntry[]): HistoryGraphRow[] {
  const rowById = new Map<string, HistoryGraphRow>();
  const kindPriority: Record<HistoryListEntry['kind'], number> = {
    event: 0,
    current: 1,
    branch: 2,
    undoable: 3,
    redoable: 4,
  };

  for (const entry of entries) {
    const rowId = entry.pathIndex === null
      ? `event:${entry.timestamp}:${entry.id}`
      : `path:${entry.pathIndex}`;
    const existing = rowById.get(rowId);

    if (existing) {
      existing.entries.push(entry);
      existing.timestamp = Math.max(existing.timestamp, entry.timestamp);
      continue;
    }

    rowById.set(rowId, {
      id: rowId,
      timestamp: entry.timestamp,
      pathIndex: entry.pathIndex,
      entries: [entry],
    });
  }

  return Array.from(rowById.values())
    .map((row) => ({
      ...row,
      entries: row.entries.toSorted((left, right) => {
        if (left.graphLane !== right.graphLane) return left.graphLane - right.graphLane;
        return kindPriority[left.kind] - kindPriority[right.kind];
      }),
    }))
    .toSorted((left, right) => {
      if (left.pathIndex !== null && right.pathIndex !== null) {
        return right.pathIndex - left.pathIndex;
      }
      if (left.pathIndex !== null) return -1;
      if (right.pathIndex !== null) return 1;
      return right.timestamp - left.timestamp;
    });
}

function createHistoryGroups(rows: HistoryGraphRow[]): HistoryEntryGroup[] {
  const groups = new Map<string, HistoryEntryGroup>();

  for (const row of rows) {
    const chunkStart = Math.floor(row.timestamp / HISTORY_CHUNK_MS) * HISTORY_CHUNK_MS;
    const groupId = `${getDayKey(row.timestamp)}:${chunkStart}`;
    const existing = groups.get(groupId);
    if (existing) {
      existing.rows.push(row);
      continue;
    }

    groups.set(groupId, {
      id: groupId,
      title: formatChunkTitle(row.timestamp),
      rows: [row],
    });
  }

  return Array.from(groups.values());
}

function entryClassName(entry: HistoryGraphEntry): string {
  return [
    'history-panel-entry',
    `history-panel-entry-${entry.kind}`,
    entry.eventType ? `history-panel-entry-${entry.eventType}` : '',
    entry.branchStart ? 'history-panel-entry-branch-start' : '',
    entry.branchTip ? 'history-panel-entry-branch-tip' : '',
    entry.active ? 'history-panel-entry-current' : '',
    entry.highlighted ? 'history-panel-entry-highlighted' : '',
  ].filter(Boolean).join(' ');
}

function graphLaneClassName(lane: GraphLane): string {
  switch (lane) {
    case -2:
      return 'history-panel-lane-left-2';
    case -1:
      return 'history-panel-lane-left-1';
    case 1:
      return 'history-panel-lane-right-1';
    case 2:
      return 'history-panel-lane-right-2';
    default:
      return 'history-panel-lane-main';
  }
}

function graphRowClassName(row: HistoryGraphRow): string {
  const hasBranchStart = row.entries.some((entry) => entry.branchStart);
  const hasBranchTip = row.entries.some((entry) => entry.branchTip);

  return [
    'history-panel-graph-row',
    hasBranchStart ? 'history-panel-graph-row-branch-start' : '',
    hasBranchTip ? 'history-panel-graph-row-branch-tip' : '',
  ].filter(Boolean).join(' ');
}

function graphNodeClassName(entry: HistoryGraphEntry): string {
  return [
    'history-panel-node',
    graphLaneClassName(entry.graphLane),
  ].join(' ');
}

function isJumpableEntry(entry: HistoryListEntry): boolean {
  return entry.kind === 'undoable' || entry.kind === 'redoable' || entry.kind === 'branch';
}

function createBranchStepLabel(entry: HistoryListEntry): string {
  if (entry.kind !== 'branch' || entry.branchIndex === undefined || !entry.branchLength) {
    return '';
  }
  return ` / ${entry.branchIndex + 1} of ${entry.branchLength}`;
}

function getRowCenterY(rowIndex: number): number {
  return rowIndex * GRAPH_ROW_HEIGHT + GRAPH_ROW_HEIGHT / 2;
}

function createBranchCurvePath(
  lane: BranchGraphLane,
  baseX: number,
  baseY: number,
  branchStartY: number,
  branchTipY: number
): string {
  const laneX = LANE_X_BY_LANE[lane];
  const horizontalDelta = laneX - baseX;
  const direction = horizontalDelta > 0 ? 1 : -1;
  const baseControlY = baseY - GRAPH_ROW_HEIGHT * 0.18;
  const laneControlY = branchStartY + GRAPH_ROW_HEIGHT * 0.16;
  const laneApproachX = laneX - direction * Math.min(78, Math.abs(horizontalDelta) * 0.42);

  return [
    `M ${baseX} ${baseY}`,
    `C ${baseX} ${baseControlY} ${laneApproachX} ${laneControlY} ${laneX} ${branchStartY}`,
    `L ${laneX} ${branchTipY}`,
  ].join(' ');
}

function createSmoothGraphPath(points: HistoryGraphPoint[]): string | null {
  if (points.length === 0) return null;
  if (points.length === 1) {
    const point = points[0]!;
    return `M ${point.x} ${point.y - GRAPH_ROW_HEIGHT * 0.32} L ${point.x} ${point.y + GRAPH_ROW_HEIGHT * 0.32}`;
  }

  const orderedPoints = points.toSorted((left, right) => right.rowIndex - left.rowIndex);
  const firstPoint = orderedPoints[0]!;
  let path = `M ${firstPoint.x} ${firstPoint.y}`;

  for (let index = 1; index < orderedPoints.length; index += 1) {
    const previousPoint = orderedPoints[index - 1]!;
    const point = orderedPoints[index]!;
    if (previousPoint.x === point.x) {
      path += ` L ${point.x} ${point.y}`;
      continue;
    }

    const bend = Math.min(52, Math.abs(previousPoint.y - point.y) * 0.6);
    path += ` C ${previousPoint.x} ${previousPoint.y - bend} ${point.x} ${point.y + bend} ${point.x} ${point.y}`;
  }

  return path;
}

function createGraphLines(rows: HistoryGraphRow[]): HistoryGraphLines {
  const height = Math.max(GRAPH_ROW_HEIGHT, rows.length * GRAPH_ROW_HEIGHT);
  const rowIndexByPathIndex = new Map<number, number>();
  const mainPoints: HistoryGraphPoint[] = [];
  const mainPointByRowIndex = new Map<number, HistoryGraphPoint>();
  const branchEntriesById = new Map<string, HistoryGraphEntry[]>();

  rows.forEach((row, rowIndex) => {
    if (row.pathIndex !== null) {
      rowIndexByPathIndex.set(row.pathIndex, rowIndex);
    }

    const mainEntry = row.entries.find((entry) => (
      entry.kind === 'undoable' || entry.kind === 'current' || entry.kind === 'redoable'
    ));
    if (mainEntry) {
      const point = {
        rowIndex,
        x: LANE_X_BY_LANE[mainEntry.graphLane],
        y: getRowCenterY(rowIndex),
      };
      mainPoints.push(point);
      mainPointByRowIndex.set(rowIndex, point);
    }

    for (const entry of row.entries) {
      if (entry.kind !== 'branch' || !entry.branchId || entry.graphLane === 0) continue;
      const existing = branchEntriesById.get(entry.branchId);
      if (existing) {
        existing.push(entry);
      } else {
        branchEntriesById.set(entry.branchId, [entry]);
      }
    }
  });

  const mainPath = createSmoothGraphPath(mainPoints);

  const branchLines = Array.from(branchEntriesById.entries()).map(([branchId, branchEntries]) => {
    const lane = branchEntries[0]!.graphLane as BranchGraphLane;
    const branchRowIndices = branchEntries
      .map((entry) => rows.findIndex((row) => row.entries.includes(entry)))
      .filter((rowIndex) => rowIndex >= 0);
    const branchStartRowIndex = Math.max(...branchRowIndices);
    const branchTipRowIndex = Math.min(...branchRowIndices);
    const basePathIndex = branchEntries[0]!.branchBaseStackIndex;
    const baseRowIndex = basePathIndex === undefined
      ? undefined
      : rowIndexByPathIndex.get(basePathIndex - 1);
    const baseY = baseRowIndex === undefined
      ? getRowCenterY(branchStartRowIndex) + GRAPH_ROW_HEIGHT * 0.82
      : getRowCenterY(baseRowIndex);
    const baseX = baseRowIndex === undefined
      ? MAIN_LANE_X
      : mainPointByRowIndex.get(baseRowIndex)?.x ?? MAIN_LANE_X;

    return {
      id: branchId,
      lane,
      d: createBranchCurvePath(
        lane,
        baseX,
        baseY,
        getRowCenterY(branchStartRowIndex),
        getRowCenterY(branchTipRowIndex)
      ),
    };
  });

  return {
    height,
    mainPath,
    branchLines,
  };
}

export function HistoryPanel() {
  const historySummary = useHistoryStore(useShallow((state) => {
    const lastUndo = state.undoStack[state.undoStack.length - 1] ?? null;
    const lastRedo = state.redoStack[state.redoStack.length - 1] ?? null;
    const current = state.currentSnapshot;
    const visibleEventSignature = state.eventLog
      .filter((event) => event.type !== 'autosave')
      .map((event) => `${event.id}:${event.timestamp}`)
      .join('|');
    const branchSignature = state.branches
      .map((branch) => {
        const tip = branch.snapshots[branch.snapshots.length - 1] ?? null;
        return `${branch.id}:${branch.createdAt}:${branch.label}:${branch.snapshots.length}:${tip?.timestamp ?? ''}`;
      })
      .join('|');

    return {
      undoCount: state.undoStack.length,
      undoTail: lastUndo ? `${lastUndo.timestamp}:${lastUndo.label}` : '',
      redoCount: state.redoStack.length,
      redoTail: lastRedo ? `${lastRedo.timestamp}:${lastRedo.label}` : '',
      current: current ? `${current.timestamp}:${current.label}` : '',
      visibleEventSignature,
      branchSignature,
    };
  }));
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  const restoreEntry = useHistoryStore((state) => state.restoreEntry);
  const canUndo = historySummary.undoCount > 0;
  const canRedo = historySummary.redoCount > 0;
  const entries = useHistoryStore.getState().getHistoryEntries();
  const graphEntries = useMemo(() => createGraphEntries(entries), [entries]);
  const graphRows = useMemo(() => createGraphRows(graphEntries), [graphEntries]);
  const groups = useMemo(() => createHistoryGroups(graphRows), [graphRows]);

  const counts = useMemo(() => {
    const branchIds = new Set(
      entries
        .filter((entry) => entry.kind === 'branch' && entry.branchId)
        .map((entry) => entry.branchId!)
    );

    return {
      undoable: entries.filter((entry) => entry.kind === 'undoable').length,
      redoable: entries.filter((entry) => entry.kind === 'redoable').length,
      saves: entries.filter((entry) => entry.eventType === 'manual-save').length,
      branches: branchIds.size,
    };
  }, [entries]);

  return (
    <div className="history-panel">
      <div className="history-panel-toolbar">
        <div className="history-panel-heading">
          <h2>History</h2>
          <span>{counts.undoable} undo / {counts.redoable} redo / {counts.saves} saves / {counts.branches} branches</span>
        </div>
        <div className="history-panel-actions">
          <button type="button" onClick={() => undo()} disabled={!canUndo}>
            Undo
          </button>
          <button type="button" onClick={() => redo()} disabled={!canRedo}>
            Redo
          </button>
        </div>
      </div>

      {graphEntries.length === 0 ? (
        <div className="history-panel-empty">
          No history yet
        </div>
      ) : (
        <div className="history-panel-list">
          {groups.map((group) => {
            const graphLines = createGraphLines(group.rows);

            return (
              <section key={group.id} className="history-panel-group">
                <div className="history-panel-group-header">
                  <span>{group.title}</span>
                  <span>{group.rows.reduce((total, row) => total + row.entries.length, 0)}</span>
                </div>
                <ol
                  className="history-panel-graph"
                  style={{ minHeight: graphLines.height }}
                >
                  <svg
                    className="history-panel-graph-lines"
                    viewBox={`0 0 ${GRAPH_VIEWBOX_WIDTH} ${graphLines.height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {graphLines.mainPath && (
                      <path
                        className="history-panel-graph-line history-panel-graph-line-main"
                        d={graphLines.mainPath}
                      />
                    )}
                    {graphLines.branchLines.map((line) => (
                      <path
                        key={line.id}
                        className={`history-panel-graph-line history-panel-graph-line-branch ${graphLaneClassName(line.lane)}`}
                        d={line.d}
                      />
                    ))}
                  </svg>
                  {group.rows.map((row) => (
                    <li
                      key={row.id}
                      className={graphRowClassName(row)}
                    >
                      <span className="history-panel-row-time">
                        {timeFormatter.format(new Date(row.timestamp))}
                      </span>
                      {row.entries.map((entry) => (
                        <div
                          key={entry.id}
                          className={graphNodeClassName(entry)}
                        >
                          <div
                            className={entryClassName(entry)}
                            role={isJumpableEntry(entry) ? 'button' : undefined}
                            tabIndex={isJumpableEntry(entry) ? 0 : undefined}
                            onClick={isJumpableEntry(entry) ? () => restoreEntry(entry) : undefined}
                            onKeyDown={isJumpableEntry(entry) ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                restoreEntry(entry);
                              }
                            } : undefined}
                          >
                            <span className="history-panel-entry-marker" aria-hidden="true" />
                            <span className="history-panel-entry-main">
                              <span className="history-panel-entry-label">{formatHistoryLabel(entry.label)}</span>
                              <span className="history-panel-entry-time">
                                {entry.kind === 'branch' && entry.branchLabel ? entry.branchLabel : formatEntryKind(entry)}
                                {createBranchStepLabel(entry)}
                              </span>
                            </span>
                            <span className="history-panel-entry-kind">{formatEntryKind(entry)}</span>
                          </div>
                        </div>
                      ))}
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
