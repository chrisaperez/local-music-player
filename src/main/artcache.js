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

function extFor(mime) {
  if (!mime) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  return '.jpg';
}

// Write an embedded picture buffer to the cache (deduped per album key).
// Returns the absolute path to the cached image.
function saveEmbedded(albumKey, picture) {
  const dir = cacheDir();
  const file = path.join(dir, hash(albumKey) + extFor(picture.format || picture.type));
  try {
    if (!fs.existsSync(file)) {
      const data = Buffer.isBuffer(picture.data) ? picture.data : Buffer.from(picture.data);
      fs.writeFileSync(file, data);
    }
    return file;
  } catch {
    return null;
  }
}

// If we already cached art for this album, return its path (any extension).
function cachedPath(albumKey) {
  const dir = cacheDir();
  const base = hash(albumKey);
  for (const ext of ['.jpg', '.png', '.webp', '.gif']) {
    const f = path.join(dir, base + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
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

module.exports = { saveEmbedded, cachedPath, findFolderImage };
