const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { scanFolder } = require('./scanner');

let mainWindow = null;
let watchedRoot = null;
let watcher = null;
let rescanTimer = null;
let isScanning = false;
let pendingScan = false;
let lastSnapshot = null;
let lastEvent = null;

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function send(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function closeWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

function scheduleScan(reason = 'change') {
  if (!watchedRoot) return;
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(() => {
    performScan(reason);
  }, 250);
}

async function performScan(reason = 'manual') {
  if (!watchedRoot) return null;
  if (isScanning) {
    pendingScan = true;
    return lastSnapshot;
  }

  isScanning = true;
  send('monitor:scan-started', { reason, rootPath: watchedRoot });

  try {
    const snapshot = await scanFolder(watchedRoot);
    const eventForSnapshot =
      reason === 'manual-refresh' || reason === 'open-folder' ? null : lastEvent;
    lastSnapshot = {
      ...snapshot,
      lastEvent: eventForSnapshot,
    };
    send('monitor:snapshot', lastSnapshot);
    return lastSnapshot;
  } catch (error) {
    send('monitor:error', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    isScanning = false;
    if (pendingScan) {
      pendingScan = false;
      scheduleScan('pending-change');
    }
  }
}

function startWatching(rootPath) {
  closeWatcher();
  watchedRoot = rootPath;
  lastEvent = null;
  writeSettings({ lastRoot: rootPath });

  try {
    watcher = fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
      const normalized = filename ? filename.toString().replace(/\\/g, '/') : '';
      if (
        normalized.includes('/.git/') ||
        normalized.startsWith('.git/') ||
        normalized.includes('/node_modules/') ||
        normalized.startsWith('node_modules/')
      ) {
        return;
      }

      lastEvent = {
        reason: eventType,
        path: normalized || rootPath,
        timestamp: new Date().toISOString(),
      };
      scheduleScan(eventType);
    });
  } catch (error) {
    send('monitor:error', {
      message: `Could not watch ${rootPath}: ${error.message}`,
    });
  }

  return performScan('open-folder');
}

async function chooseFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose folder to monitor',
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return lastSnapshot;
  }

  return startWatching(result.filePaths[0]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#111318',
    title: 'Refactor Monitor',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('monitor:get-state', async () => {
    if (lastSnapshot) return lastSnapshot;
    const settings = readSettings();
    if (settings.lastRoot && fs.existsSync(settings.lastRoot)) {
      return startWatching(settings.lastRoot);
    }
    return null;
  });

  ipcMain.handle('monitor:choose-folder', chooseFolder);
  ipcMain.handle('monitor:refresh', async () => performScan('manual-refresh'));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeWatcher();
  if (process.platform !== 'darwin') app.quit();
});
