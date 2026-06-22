'use strict';
// A small LAN HTTP server so a phone (or any device on the same wifi) can browse
// and stream this library. Token-gated, local-network only, plain HTTP.
// Endpoints:
//   GET /api/ping                  -> { app, version }            (token required)
//   GET /api/library               -> { tracks: [...] }
//   GET /api/audio/:id             -> audio stream (HTTP Range supported)
//   GET /api/art/:id               -> cover image
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const MIME = {
  '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.wav': 'audio/wav', '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff', '.wma': 'audio/x-ms-wma',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
};

let server = null;
let byId = new Map();   // id -> track
let token = '';
let port = 8787;
let appVersion = '';

function idFor(p) { return crypto.createHash('sha1').update(p).digest('hex').slice(0, 16); }

function lanAddress() {
  const ifaces = os.networkInterfaces();
  // prefer common LAN interfaces (en0 etc.) with a private IPv4
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ni.address)) {
        return ni.address;
      }
    }
  }
  return '127.0.0.1';
}

function setTracks(tracks) {
  byId = new Map();
  for (const t of tracks || []) byId.set(idFor(t.path), t);
}

function publicTrack(id, t) {
  return {
    id,
    title: t.title, artist: t.artist, albumArtist: t.albumArtist, album: t.album,
    track: t.track, disc: t.disc, year: t.year, genre: t.genre,
    duration: t.duration, hasArt: !!t.artPath,
    ext: path.extname(t.path || '').toLowerCase(),
  };
}

function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function streamFile(req, res, filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { res.writeHead(404); return res.end(); }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  const baseHeaders = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= stat.size) end = stat.size - 1;
    if (start > end) start = 0;
    res.writeHead(206, Object.assign({}, baseHeaders, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    }));
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, Object.assign({}, baseHeaders, { 'Content-Length': stat.size }));
    fs.createReadStream(filePath).pipe(res);
  }
}

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean); // ['api','audio','<id>']
  const provided = url.searchParams.get('token') || req.headers['x-token'];
  if (provided !== token) return sendJSON(res, 401, { error: 'bad token' });

  if (parts[0] !== 'api') return sendJSON(res, 404, { error: 'not found' });
  const route = parts[1];

  if (route === 'ping') return sendJSON(res, 200, { app: 'music-player', version: appVersion, tracks: byId.size });
  if (route === 'library') {
    const tracks = [...byId.entries()].map(([id, t]) => publicTrack(id, t));
    return sendJSON(res, 200, { tracks });
  }
  if (route === 'audio' && parts[2]) {
    const t = byId.get(parts[2]);
    if (!t) return sendJSON(res, 404, { error: 'no track' });
    return streamFile(req, res, t.path);
  }
  if (route === 'art' && parts[2]) {
    const t = byId.get(parts[2]);
    if (!t || !t.artPath) { res.writeHead(404); return res.end(); }
    return streamFile(req, res, t.artPath);
  }
  return sendJSON(res, 404, { error: 'not found' });
}

function start(opts) {
  token = opts.token;
  port = opts.port || 8787;
  appVersion = opts.version || '';
  if (server) return info();
  server = http.createServer(handle);
  server.on('error', (e) => { console.error('[sync] server error:', e.message); });
  server.listen(port, '0.0.0.0');
  return info();
}

function stop() {
  if (server) { try { server.close(); } catch { /* ignore */ } server = null; }
  return info();
}

function info() {
  return { running: !!server, address: lanAddress(), port, tracks: byId.size };
}

module.exports = { start, stop, setTracks, info };
