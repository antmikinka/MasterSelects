const state = {
  snapshot: null,
  expanded: new Set(['.']),
  selectedId: '.',
  previousLines: new Map(),
  lineDeltas: new Map(),
  changeHistory: [],
  latestChange: null,
  lastEventKey: null,
  pendingFlash: null,
  flashedEventKey: null,
  sort: {
    key: 'name',
    direction: 'asc',
  },
  filter: '',
  scanning: false,
};

const CHANGE_HISTORY_LIMIT = 3;

const elements = {
  rootPath: document.getElementById('rootPath'),
  metricLines: document.getElementById('metricLines'),
  metricNonBlank: document.getElementById('metricNonBlank'),
  metricFiles: document.getElementById('metricFiles'),
  metricChanged: document.getElementById('metricChanged'),
  metricScan: document.getElementById('metricScan'),
  chooseFolderButton: document.getElementById('chooseFolderButton'),
  emptyChooseButton: document.getElementById('emptyChooseButton'),
  refreshButton: document.getElementById('refreshButton'),
  treeFilter: document.getElementById('treeFilter'),
  tree: document.getElementById('tree'),
  selectionDetails: document.getElementById('selectionDetails'),
  largestFiles: document.getElementById('largestFiles'),
  changedFiles: document.getElementById('changedFiles'),
  gitState: document.getElementById('gitState'),
  emptyState: document.getElementById('emptyState'),
  sortButtons: [...document.querySelectorAll('.sort-button')],
};

