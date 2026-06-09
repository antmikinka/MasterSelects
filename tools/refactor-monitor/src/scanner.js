const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const readdir = fs.promises.readdir;
const readFile = fs.promises.readFile;
const stat = fs.promises.stat;
const execFileAsync = promisify(execFile);

const IGNORED_DIRS = new Set([
  '.git',
  '.wrangler',
  '.vite',
  'coverage',
  'dist',
  'build',
  'out',
  'node_modules',
]);

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cfg',
  '.cmd',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.cts',
  '.cjs',
  '.env',
  '.go',
  '.h',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.log',
  '.md',
  '.mjs',
  '.mts',
  '.ps1',
  '.py',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]);

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function createDirNode(name, absolutePath, relativePath) {
  return {
    id: relativePath || '.',
    name,
    path: normalizePath(absolutePath),
    relativePath,
    type: 'directory',
    lines: 0,
    nonBlank: 0,
    size: 0,
    fileCount: 0,
    dirCount: 0,
    changedCount: 0,
    children: [],
  };
}

function createFileNode(name, absolutePath, relativePath, stats, lineStats, gitStatus) {
  return {
    id: relativePath,
    name,
    path: normalizePath(absolutePath),
    relativePath,
    type: 'file',
    extension: path.extname(name).toLowerCase(),
    lines: lineStats.lines,
    nonBlank: lineStats.nonBlank,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    skipped: lineStats.skipped,
    skipReason: lineStats.skipReason,
    gitStatus,
    fileCount: 1,
    dirCount: 0,
    changedCount: gitStatus ? 1 : 0,
  };
}

function shouldTreatAsText(filePath, buffer) {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return !sample.includes(0);
}

async function countLines(filePath, size) {
  if (size === 0) {
    return { lines: 0, nonBlank: 0, skipped: false };
  }

  if (size > MAX_TEXT_BYTES) {
    return {
      lines: 0,
      nonBlank: 0,
      skipped: true,
      skipReason: 'large-file',
    };
  }

  const buffer = await readFile(filePath);
  if (!shouldTreatAsText(filePath, buffer)) {
    return {
      lines: 0,
      nonBlank: 0,
      skipped: true,
      skipReason: 'binary',
    };
  }

  let lines = 0;
  for (const byte of buffer) {
    if (byte === 10) lines += 1;
  }
  if (buffer[buffer.length - 1] !== 10) lines += 1;

  const text = buffer.toString('utf8');
  const nonBlank = text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  return { lines, nonBlank, skipped: false };
}

async function getGitInfo(rootPath) {
  try {
    const { stdout: topStdout } = await execFileAsync(
      'git',
      ['-C', rootPath, 'rev-parse', '--show-toplevel'],
      { windowsHide: true },
    );
    const gitRoot = path.resolve(topStdout.trim());
    const { stdout } = await execFileAsync(
      'git',
      ['-C', gitRoot, 'status', '--porcelain=v1', '-uall'],
      { windowsHide: true, maxBuffer: 1024 * 1024 * 8 },
    );

    const statusByRelativePath = new Map();
    const changed = [];
    const selectedRoot = path.resolve(rootPath);

    for (const rawLine of stdout.split(/\r?\n/)) {
      if (!rawLine.trim()) continue;
      const code = rawLine.slice(0, 2);
      let repoRelative = rawLine.slice(3);
      if (repoRelative.includes(' -> ')) {
        repoRelative = repoRelative.split(' -> ').pop();
      }
      repoRelative = repoRelative.replace(/^"|"$/g, '');

      const absolute = path.resolve(gitRoot, repoRelative);
      const selectedRelative = path.relative(selectedRoot, absolute);
      if (!selectedRelative || selectedRelative.startsWith('..') || path.isAbsolute(selectedRelative)) {
        continue;
      }

      const relativePath = normalizePath(selectedRelative);
      const status = code.trim() || code;
      const entry = { path: relativePath, status, rawStatus: code };
      statusByRelativePath.set(relativePath, status);
      changed.push(entry);
    }

    return {
      available: true,
      root: normalizePath(gitRoot),
      changed: changed.sort((a, b) => a.path.localeCompare(b.path)),
      statusByRelativePath,
    };
  } catch {
    return {
      available: false,
      root: null,
      changed: [],
      statusByRelativePath: new Map(),
    };
  }
}

function sortTree(node) {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  for (const child of node.children) {
    if (child.type === 'directory') sortTree(child);
  }
}

async function walkDirectory(absolutePath, rootPath, gitStatusByRelativePath) {
  const relativePath = normalizePath(path.relative(rootPath, absolutePath));
  const node = createDirNode(path.basename(absolutePath) || absolutePath, absolutePath, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

    const childPath = path.join(absolutePath, entry.name);
    const childRelativePath = normalizePath(path.relative(rootPath, childPath));

    if (entry.isDirectory()) {
      const childNode = await walkDirectory(childPath, rootPath, gitStatusByRelativePath);
      node.children.push(childNode);
      node.lines += childNode.lines;
      node.nonBlank += childNode.nonBlank;
      node.size += childNode.size;
      node.fileCount += childNode.fileCount;
      node.dirCount += childNode.dirCount + 1;
      node.changedCount += childNode.changedCount;
      continue;
    }

    if (!entry.isFile()) continue;

    const stats = await stat(childPath);
    const lineStats = await countLines(childPath, stats.size);
    const childNode = createFileNode(
      entry.name,
      childPath,
      childRelativePath,
      stats,
      lineStats,
      gitStatusByRelativePath.get(childRelativePath) || null,
    );

    node.children.push(childNode);
    node.lines += childNode.lines;
    node.nonBlank += childNode.nonBlank;
    node.size += childNode.size;
    node.fileCount += 1;
    node.changedCount += childNode.changedCount;
  }

  return node;
}

function flattenFiles(node, output = []) {
  for (const child of node.children) {
    if (child.type === 'file') output.push(child);
    if (child.type === 'directory') flattenFiles(child, output);
  }
  return output;
}

async function scanFolder(rootPath) {
  const absoluteRoot = path.resolve(rootPath);
  const rootStats = await stat(absoluteRoot);
  if (!rootStats.isDirectory()) {
    throw new Error(`${absoluteRoot} is not a directory`);
  }

  const git = await getGitInfo(absoluteRoot);
  const tree = await walkDirectory(absoluteRoot, absoluteRoot, git.statusByRelativePath);
  sortTree(tree);

  const files = flattenFiles(tree);
  const largestFiles = [...files]
    .filter((file) => !file.skipped)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 50)
    .map((file) => ({
      path: file.relativePath,
      name: file.name,
      lines: file.lines,
      nonBlank: file.nonBlank,
      gitStatus: file.gitStatus,
    }));

  return {
    rootPath: normalizePath(absoluteRoot),
    scannedAt: new Date().toISOString(),
    tree,
    summary: {
      lines: tree.lines,
      nonBlank: tree.nonBlank,
      files: tree.fileCount,
      directories: tree.dirCount,
      changedFiles: git.changed.length,
      skippedFiles: files.filter((file) => file.skipped).length,
      size: tree.size,
    },
    largestFiles,
    git: {
      available: git.available,
      root: git.root,
      changed: git.changed,
    },
  };
}

module.exports = {
  scanFolder,
};

if (require.main === module) {
  const target = process.argv[2] || process.cwd();
  scanFolder(target)
    .then((snapshot) => {
      console.log(JSON.stringify(snapshot.summary, null, 2));
      console.log(`Scanned ${snapshot.rootPath}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
