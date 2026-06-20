'use strict';
// Cover-art handling. Embedded pictures are extracted once per album into a
// cache folder under userData; the resulting file is served to the renderer via
// the media:// protocol. Albums with no embedded art fall back to a folder
// image, and finally to a placeholder in the renderer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

function cacheDir() {
  const d = path.join(app.getPath('userData'), 'artcache');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function hash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

// Short fingerprint of an image buffer, so the cached filename changes whenever
// the underlying art changes — and stays identical when it doesn't.
function fingerprint(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
}

const ART_EXTS = ['.jpg', '.png', '.webp', '.gif'];

function extFor(mime) {
  if (!mime) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  return '.jpg';
}

// Remove any other cached art for this album (keeping `keepName`), so a changed
// cover never leaves a stale file behind and there is one art file per album.
function pruneAlbumArt(dir, base, keepName) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === keepName) continue;
    if (name.startsWith(base) && ART_EXTS.includes(path.extname(name).toLowerCase())) {
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* ignore */ }
    }
  }
}

// Write an embedded picture buffer to the cache. The filename is keyed on both
// the album AND the image content, so new art lands in a new file (and is picked
// up immediately) while unchanged art reuses the existing one; stale variants
// for the album are pruned. Returns the absolute path to the cached image.
function saveEmbedded(albumKey, picture) {
  const dir = cacheDir();
  const base = hash(albumKey);
  try {
    const data = Buffer.isBuffer(picture.data) ? picture.data : Buffer.from(picture.data);
    const name = base + '-' + fingerprint(data) + extFor(picture.format || picture.type);
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, data);
    pruneAlbumArt(dir, base, name);
    return file;
  } catch {
    return null;
  }
}

// Return cached art for this album. When the current fingerprint `fp` is known
// (from the track's tags) it pins the lookup to the matching file; otherwise we
// fall back to any cached art for the album (covers pre-fingerprint entries).
function cachedPath(albumKey, fp) {
  const dir = cacheDir();
  const base = hash(albumKey);
  if (fp) {
    for (const ext of ART_EXTS) {
      const f = path.join(dir, base + '-' + fp + ext);
      if (fs.existsSync(f)) return f;
    }
  }
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return null; }
  const match = entries.find((n) => n.startsWith(base) && ART_EXTS.includes(path.extname(n).toLowerCase()));
  return match ? path.join(dir, match) : null;
}

// Look for a cover image sitting in the track's folder (e.g. "folder.jpg",
// "cover.jpg", or the single image in the directory).
function findFolderImage(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const images = entries.filter((e) => IMAGE_EXTS.includes(path.extname(e).toLowerCase()));
  if (images.length === 0) return null;
  const preferred = images.find((e) => /(cover|folder|front|album)/i.test(e));
  return path.join(dir, preferred || images[0]);
}

module.exports = { saveEmbedded, cachedPath, findFolderImage, fingerprint };