if (!window.refactorMonitor) {
  const sampleSnapshot = {
    rootPath: 'Preview sample',
    scannedAt: new Date().toISOString(),
    summary: {
      lines: 14993,
      nonBlank: 13202,
      files: 8,
      directories: 4,
      changedFiles: 3,
      skippedFiles: 0,
      size: 512000,
    },
    tree: {
      id: '.',
      name: 'MasterSelects-253',
      relativePath: '',
      type: 'directory',
      lines: 14993,
      nonBlank: 13202,
      size: 512000,
      fileCount: 8,
      dirCount: 4,
      changedCount: 3,
      children: [
        {
          id: 'src',
          name: 'src',
          relativePath: 'src',
          type: 'directory',
          lines: 14993,
          nonBlank: 13202,
          size: 512000,
          fileCount: 8,
          dirCount: 3,
          changedCount: 3,
          children: [
            {
              id: 'src/components/timeline',
              name: 'timeline',
              relativePath: 'src/components/timeline',
              type: 'directory',
              lines: 8953,
              nonBlank: 7930,
              size: 310000,
              fileCount: 4,
              dirCount: 0,
              changedCount: 2,
              children: [
                {
                  id: 'src/components/timeline/Timeline.tsx',
                  name: 'Timeline.tsx',
                  relativePath: 'src/components/timeline/Timeline.tsx',
                  type: 'file',
                  lines: 4122,
                  nonBlank: 3748,
                  size: 170000,
                  fileCount: 1,
                  dirCount: 0,
                  changedCount: 1,
                  gitStatus: 'M',
                },
                {
                  id: 'src/components/timeline/TimelineClipCanvas.tsx',
                  name: 'TimelineClipCanvas.tsx',
                  relativePath: 'src/components/timeline/TimelineClipCanvas.tsx',
                  type: 'file',
                  lines: 2475,
                  nonBlank: 2273,
                  size: 88000,
                  fileCount: 1,
                  dirCount: 0,
                  changedCount: 1,
                  gitStatus: 'M',
                },
              ],
            },
            {
              id: 'src/timeline',
              name: 'timeline',
              relativePath: 'src/timeline',
              type: 'directory',
              lines: 2950,
              nonBlank: 2748,
              size: 88000,
              fileCount: 2,
              dirCount: 0,
              changedCount: 1,
              children: [
                {
                  id: 'src/timeline/architecture/gateRegistry.ts',
                  name: 'gateRegistry.ts',
                  relativePath: 'src/timeline/architecture/gateRegistry.ts',
                  type: 'file',
                  lines: 213,
                  nonBlank: 205,
                  size: 8000,
                  fileCount: 1,
                  dirCount: 0,
                  changedCount: 1,
                  gitStatus: '??',
                },
              ],
            },
          ],
        },
      ],
    },
    largestFiles: [
      { path: 'src/components/timeline/Timeline.tsx', lines: 4122, nonBlank: 3748, gitStatus: 'M' },
      { path: 'src/components/timeline/TimelineClipCanvas.tsx', lines: 2475, nonBlank: 2273, gitStatus: 'M' },
      { path: 'src/timeline/architecture/gateRegistry.ts', lines: 213, nonBlank: 205, gitStatus: '??' },
    ],
    git: {
      available: true,
      changed: [
        { path: 'src/components/timeline/Timeline.tsx', status: 'M' },
        { path: 'src/components/timeline/TimelineClipCanvas.tsx', status: 'M' },
        { path: 'src/timeline/architecture/gateRegistry.ts', status: '??' },
      ],
    },
  };

  window.refactorMonitor = {
    chooseFolder: async () => sampleSnapshot,
    getState: async () => sampleSnapshot,
    refresh: async () => sampleSnapshot,
    onSnapshot: () => () => {},
    onScanStarted: () => () => {},
    onError: () => () => {},
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTime(value) {
  if (!value) return 'Idle';
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function parentPaths(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || normalized === '.') return ['.'];

  const parts = normalized.split('/').filter(Boolean);
  const parents = ['.'];
  for (let index = 0; index < parts.length - 1; index += 1) {
    parents.push(parts.slice(0, index + 1).join('/'));
  }
  return parents;
}

function expandAncestors(relativePath) {
  for (const parent of parentPaths(relativePath)) {
    state.expanded.add(parent);
  }
}

function rememberLatestEvent(event) {
  if (!event?.path) return;

  const latestPath = normalizeRelativePath(event.path);
  if (!latestPath) return;

  const time = event.timestamp ? Date.parse(event.timestamp) : Date.now();
  const safeTime = Number.isFinite(time) ? time : Date.now();
  const eventKey = `${latestPath}|${event.timestamp || safeTime}|${event.reason || ''}`;
  if (eventKey === state.lastEventKey) return;

  state.lastEventKey = eventKey;
  state.latestChange = {
    ...event,
    path: latestPath,
    time: safeTime,
    key: eventKey,
  };

  state.changeHistory = state.changeHistory
    .filter((entry) => entry.path !== latestPath)
    .slice(0, CHANGE_HISTORY_LIMIT - 1);
  state.changeHistory.unshift({
    path: latestPath,
    time: safeTime,
    key: eventKey,
    reason: event.reason || 'change',
  });

  state.pendingFlash = { path: latestPath, key: eventKey };
  expandAncestors(latestPath);
}

function isDescendantPath(childPath, parentPath) {
  if (!parentPath || parentPath === '.') return false;
  return childPath.startsWith(`${parentPath}/`);
}

function changeHistoryClass(node) {
  const key = node.relativePath || '.';

  for (let index = 0; index < state.changeHistory.length; index += 1) {
    const entry = state.changeHistory[index];
    if (entry.path === key) {
      return index === 0 ? 'change-latest' : `change-previous-${index}`;
    }
  }

  if (node.type === 'directory') {
    for (let index = 0; index < state.changeHistory.length; index += 1) {
      if (isDescendantPath(state.changeHistory[index].path, key)) {
        return `change-parent-${index}`;
      }
    }
  }

  return '';
}

function flashPendingChange() {
  if (!state.pendingFlash || state.flashedEventKey === state.pendingFlash.key) return;

  const row = [...elements.tree.querySelectorAll('.tree-row')].find(
    (candidate) => candidate.dataset.id === state.pendingFlash.path,
  );

  if (!row) return;

  state.flashedEventKey = state.pendingFlash.key;
  row.classList.remove('change-flash');
  window.requestAnimationFrame(() => {
    row.classList.add('change-flash');
    window.setTimeout(() => {
      row.classList.remove('change-flash');
    }, 1800);
  });
}

function buildLineMap(node, output = new Map()) {
  if (node.type === 'file') output.set(node.relativePath, node.lines || 0);
  for (const child of node.children || []) buildLineMap(child, output);
  return output;
}

function updateDeltas(snapshot) {
  const nextLines = buildLineMap(snapshot.tree);
  const deltas = new Map();

  for (const [filePath, lines] of nextLines) {
    if (!state.previousLines.has(filePath)) continue;
    const delta = lines - state.previousLines.get(filePath);
    if (delta !== 0) deltas.set(filePath, delta);
  }

  state.previousLines = nextLines;
  state.lineDeltas = deltas;
}

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function hasVisibleMatch(node, filter) {
  if (!filter) return true;
  const haystack = `${node.name} ${node.relativePath}`.toLowerCase();
  if (haystack.includes(filter)) return true;
  return (node.children || []).some((child) => hasVisibleMatch(child, filter));
}

function severityClass(node) {
  if (node.type === 'directory') {
    if (node.lines > 40000) return 'hot';
    if (node.lines > 12000) return 'warn';
    return '';
  }
  if (node.lines > 2000) return 'hot';
  if (node.lines > 700) return 'warn';
  return '';
}

function statusChip(node) {
  if (node.type === 'file' && node.gitStatus) {
    return `<span class="status-chip">${escapeHtml(node.gitStatus)}</span>`;
  }
  if (node.type === 'directory' && node.changedCount > 0) {
    return `<span class="status-chip">${formatNumber(node.changedCount)}</span>`;
  }
  return '';
}

function typeRank(node) {
  return node.type === 'directory' ? 0 : 1;
}

function sortValue(node, key) {
  if (key === 'name') return node.name.toLowerCase();
  if (key === 'lines') return node.lines || 0;
  if (key === 'files') return node.type === 'directory' ? node.fileCount || 0 : 0;
  return node.name.toLowerCase();
}

function compareNames(left, right, direction) {
  const result = left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  return direction === 'asc' ? result : -result;
}

function compareNodes(left, right) {
  const { key, direction } = state.sort;

  if (key === 'name') {
    const rankDelta = typeRank(left) - typeRank(right);
    if (rankDelta !== 0) return rankDelta;
    return compareNames(sortValue(left, key), sortValue(right, key), direction);
  }

  const directionFactor = direction === 'asc' ? 1 : -1;
  const numericDelta = (sortValue(left, key) - sortValue(right, key)) * directionFactor;
  if (numericDelta !== 0) return numericDelta;

  const rankDelta = typeRank(left) - typeRank(right);
  if (rankDelta !== 0) return rankDelta;

  return compareNames(left.name.toLowerCase(), right.name.toLowerCase(), 'asc');
}

function sortedChildren(node) {
  return [...(node.children || [])].sort(compareNodes);
}

function deltaText(node) {
  if (node.type !== 'file') return '';
  const delta = state.lineDeltas.get(node.relativePath);
  if (!delta) return '';
  return delta > 0 ? ` +${formatNumber(delta)}` : ` ${formatNumber(delta)}`;
}

function renderTreeNode(node, depth, rows) {
  if (!hasVisibleMatch(node, state.filter)) return;

  const isDirectory = node.type === 'directory';
  const expanded = isDirectory && state.expanded.has(node.id);
  const selected = state.selectedId === node.id ? ' selected' : '';
  const severity = severityClass(node);
  const changeClass = changeHistoryClass(node);
  const depthClass = `depth-${Math.min(depth, 12)}`;
  const rowClasses = ['tree-row', depthClass, severity, changeClass, selected].filter(Boolean).join(' ');
  const toggle = isDirectory ? (expanded ? '-' : '+') : '';
  const icon = isDirectory ? 'DIR' : 'FILE';
  const files = isDirectory ? node.fileCount : '';
  const skipped = node.skipped ? ' skipped' : '';

  rows.push(`
    <div class="${rowClasses}" data-id="${escapeHtml(node.id)}" data-type="${node.type}" data-depth="${depth}" role="treeitem">
      <div class="tree-name">
        <span class="tree-toggle" data-toggle="${isDirectory ? '1' : '0'}">${toggle}</span>
        <span class="tree-icon">${icon}</span>
        <span class="tree-label" title="${escapeHtml(node.relativePath || node.name)}">${escapeHtml(node.name)}${skipped}</span>
        ${statusChip(node)}
      </div>
      <div class="tree-meta">${formatNumber(node.lines)}${escapeHtml(deltaText(node))}</div>
      <div class="tree-meta">${files ? formatNumber(files) : ''}</div>
    </div>
  `);

  if (isDirectory && (expanded || state.filter)) {
    for (const child of sortedChildren(node)) renderTreeNode(child, depth + 1, rows);
  }
}

function renderTree() {
  if (!state.snapshot) {
    elements.tree.innerHTML = '';
    renderSortHeaders();
    return;
  }

  const rows = [];
  renderTreeNode(state.snapshot.tree, 0, rows);
  elements.tree.innerHTML = rows.join('');
  renderSortHeaders();
}

function renderSortHeaders() {
  for (const button of elements.sortButtons) {
    const isActive = button.dataset.sort === state.sort.key;
    const arrow = button.querySelector('.sort-arrow');
    button.classList.toggle('active', isActive);
    button.setAttribute(
      'aria-sort',
      isActive ? (state.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none',
    );
    if (arrow) arrow.textContent = isActive ? (state.sort.direction === 'asc' ? '^' : 'v') : '';
  }
}

function setSort(key) {
  if (state.sort.key === key) {
    state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort.key = key;
    state.sort.direction = key === 'name' ? 'asc' : 'desc';
  }
  renderTree();
}

function renderSummary() {
  const snapshot = state.snapshot;
  if (!snapshot) {
    elements.rootPath.textContent = 'No folder selected';
    elements.metricLines.textContent = '0';
    elements.metricNonBlank.textContent = '0';
    elements.metricFiles.textContent = '0';
    elements.metricChanged.textContent = '0';
    elements.metricScan.textContent = state.scanning ? 'Scanning' : 'Idle';
    return;
  }

  elements.rootPath.textContent = snapshot.rootPath;
  elements.metricLines.textContent = formatNumber(snapshot.summary.lines);
  elements.metricNonBlank.textContent = formatNumber(snapshot.summary.nonBlank);
  elements.metricFiles.textContent = formatNumber(snapshot.summary.files);
  elements.metricChanged.textContent = formatNumber(snapshot.summary.changedFiles);
  if (state.scanning) {
    elements.metricScan.textContent = 'Scanning';
  } else if (state.latestChange) {
    elements.metricScan.textContent = `${formatTime(snapshot.scannedAt)} - ${state.latestChange.path}`;
  } else {
    elements.metricScan.textContent = formatTime(snapshot.scannedAt);
  }
}

function renderSelection() {
  const node = findNode(state.snapshot?.tree, state.selectedId);
  if (!node) {
    elements.selectionDetails.textContent = 'Select a file or folder.';
    return;
  }

  const label = node.type === 'directory' ? 'Folder' : 'File';
  const thirdLabel = node.type === 'directory' ? 'Files' : 'Size';
  const thirdValue = node.type === 'directory' ? formatNumber(node.fileCount) : formatBytes(node.size);
  const changed = node.type === 'directory' ? node.changedCount : node.gitStatus || '-';

  elements.selectionDetails.innerHTML = `
    <div class="detail-title">${label}: ${escapeHtml(node.name)}</div>
    <div class="detail-path">${escapeHtml(node.relativePath || state.snapshot.rootPath)}</div>
    <div class="detail-grid">
      <div class="detail-cell"><span>LOC</span><strong>${formatNumber(node.lines)}</strong></div>
      <div class="detail-cell"><span>Nonblank</span><strong>${formatNumber(node.nonBlank)}</strong></div>
      <div class="detail-cell"><span>${thirdLabel}</span><strong>${thirdValue}</strong></div>
      <div class="detail-cell"><span>Changed</span><strong>${escapeHtml(changed)}</strong></div>
      <div class="detail-cell"><span>Dirs</span><strong>${formatNumber(node.dirCount)}</strong></div>
      <div class="detail-cell"><span>Skipped</span><strong>${node.skipped ? escapeHtml(node.skipReason) : '-'}</strong></div>
    </div>
  `;
}

function renderLargestFiles() {
  const files = state.snapshot?.largestFiles || [];
  if (files.length === 0) {
    elements.largestFiles.innerHTML = '<div class="selection-details">No files scanned.</div>';
    return;
  }

  elements.largestFiles.innerHTML = files
    .slice(0, 25)
    .map((file) => {
      const cls = file.lines > 2000 ? 'hot' : file.lines > 700 ? 'warn' : '';
      return `
        <div class="list-row ${cls}">
          <div class="list-path" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</div>
          <div class="list-lines">${formatNumber(file.lines)}</div>
        </div>
      `;
    })
    .join('');
}

function renderChangedFiles() {
  const git = state.snapshot?.git;
  elements.gitState.textContent = git?.available ? 'on' : 'off';

  if (!git?.available) {
    elements.changedFiles.innerHTML = '<div class="selection-details">No git repository detected.</div>';
    return;
  }

  if (git.changed.length === 0) {
    elements.changedFiles.innerHTML = '<div class="selection-details">Clean for selected folder.</div>';
    return;
  }

  elements.changedFiles.innerHTML = git.changed
    .slice(0, 60)
    .map((entry) => `
      <div class="list-row">
        <div class="list-lines">${escapeHtml(entry.status)}</div>
        <div class="list-path" title="${escapeHtml(entry.path)}">${escapeHtml(entry.path)}</div>
      </div>
    `)
    .join('');
}

function renderEmptyState() {
  elements.emptyState.classList.toggle('visible', !state.snapshot);
}

function renderAll() {
  renderSummary();
  renderTree();
  renderSelection();
  renderLargestFiles();
  renderChangedFiles();
  renderEmptyState();
}

async function chooseFolder() {
  state.scanning = true;
  renderSummary();
  const snapshot = await window.refactorMonitor.chooseFolder();
  if (snapshot) applySnapshot(snapshot);
}

async function refresh() {
  state.scanning = true;
  renderSummary();
  const snapshot = await window.refactorMonitor.refresh();
  if (snapshot) applySnapshot(snapshot);
}

function applySnapshot(snapshot) {
  state.scanning = false;
  rememberLatestEvent(snapshot.lastEvent);
  if (!state.snapshot) {
    state.expanded.add(snapshot.tree.id);
    state.selectedId = snapshot.tree.id;
  }
  updateDeltas(snapshot);
  state.snapshot = snapshot;
  if (!findNode(snapshot.tree, state.selectedId)) state.selectedId = snapshot.tree.id;
  renderAll();
  flashPendingChange();
}

elements.chooseFolderButton.addEventListener('click', chooseFolder);
elements.emptyChooseButton.addEventListener('click', chooseFolder);
elements.refreshButton.addEventListener('click', refresh);
for (const button of elements.sortButtons) {
  button.addEventListener('click', () => {
    setSort(button.dataset.sort);
  });
}

elements.treeFilter.addEventListener('input', (event) => {
  state.filter = event.target.value.trim().toLowerCase();
  renderTree();
});

elements.tree.addEventListener('click', (event) => {
  const row = event.target.closest('.tree-row');
  if (!row) return;
  const id = row.dataset.id;
  const type = row.dataset.type;
  const toggleClicked = event.target.closest('.tree-toggle');

  if (type === 'directory' && toggleClicked) {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
  }

  state.selectedId = id;
  renderAll();
});

window.refactorMonitor.onSnapshot(applySnapshot);
window.refactorMonitor.onScanStarted(() => {
  state.scanning = true;
  renderSummary();
});
window.refactorMonitor.onError((payload) => {
  state.scanning = false;
  elements.metricScan.textContent = 'Error';
  elements.selectionDetails.innerHTML = `<div class="detail-title">Error</div><div class="detail-path">${escapeHtml(payload.message)}</div>`;
});

window.refactorMonitor.getState().then((snapshot) => {
  if (snapshot) applySnapshot(snapshot);
  else renderAll();
});
