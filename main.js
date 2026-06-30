'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, nativeTheme, dialog, Menu, nativeImage } = require('electron');
const protocols = require('./src/main/protocols');
const library = require('./src/main/library');
const store = require('./src/main/store');
const syncserver = require('./src/main/syncserver');
const tagger = require('./src/main/tagger');

// Privileged scheme registration must happen before the app is ready.
protocols.registerPrivileged();

let mainWindow = null;
let isQuitting = false;
let nowPlaying = { title: null, artist: null, playing: false };

// On first run, copy the bundled CC sample album into the user's ~/Music so the
// app has something to play out of the box.
function installSamplesIfNeeded() {
  try {
    if (store.getSettings().samplesInstalled) return;
    const srcAlbum = path.join(__dirname, 'samples', 'Music Player Samples');
    let files = [];
    try { files = fs.readdirSync(srcAlbum); } catch { store.setSettings({ samplesInstalled: true }); return; }
    const destAlbum = path.join(app.getPath('music'), 'Music Player Samples');
    fs.mkdirSync(destAlbum, { recursive: true });
    for (const name of files) {
      if (!/\.(mp3|flac|m4a|jpg|jpeg|png)$/i.test(name)) continue;
      const dest = path.join(destAlbum, name);
      // readFileSync is asar-aware (copyFileSync is not), so this works packaged.
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, fs.readFileSync(path.join(srcAlbum, name)));
    }
    store.setSettings({ samplesInstalled: true });
  } catch (e) {
    console.error('[samples] install failed:', e.message);
  }
}

function sendControl(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dock:control', action);
}

// ---- Phone sync (LAN server) ----
function ensureSyncToken() {
  let { syncToken } = store.getSettings();
  if (!syncToken) {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
    syncToken = Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join('');
    store.setSettings({ syncToken });
  }
  return syncToken;
}
async function startSync() {
  const token = ensureSyncToken();
  try {
    const { libraryRoot } = store.getSettings();
    const result = await library.scan(libraryRoot);
    syncserver.setTracks(result.tracks);
  } catch (e) { console.error('[sync] scan failed:', e.message); }
  const inf = syncserver.start({ token, port: 8787, version: app.getVersion() });
  store.setSettings({ syncEnabled: true });
  return Object.assign({ enabled: true, token }, inf);
}
function stopSync() {
  const inf = syncserver.stop();
  store.setSettings({ syncEnabled: false });
  return Object.assign({ enabled: false, token: store.getSettings().syncToken || null }, inf);
}
function syncInfo() {
  const s = store.getSettings();
  return Object.assign({ enabled: s.syncEnabled, token: s.syncToken || null }, syncserver.info());
}

// macOS Dock right-click menu with transport controls (Spotify-style).
function buildDockMenu() {
  if (process.platform !== 'darwin' || !app.dock) return;
  const items = [];
  if (nowPlaying.title) {
    items.push({ label: nowPlaying.title + (nowPlaying.artist ? ' — ' + nowPlaying.artist : ''), enabled: false });
    items.push({ type: 'separator' });
  }
  items.push({ label: nowPlaying.playing ? 'Pause' : 'Play', click: () => sendControl('playpause') });
  items.push({ label: 'Next', click: () => sendControl('next') });
  items.push({ label: 'Previous', click: () => sendControl('prev') });
  app.dock.setMenu(Menu.buildFromTemplate(items));
}

function effectiveTheme() {
  const { theme } = store.getSettings();
  return { source: theme, dark: nativeTheme.shouldUseDarkColors };
}

function createWindow() {
  // Apply persisted theme preference to the OS-level theme source.
  nativeTheme.themeSource = store.getSettings().theme || 'system';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121212' : '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Forward renderer console output to the terminal (useful for debugging).
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const src = sourceId ? sourceId.split('/').pop() : '';
    console.log(`[renderer] ${message}${src ? ` (${src}:${line})` : ''}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', details.reason);
  });


  // Keep playing when the window is closed — hide it instead of destroying it so
  // the renderer (and its audio) keeps running, Spotify-style. Quitting (Cmd+Q)
  // sets isQuitting and lets it actually close, which stops playback.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// Notify renderer when the system theme flips (only matters in 'system' mode).
nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme:updated', effectiveTheme());
  }
});

app.whenReady().then(() => {
  protocols.handle();
  installSamplesIfNeeded();
  createWindow();
  buildDockMenu();

  // Show the custom CD icon in the Dock even when running in dev (npm start).
  try {
    const iconPng = path.join(__dirname, 'build', 'icon-1024.png');
    if (process.platform === 'darwin' && app.dock && fs.existsSync(iconPng)) {
      app.dock.setIcon(nativeImage.createFromPath(iconPng));
    }
  } catch (e) { /* non-fatal */ }

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    else createWindow();
  });

  if (store.getSettings().syncEnabled) startSync();
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ----------------------------------------------------------------

ipcMain.handle('library:get', async () => {
  const { libraryRoot } = store.getSettings();
  return library.scan(libraryRoot);
});

ipcMain.handle('library:rescan', async () => {
  const { libraryRoot } = store.getSettings();
  const result = await library.scan(libraryRoot);
  if (syncserver.info().running) syncserver.setTracks(result.tracks);
  return result;
});

ipcMain.handle('tags:read',  async (_e, filePath) => tagger.readTags(filePath));
ipcMain.handle('tags:write', async (_e, filePath, patch) => { await tagger.writeTags(filePath, patch); return true; });
ipcMain.handle('tags:pickArt', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose cover art',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('sync:info', async () => syncInfo());
ipcMain.handle('sync:set', async (_e, enable) => (enable ? startSync() : stopSync()));

ipcMain.handle('library:import', async (_e, paths) => library.importPaths(paths));

ipcMain.handle('settings:get', async () => store.getSettings());
ipcMain.handle('settings:set', async (_e, patch) => store.setSettings(patch));

ipcMain.handle('playlists:get', async () => store.getPlaylists());
ipcMain.handle('playlists:save', async (_e, playlists) => store.setPlaylists(playlists));

ipcMain.handle('playlist:pickImage', async (_e, playlistId) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a playlist photo',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return store.savePlaylistCover(playlistId, res.filePaths[0]);
});

ipcMain.handle('spotify:pickCSV', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Spotify playlist CSV files (from Exportify)',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (res.canceled || !res.filePaths.length) return [];
  return res.filePaths.map((p) => {
    try { return { name: path.basename(p), text: fs.readFileSync(p, 'utf8') }; } catch { return null; }
  }).filter(Boolean);
});

ipcMain.handle('history:get', async () => store.getHistory());
ipcMain.handle('history:record', async (_e, play) => store.recordPlay(play));

// Renderer reports what is playing so the Dock menu stays in sync.
ipcMain.on('nowplaying:update', (_e, info) => {
  nowPlaying = { title: info && info.title, artist: info && info.artist, playing: !!(info && info.playing) };
  buildDockMenu();
});

ipcMain.handle('theme:get', async () => effectiveTheme());
ipcMain.handle('theme:set', async (_e, theme) => {
  const allowed = ['system', 'dark', 'light'];
  const next = allowed.includes(theme) ? theme : 'system';
  nativeTheme.themeSource = next;
  store.setSettings({ theme: next });
  return effectiveTheme();
});

ipcMain.handle('library:root', async () => {
  const { libraryRoot } = store.getSettings();
  return libraryRoot || library.defaultRoot();
});

ipcMain.handle('dialog:chooseFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose your music folder',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  store.setSettings({ libraryRoot: res.filePaths[0] });
  return res.filePaths[0];
});
