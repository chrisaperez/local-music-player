'use strict';
// Audio playback engine: owns the queue, shuffle/repeat, an explicit "up next"
// user queue, a back-stack for Previous, on-device play logging (for recaps /
// On Repeat), and macOS Now Playing / media-key integration.
window.Player = (function () {
  const audio = document.getElementById('audio');
  const api = window.api;

  let queue = [];      // context tracks (album / playlist / songs list)
  let order = [];      // indices into queue -> play order
  let pos = -1;        // pointer within `order`
  let userQueue = [];  // manually queued tracks (take priority for Next)
  let backStack = [];  // previously played tracks (for Previous)
  let nowPlaying = null;
  let fromQueue = false;
  let shuffle = false;
  let repeat = 'off';  // 'off' | 'all' | 'one'
  let autoplayOn = true;   // continue with similar songs when the queue ends
  let recommender = null;  // (seedTrack, excludeSet) => track | null
  const listeners = [];

  // play-time accumulator for the current track (privacy: only path + time)
  let acc = null; // { path, startTs, listenedMs, duration, lastTs }

  function current() { return nowPlaying; }
  function ctxCurrent() { return pos >= 0 && pos < order.length ? queue[order[pos]] : null; }

  function upNext() {
    const rest = [];
    for (let i = pos + 1; i < order.length; i++) rest.push(queue[order[i]]);
    return rest;
  }

  function state() {
    return {
      current: nowPlaying,
      fromQueue,
      playing: !audio.paused && !!nowPlaying,
      shuffle,
      repeat,
      autoplay: autoplayOn,
      time: audio.currentTime || 0,
      duration: audio.duration || (nowPlaying && nowPlaying.duration) || 0,
      volume: audio.volume,
    };
  }

  function emit(type) {
    const s = state();
    for (const fn of listeners) fn(type, s);
  }

  // ---- play logging --------------------------------------------------------
  function finalizePlay() {
    if (!acc || !acc.path) { acc = null; return; }
    if (acc.lastTs) { acc.listenedMs += Date.now() - acc.lastTs; acc.lastTs = null; }
    const threshold = Math.min(30000, (acc.duration || 0) * 500) || 30000;
    if (acc.listenedMs >= threshold && acc.listenedMs >= 1000 && api && api.recordPlay) {
      api.recordPlay({ p: acc.path, t: acc.startTs, ms: acc.listenedMs });
    }
    acc = null;
  }

  // ---- ordering ------------------------------------------------------------
  function shuffleTail(startIndex) {
    const rest = queue.map((_, i) => i).filter((i) => i !== startIndex);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    order = startIndex >= 0 ? [startIndex, ...rest] : rest;
    pos = startIndex >= 0 ? 0 : -1;
  }

  function buildOrder(startIndex) {
    if (shuffle) shuffleTail(startIndex);
    else { order = queue.map((_, i) => i); pos = startIndex; }
  }

  // ---- loading -------------------------------------------------------------
  function load(track, autoplay) {
    if (!track) return;
    finalizePlay();
    nowPlaying = track;
    acc = { path: track.path, startTs: Date.now(), listenedMs: 0, duration: track.duration || 0, lastTs: null };
    audio.src = api.mediaUrl(track.path);
    audio.load();
    if (autoplay) audio.play().catch(() => {});
    updateMediaSession(track);
    emit('track');
    emit('queue');
  }

  function pushBack(t) { if (t) { backStack.push(t); if (backStack.length > 200) backStack.shift(); } }

  // ---- public transport ----------------------------------------------------
  function playQueue(tracks, startIndex) {
    queue = tracks.slice();
    buildOrder(Math.max(0, startIndex || 0));
    fromQueue = false;
    load(ctxCurrent(), true);
  }

  function toggle() {
    if (!nowPlaying) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function next(auto) {
    if (!nowPlaying && !userQueue.length && !queue.length) return;
    if (auto && repeat === 'one' && nowPlaying) { load(nowPlaying, true); return; }

    if (userQueue.length) {
      pushBack(nowPlaying);
      fromQueue = true;
      load(userQueue.shift(), true);
      return;
    }
    if (pos < order.length - 1) {
      pushBack(nowPlaying); pos++; fromQueue = false; load(ctxCurrent(), true);
      return;
    }
    if (repeat === 'all' && order.length) {
      pushBack(nowPlaying); pos = 0; fromQueue = false; load(ctxCurrent(), true);
      return;
    }
    // End of context with nothing queued: autoplay "radio" continues with a
    // recommended track (Spotify-style), otherwise stop.
    if (autoplayOn && recommender && nowPlaying) {
      const exclude = new Set([nowPlaying.path, ...backStack.slice(-60).map((t) => t.path)]);
      const rec = recommender(nowPlaying, exclude);
      if (rec) {
        pushBack(nowPlaying);
        queue = [rec]; order = [0]; pos = 0; fromQueue = false;
        load(rec, true);
        return;
      }
    }
    if (auto) {
      finalizePlay();
      audio.pause();
      audio.currentTime = 0;
      emit('state');
    }
  }

  function prev() {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (backStack.length) {
      const t = backStack.pop();
      const qi = queue.indexOf(t);
      if (qi >= 0) { pos = order.indexOf(qi); fromQueue = false; }
      load(t, true);
    } else {
      audio.currentTime = 0;
    }
  }

  function seekFraction(frac) {
    if (audio.duration && isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, frac)) * audio.duration;
  }

  function setVolume(v) { audio.volume = Math.max(0, Math.min(1, v)); emit('state'); }

  function setShuffle(on) {
    if (shuffle === on) return;
    shuffle = on;
    const anchor = ctxCurrent();
    if (anchor) buildOrder(queue.indexOf(anchor));
    emit('state'); emit('queue');
  }
  function toggleShuffle() { setShuffle(!shuffle); }

  function setRepeat(mode) { repeat = ['off', 'all', 'one'].includes(mode) ? mode : 'off'; emit('state'); }
  function cycleRepeat() { setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'); }
  function setAutoplay(on) { autoplayOn = !!on; emit('state'); }
  function setRecommender(fn) { recommender = typeof fn === 'function' ? fn : null; }

  // ---- user queue ----------------------------------------------------------
  function addToQueue(tracks) { for (const t of [].concat(tracks)) userQueue.push(t); emit('queue'); }
  function playNext(tracks) { const list = [].concat(tracks); for (let i = list.length - 1; i >= 0; i--) userQueue.unshift(list[i]); emit('queue'); }
  function removeFromQueue(i) { userQueue.splice(i, 1); emit('queue'); }
  function clearQueue() { userQueue = []; emit('queue'); }
  function reorderQueue(from, to) { const m = userQueue.splice(from, 1)[0]; if (m) userQueue.splice(to, 0, m); emit('queue'); }
  function playFromQueue(i) {
    if (i < 0 || i >= userQueue.length) return;
    const t = userQueue[i];
    userQueue.splice(0, i + 1);
    pushBack(nowPlaying);
    fromQueue = true;
    load(t, true);
  }

  function reorderUpNext(from, to) {
    const targetOrderIndexFrom = pos + 1 + from;
    const targetOrderIndexTo = pos + 1 + to;
    if (targetOrderIndexFrom >= order.length || targetOrderIndexTo >= order.length) return;
    const m = order.splice(targetOrderIndexFrom, 1)[0];
    if (m !== undefined) order.splice(targetOrderIndexTo, 0, m);
    emit('queue');
  }

  function promoteToUserQueue(upNextIndex, userQueueIndex) {
    const targetOrderIndex = pos + 1 + upNextIndex;
    if (targetOrderIndex >= order.length) return;
    const trackIndex = order.splice(targetOrderIndex, 1)[0];
    const track = queue[trackIndex];
    if (track) {
      if (userQueueIndex === undefined || userQueueIndex >= userQueue.length) {
        userQueue.push(track);
      } else {
        userQueue.splice(userQueueIndex, 0, track);
      }
    }
    emit('queue');
  }

  function demoteToUpNext(userQueueIndex, upNextIndex) {
    if (userQueueIndex < 0 || userQueueIndex >= userQueue.length) return;
    const track = userQueue.splice(userQueueIndex, 1)[0];
    if (track) {
      queue.push(track);
      const targetOrderIndexTo = pos + 1 + upNextIndex;
      order.splice(targetOrderIndexTo, 0, queue.length - 1);
    }
    emit('queue');
  }
  
  function playUpNext(j) {
    const target = pos + 1 + j;
    if (target >= 0 && target < order.length) { pushBack(nowPlaying); pos = target; fromQueue = false; load(ctxCurrent(), true); }
  }

  function getQueue() { return { nowPlaying, fromQueue, userQueue: userQueue.slice(), upNext: upNext() }; }

  // ---- rescan reconciliation ----------------------------------------------
  function refreshQueue(byPath) {
    const remap = (t) => byPath.get(t.path) || t;
    const keep = (t) => byPath.has(t.path);
    const npPath = nowPlaying ? nowPlaying.path : null;
    queue = queue.map(remap).filter(keep);
    userQueue = userQueue.map(remap).filter(keep);
    backStack = backStack.map(remap).filter(keep);
    if (npPath && byPath.has(npPath)) {
      nowPlaying = byPath.get(npPath);
      const qi = queue.findIndex((t) => t.path === npPath);
      if (qi >= 0) buildOrder(qi);
    }
    emit('queue');
  }

  // ---- macOS Now Playing / media keys -------------------------------------
  let lastArtBlobUrl = null;
  function updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const base = { title: track.title || '', artist: track.artist || '', album: track.album || '' };
    try { navigator.mediaSession.metadata = new MediaMetadata(base); } catch (e) { return; }
    if (!track.artPath) return;
    // MediaSession artwork only accepts http/https/data/blob — fetch the
    // media:// cover and hand it over as a blob URL.
    fetch(api.mediaUrl(track.artPath)).then((r) => (r.ok ? r.blob() : null)).then((blob) => {
      if (!blob || track !== nowPlaying) return;
      if (lastArtBlobUrl) URL.revokeObjectURL(lastArtBlobUrl);
      lastArtBlobUrl = URL.createObjectURL(blob);
      try {
        navigator.mediaSession.metadata = new MediaMetadata(Object.assign({}, base, {
          artwork: [{ src: lastArtBlobUrl, sizes: '512x512', type: blob.type || 'image/jpeg' }],
        }));
      } catch (e) { /* ignore */ }
    }).catch(() => {});
  }

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler('play', () => audio.play().catch(() => {}));
      ms.setActionHandler('pause', () => audio.pause());
      ms.setActionHandler('previoustrack', () => prev());
      ms.setActionHandler('nexttrack', () => next(false));
      ms.setActionHandler('seekbackward', (d) => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); });
      ms.setActionHandler('seekforward', (d) => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); });
      ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
    } catch (e) { /* some actions may be unsupported */ }
  }

  // ---- audio events --------------------------------------------------------
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('play', () => { if (acc && !acc.lastTs) acc.lastTs = Date.now(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; emit('state'); });
  audio.addEventListener('pause', () => { if (acc && acc.lastTs) { acc.listenedMs += Date.now() - acc.lastTs; acc.lastTs = null; } if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; emit('state'); });
  audio.addEventListener('timeupdate', () => emit('time'));
  audio.addEventListener('durationchange', () => { if (acc && audio.duration && isFinite(audio.duration)) acc.duration = audio.duration; emit('time'); });
  audio.addEventListener('loadedmetadata', () => emit('time'));
  window.addEventListener('beforeunload', () => finalizePlay());

  return {
    playQueue, toggle,
    next: () => next(false), prev,
    seekFraction, setVolume, getVolume: () => audio.volume,
    setShuffle, toggleShuffle, setRepeat, cycleRepeat, setAutoplay, setRecommender,
    addToQueue, playNext, removeFromQueue, clearQueue, reorderQueue, playFromQueue, playUpNext, getQueue,
    reorderUpNext, promoteToUserQueue, demoteToUpNext,
    refreshQueue,
    subscribe: (fn) => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    getState: state, current,
  };
})();
