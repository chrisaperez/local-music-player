'use strict';
// Writes ID3/Vorbis/MP4 tags back to audio files using node-taglib-sharp.
// Only the fields passed in patch{} are written; others are left untouched.
const { File, PictureType } = require('node-taglib-sharp');
const fs = require('fs');
const path = require('path');

const SUPPORTED = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.aiff', '.aif']);

function isSupported(filePath) {
  return SUPPORTED.has(path.extname(filePath).toLowerCase());
}

/**
 * Write metadata to a file.
 * patch: { title, artist, albumArtist, album, year, trackNumber, discNumber, genre, comment, artPath }
 * All fields are optional — only provided ones are written.
 */
async function writeTags(filePath, patch) {
  if (!fs.existsSync(filePath)) throw new Error('File not found: ' + filePath);
  if (!isSupported(filePath)) throw new Error('Unsupported format: ' + path.extname(filePath));

  let file;
  try {
    file = File.createFromPath(filePath);
    const tag = file.tag;

    if (patch.title       !== undefined) tag.title       = patch.title       || undefined;
    if (patch.artist      !== undefined) tag.performers   = patch.artist      ? [patch.artist]      : [];
    if (patch.albumArtist !== undefined) tag.albumArtists = patch.albumArtist ? [patch.albumArtist] : [];
    if (patch.album       !== undefined) tag.album        = patch.album       || undefined;
    if (patch.year        !== undefined) tag.year         = patch.year ? parseInt(patch.year, 10) : 0;
    if (patch.trackNumber !== undefined) tag.track        = patch.trackNumber ? parseInt(patch.trackNumber, 10) : 0;
    if (patch.discNumber  !== undefined) tag.disc         = patch.discNumber  ? parseInt(patch.discNumber,  10) : 0;
    if (patch.genre       !== undefined) tag.genres       = patch.genre ? [patch.genre] : [];
    if (patch.comment     !== undefined) tag.comment      = patch.comment || undefined;

    if (patch.artPath !== undefined) {
      tag.pictures = [];
      if (patch.artPath) {
        const data = fs.readFileSync(patch.artPath);
        const ext = path.extname(patch.artPath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
        const { Picture } = require('node-taglib-sharp');
        const pic = Picture.fromData(data);
        pic.mimeType = mime;
        pic.type = PictureType.FrontCover;
        tag.pictures = [pic];
      }
    }

    file.save();
  } finally {
    if (file) try { file.dispose(); } catch { /* ignore */ }
  }
}

/**
 * Read tags from a file (raw, no caching).
 */
async function readTags(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('File not found: ' + filePath);
  let file;
  try {
    file = File.createFromPath(filePath);
    const t = file.tag;
    return {
      title: t.title || '',
      artist: (t.performers && t.performers[0]) || '',
      albumArtist: (t.albumArtists && t.albumArtists[0]) || '',
      album: t.album || '',
      year: t.year || '',
      trackNumber: t.track || '',
      discNumber: t.disc || '',
      genre: (t.genres && t.genres[0]) || '',
      comment: t.comment || '',
    };
  } finally {
    if (file) try { file.dispose(); } catch { /* ignore */ }
  }
}

module.exports = { writeTags, readTags, isSupported };
