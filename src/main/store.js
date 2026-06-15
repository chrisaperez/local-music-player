'use strict';
// Simple JSON persistence for settings + playlists, stored in the app's
// userData directory (outside the music library so it never clutters albums).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function dir() {
  return app.getPath('userData');
}

function readJSON(file, fallback) {
  try {
    const raw = fs.readFileSync(path.join(dir(), file), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  const full = path.join(dir(), file);
  const tmp = full + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, full); // atomic-ish replace
}

const DEFAULT_SETTINGS = {
  theme: 'system', // 'system' | 'dark' | 'light'
  accent: 'green', // id from the accent palette
  libraryRoot: null, // null => default (parent of app folder)
  volume: 1,
  shuffle: false,
  repeat: 'off', // 'off' | 'all' | 'one'
  autoplay: true, // keep playing similar songs when the queue ends
  onRepeat: { week: null, paths: [] }, // cached weekly smart-playlist
  discover: { week: null, paths: [] }, // cached weekly recommendation mix
  importedPaths: [], // files/folders dragged into the app (kept across launches)
  samplesInstalled: false, // bundled CC sample tracks copied into ~/Music once
};

function getSettings() {
  return Object.assign({}, DEFAULT_SETTINGS, readJSON('settings.json', {}));
}

function setSettings(patch) {
  const next = Object.assign(getSettings(), patch || {});
  writeJSON('settings.json', next);
  return next;
}

function getPlaylists() {
  const data = readJSON('playlists.json', { playlists: [] });
  return Array.isArray(data.playlists) ? data.playlists : [];
}

function setPlaylists(playlists) {
  writeJSON('playlists.json', { playlists: Array.isArray(playlists) ? playlists : [] });
  return getPlaylists();
}

// ---- Listening history (privacy: only path + start time + ms listened) ----
// Stored as a compact array of { p: path, t: startEpochMs, ms: msListened }.
function getHistory() {
  const data = readJSON('history.json', { plays: [] });
  return Array.isArray(data.plays) ? data.plays : [];
}

function recordPlay(play) {
  if (!play || !play.p) return false;
  const plays = getHistory();
  plays.push({ p: String(play.p), t: Number(play.t) || Date.now(), ms: Math.max(0, Math.round(Number(play.ms) || 0)) });
  writeJSON('history.json', { plays });
  return true;
}

module.exports = { getSettings, setSettings, getPlaylists, setPlaylists, getHistory, recordPlay };
