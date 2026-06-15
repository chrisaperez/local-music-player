'use strict';
// Safe bridge between the renderer and the main process. The renderer only ever
// sees this small, explicit API surface (no direct Node / ipc access).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  getLibraryRoot: () => ipcRenderer.invoke('library:root'),
  importPaths: (paths) => ipcRenderer.invoke('library:import', paths),

  // Resolve the absolute path of a File dropped from Finder (Electron 32+ API).
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return null; } },

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  getPlaylists: () => ipcRenderer.invoke('playlists:get'),
  savePlaylists: (playlists) => ipcRenderer.invoke('playlists:save', playlists),

  getHistory: () => ipcRenderer.invoke('history:get'),
  recordPlay: (play) => ipcRenderer.invoke('history:record', play),

  updateNowPlaying: (info) => ipcRenderer.send('nowplaying:update', info),
  onDockControl: (cb) => ipcRenderer.on('dock:control', (_e, action) => cb(action)),

  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onThemeUpdated: (cb) => ipcRenderer.on('theme:updated', (_e, info) => cb(info)),

  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),

  // Build a media:// URL for streaming a local file (audio or image).
  mediaUrl: (absPath) => 'media://stream/?p=' + encodeURIComponent(absPath),
});
