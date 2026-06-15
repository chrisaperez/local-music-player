'use strict';
// Custom `media://` protocol that streams local files (audio + cover images)
// with HTTP Range support, so seeking inside large FLAC files is instant and
// images load without exposing the whole filesystem via file://.
//
// URL shape:  media://stream/?p=<encodeURIComponent(absolutePath)>
const fs = require('fs');
const path = require('path');
const { Readable } = require('node:stream');
const { protocol } = require('electron');

const MIME = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

// Must be called BEFORE app 'ready'.
function registerPrivileged() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
    },
  ]);
}

// Must be called AFTER app 'ready'.
function handle() {
  protocol.handle('media', async (request) => {
    let filePath;
    try {
      filePath = new URL(request.url).searchParams.get('p');
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (!filePath) return new Response('Missing path', { status: 400 });

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return new Response('Not found', { status: 404 });
    }

    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.get('Range');

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= stat.size) end = stat.size - 1;
      if (start > end) start = 0;
      const nodeStream = fs.createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(nodeStream), {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
        },
      });
    }

    const nodeStream = fs.createReadStream(filePath);
    return new Response(Readable.toWeb(nodeStream), {
      status: 200,
      headers: {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(stat.size),
      },
    });
  });
}

module.exports = { registerPrivileged, handle };
