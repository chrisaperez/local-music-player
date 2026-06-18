'use strict';
// App controller: loads the library, renders all views, wires search,
// playlists, theme, the player bar, drag-and-drop and keyboard shortcuts.
(function () {
  const Player = window.Player;
  const api = window.api;

  // ---- State ----
  let tracks = [];
  let byPath = new Map();
  let playlists = [];
  let settings = { theme: 'system', volume: 1, shuffle: false, repeat: 'off' };
  let view = { type: 'songs' };
  let navStack = [];         // back/forward history of view objects
  let navIndex = -1;
  let songSort = { key: 'title', dir: 1 };
  let history = [];          // [{ p, t, ms }] local play log
  let onRepeatPaths = [];    // cached weekly smart-playlist
  let discoverPaths = [];    // cached weekly recommendation mix
  const ACCENTS = [
    // warm — gradient: rose → red → orange → amber → gold (bright)
    { id: 'rose', accent: '#ff5d8f', hover: '#ff85ac', group: 'warm' },
    { id: 'red', accent: '#ff5252', hover: '#ff7b7b', group: 'warm' },
    { id: 'orange', accent: '#ff8a1f', hover: '#ffa64d', group: 'warm' },
    { id: 'amber', accent: '#ffb524', hover: '#ffca5c', group: 'warm' },
    { id: 'gold', accent: '#ffd60a', hover: '#ffe45c', group: 'warm' },
    // cool — gradient: green → teal → cyan → blue → purple (bright)
    { id: 'green', accent: '#2be86a', hover: '#58f08e', group: 'cool' },
    { id: 'teal', accent: '#1fdcc6', hover: '#52e8d6', group: 'cool' },
    { id: 'cyan', accent: '#1ad4f0', hover: '#54e0f5', group: 'cool' },
    { id: 'blue', accent: '#3d9bff', hover: '#6fb6ff', group: 'cool' },
    { id: 'purple', accent: '#a36bff', hover: '#bd92ff', group: 'cool' },
    // neutral (brighter)
    { id: 'grey', accent: '#8b94a6', hover: '#a6aebd', group: 'neutral' },
  ];
  const PLACEHOLDER = '../assets/placeholder-cover.svg';
  const SEP = '\u0000';

  // ---- Tiny helpers ----
  const $ = (sel) => document.querySelector(sel);
  const content = () => $('#content');

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'dataset') Object.assign(e.dataset, attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of [].concat(children)) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  function fmtTime(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function fmtTotal(sec) {
    sec = Math.floor(sec || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h) return h + ' hr ' + m + ' min';
    return m + ' min';
  }

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }

  function artUrl(track) {
    return track && track.artPath ? api.mediaUrl(track.artPath) : PLACEHOLDER;
  }

  function renderModalPhoto(coverPath) {
    const btn = $('#modal-photo');
    if (coverPath) {
      btn.classList.remove('empty');
      btn.innerHTML = '<img alt=""><span class="mp-edit">Edit</span>';
      btn.querySelector('img').src = api.mediaUrl(coverPath);
    } else {
      btn.classList.add('empty');
      btn.innerHTML = QUARTER_NOTE + '<span class="mp-edit">Edit</span>';
    }
  }

  // Reusable name + description (+ optional cover photo) dialog.
  function openModal({ title, name, description, saveLabel, onSave, photo }) {
    const overlay = $('#modal-overlay');
    const nameI = $('#modal-name');
    const descI = $('#modal-desc');
    const count = $('#modal-desc-count');
    const saveB = $('#modal-save');
    const cancelB = $('#modal-cancel');
    const photoRow = $('#modal-photo-row');
    const photoBtn = $('#modal-photo');
    $('#modal-title').textContent = title || 'New Playlist';
    saveB.textContent = saveLabel || 'Save';
    nameI.value = name || '';
    descI.value = description || '';
    const updateCount = () => { count.textContent = descI.value.length + '/500'; };
    updateCount();

    if (photo) {
      photoRow.classList.remove('hidden');
      let cover = photo.cover || null;
      let hasCustom = !!photo.hasCustom;
      renderModalPhoto(cover);
      photoBtn.onclick = (e) => {
        e.stopPropagation();
        const items = [{ text: 'Change photo…', action: async () => {
          const p = await api.pickPlaylistImage(photo.id);
          if (p) { cover = p; hasCustom = true; renderModalPhoto(cover); photo.onApply(p); }
        } }];
        if (hasCustom) items.push({ text: 'Remove photo', action: () => {
          cover = photo.fallback || null; hasCustom = false; renderModalPhoto(cover); photo.onApply(null);
        } });
        const r = photoBtn.getBoundingClientRect();
        showMenu(r.left, r.bottom + 4, items);
      };
    } else {
      photoRow.classList.add('hidden');
      photoBtn.onclick = null;
    }

    overlay.classList.remove('hidden');
    setTimeout(() => { nameI.focus(); nameI.select(); }, 30);

    function close() {
      overlay.classList.add('hidden');
      descI.removeEventListener('input', updateCount);
      document.removeEventListener('keydown', onKey);
      saveB.onclick = cancelB.onclick = overlay.onclick = photoBtn.onclick = null;
    }
    function submit() {
      const nm = nameI.value.trim();
      if (!nm) { nameI.focus(); return; }
      const desc = descI.value.trim();
      close();
      onSave({ name: nm, description: desc });
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && document.activeElement === nameI) { e.preventDefault(); submit(); }
    }
    descI.addEventListener('input', updateCount);
    saveB.onclick = submit;
    cancelB.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.addEventListener('keydown', onKey);
  }

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 6h2v12H8zM19 6v12l-9-6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14 6h2v12h-2zM5 6v12l9-6z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    repeatOne: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="15" font-size="9" stroke="none" fill="currentColor" text-anchor="middle" font-family="sans-serif">1</text></svg>',
    smallPlay: '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  };

  // Quarter note — default cover for an empty playlist.
  const QUARTER_NOTE = '<svg viewBox="0 0 100 100" fill="#ffffff"><rect x="54" y="12" width="7" height="64" rx="2.5"/><ellipse cx="42" cy="76" rx="19" ry="13.5" transform="rotate(-20 42 76)"/></svg>';

  // ---- Navigation (back/forward history) ----
  function navigate(v, replace) {
    if (replace && navIndex >= 0) {
      navStack[navIndex] = v;
    } else {
      navStack = navStack.slice(0, navIndex + 1);
      navStack.push(v);
      navIndex = navStack.length - 1;
    }
    view = v;
    render();
    updateNavButtons();
  }
  function goBack() {
    if (navIndex > 0) { navIndex--; view = navStack[navIndex]; render(); updateNavButtons(); }
  }
  function goForward() {
    if (navIndex < navStack.length - 1) { navIndex++; view = navStack[navIndex]; render(); updateNavButtons(); }
  }
  function updateNavButtons() {
    const b = $('#nav-back'), f = $('#nav-fwd');
    if (b) b.disabled = navIndex <= 0;
    if (f) f.disabled = navIndex >= navStack.length - 1;
  }

  // Inline clickable text (artist / album names that route somewhere).
  function linkText(text, onClick) {
    const s = el('span', { class: 'link', text });
    s.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return s;
  }
  function gotoArtist(t) { navigate({ type: 'artist', name: t.albumArtist || 'Unknown Artist' }); }
  function gotoAlbum(t) { navigate({ type: 'album', key: albumKey(t) }); }

  // ---- Grouping ----
  function albumKey(t) { return (t.albumArtist || 'Unknown Artist') + SEP + (t.album || 'Unknown Album'); }

  function getAlbums() {
    const map = new Map();
    for (const t of tracks) {
      const k = albumKey(t);
      let a = map.get(k);
      if (!a) { a = { key: k, album: t.album, artist: t.albumArtist, year: t.year, art: null, tracks: [] }; map.set(k, a); }
      a.tracks.push(t);
      if (!a.art && t.artPath) a.art = t.artPath;
      if (t.year && (!a.year || t.year < a.year)) a.year = t.year;
    }
    const arr = [...map.values()];
    for (const a of arr) a.tracks.sort(trackOrder);
    arr.sort((x, y) => (x.artist || '').localeCompare(y.artist || '') || (x.year || 0) - (y.year || 0) || (x.album || '').localeCompare(y.album || ''));
    return arr;
  }

  function getArtists() {
    const map = new Map();
    for (const t of tracks) {
      const name = t.albumArtist || 'Unknown Artist';
      let a = map.get(name);
      if (!a) { a = { name, art: null, albums: new Set(), tracks: [] }; map.set(name, a); }
      a.tracks.push(t);
      a.albums.add(t.album || 'Unknown Album');
      if (!a.art && t.artPath) a.art = t.artPath;
    }
    const arr = [...map.values()];
    arr.sort((x, y) => x.name.localeCompare(y.name));
    return arr;
  }

  function trackOrder(a, b) {
    return (a.disc || 0) - (b.disc || 0) || (a.track || 9999) - (b.track || 9999) || (a.title || '').localeCompare(b.title || '');
  }

  // ---- Player row context helpers ----
  function playList(list, index) { Player.playQueue(list, index); }

  // ============================================================
  //  VIEWS
  // ============================================================
  function render() {
    const c = content();
    c.innerHTML = '';
    c.scrollTop = 0;
    if (view.type === 'songs') renderSongs(c);
    else if (view.type === 'albums') renderAlbums(c);
    else if (view.type === 'artists') renderArtists(c);
    else if (view.type === 'album') renderAlbumDetail(c, view.key);
    else if (view.type === 'artist') renderArtistDetail(c, view.name);
    else if (view.type === 'playlist') renderPlaylist(c, view.id);
    else if (view.type === 'search') renderSearch(c, view.query);
    else if (view.type === 'recent') renderRecent(c);
    else if (view.type === 'onrepeat') renderOnRepeat(c);
    else if (view.type === 'discover') renderDiscover(c);
    else if (view.type === 'recaps') renderRecaps(c);
    else if (view.type === 'recap') renderRecapDetail(c, view.period);
    syncNavActive();
  }

  function sortValue(t, key) {
    if (key === 'year') return t.year || 0;
    if (key === 'duration') return t.duration || 0;
    if (key === 'artist') return norm(t.artist);
    if (key === 'album') return norm(t.album);
    if (key === 'genre') return norm(t.genre);
    return norm(t.title);
  }

  function sortedSongs() {
    const list = tracks.slice();
    const { key, dir } = songSort;
    list.sort((a, b) => {
      const va = sortValue(a, key), vb = sortValue(b, key);
      let cmp = va < vb ? -1 : va > vb ? 1 : 0;
      if (cmp === 0 && (key === 'album' || key === 'artist')) cmp = trackOrder(a, b);
      if (cmp === 0) cmp = norm(a.title) < norm(b.title) ? -1 : 1;
      return cmp * dir;
    });
    return list;
  }

  function trackTable(list, opts) {
    opts = opts || {};
    const cols = opts.columns || ['index', 'titleArt', 'album', 'genre', 'year', 'duration'];
    const table = el('table', { class: 'track-table' });
    // header
    const thead = el('thead');
    const htr = el('tr');
    const headDefs = {
      index: { label: '#', cls: 'col-num', sort: null },
      track: { label: '#', cls: 'col-num', sort: null },
      titleArt: { label: 'Title', cls: '', sort: 'title' },
      title: { label: 'Title', cls: '', sort: 'title' },
      artist: { label: 'Artist', cls: '', sort: 'artist' },
      album: { label: 'Album', cls: '', sort: 'album' },
      genre: { label: 'Genre', cls: 'col-genre', sort: 'genre' },
      year: { label: 'Year', cls: 'col-year', sort: 'year' },
      duration: { label: '🕑', cls: 'col-dur', sort: 'duration' },
    };
    for (const col of cols) {
      const d = headDefs[col];
      const th = el('th', { class: d.cls });
      if (col === 'duration') th.innerHTML = '<span style="font-size:13px">◷</span>';
      else th.textContent = d.label;
      if (opts.sortable && d.sort) {
        th.addEventListener('click', () => {
          if (songSort.key === d.sort) songSort.dir *= -1;
          else songSort = { key: d.sort, dir: 1 };
          render();
        });
        if (songSort.key === d.sort) {
          th.appendChild(el('span', { class: 'arrow', text: songSort.dir === 1 ? '▲' : '▼' }));
        }
      }
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = el('tbody');
    list.forEach((t, i) => {
      const tr = el('tr', { class: 'track-row', draggable: 'true' });
      tr.dataset.path = t.path;
      tr.dataset.index = i;
      for (const col of cols) {
        let td;
        if (col === 'index' || col === 'track') {
          td = el('td', { class: 'col-num' });
          const num = col === 'track' ? (t.track || (i + 1)) : (i + 1);
          td.innerHTML = '<span class="idx">' + num + '</span><span class="play-ico" title="Play">' + ICONS.smallPlay + '</span>';
          td.querySelector('.play-ico').addEventListener('click', (e) => { e.stopPropagation(); playList(list, i); });
        } else if (col === 'titleArt') {
          td = el('td', { class: 't-title' });
          const wrap = el('div', { class: 'cell-art' });
          wrap.appendChild(el('img', { src: artUrl(t), loading: 'lazy', onerror: imgFallback }));
          const txt = el('div', { class: 'ca-text' });
          txt.appendChild(el('div', { class: 'ca-title', text: t.title }));
          const artistLine = el('div', { class: 'ca-artist' });
          artistLine.appendChild(linkText(t.artist, () => gotoArtist(t)));
          txt.appendChild(artistLine);
          wrap.appendChild(txt);
          td.appendChild(wrap);
        } else if (col === 'title') {
          td = el('td', { class: 't-title', text: t.title });
        } else if (col === 'artist') {
          td = el('td');
          td.appendChild(linkText(t.artist, () => gotoArtist(t)));
        } else if (col === 'album') {
          td = el('td');
          td.appendChild(linkText(t.album, () => gotoAlbum(t)));
        } else if (col === 'genre') {
          td = el('td', { class: 'col-genre', text: t.genre });
        } else if (col === 'year') {
          td = el('td', { class: 'col-year', text: t.year || '' });
        } else if (col === 'duration') {
          td = el('td', { class: 'col-dur', text: fmtTime(t.duration) });
        }
        tr.appendChild(td);
      }
      tr.addEventListener('dblclick', () => playList(list, i));
      tr.addEventListener('contextmenu', (e) => { e.preventDefault(); openTrackMenu(e, t, opts.context, i); });
      tr.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/track', t.path);
        e.dataTransfer.effectAllowed = 'copyMove';
        // defer so the drag ghost is snapshotted before the blur is applied
        setTimeout(() => document.body.classList.add('dragging-track'), 0);
      });
      tr.addEventListener('dragend', () => document.body.classList.remove('dragging-track'));
      if (opts.onRowDrop) enableRowReorder(tr, i, opts.onRowDrop);
      markPlaying(tr, t);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function imgFallback(e) { if (e.target.src.indexOf('placeholder') === -1) e.target.src = PLACEHOLDER; }

  function markPlaying(tr, t) {
    const cur = Player.current();
    tr.classList.toggle('playing', !!cur && cur.path === t.path);
  }

  function renderSongs(c) {
    const head = el('div', { class: 'view-head' });
    const left = el('div');
    left.appendChild(el('h1', { text: 'Songs' }));
    left.appendChild(el('div', { class: 'sub', text: tracks.length + ' songs in your library' }));
    head.appendChild(left);
    const actions = el('div', { class: 'view-actions' });
    actions.appendChild(el('button', { class: 'btn primary', text: '▶  Play all', onclick: () => playList(sortedSongs(), 0) }));
    actions.appendChild(el('button', { class: 'btn', text: 'Shuffle', onclick: () => { Player.setShuffle(true); applyShuffleUI(); playList(sortedSongs(), Math.floor(Math.random() * tracks.length)); } }));
    head.appendChild(actions);
    c.appendChild(head);
    if (!tracks.length) { c.appendChild(emptyState()); return; }
    c.appendChild(trackTable(sortedSongs(), { sortable: true, context: 'songs' }));
  }

  function renderAlbums(c) {
    const albums = getAlbums();
    const head = el('div', { class: 'view-head' });
    const left = el('div');
    left.appendChild(el('h1', { text: 'Albums' }));
    left.appendChild(el('div', { class: 'sub', text: albums.length + ' albums' }));
    head.appendChild(left);
    c.appendChild(head);
    const grid = el('div', { class: 'card-grid' });
    for (const a of albums) {
      const card = el('div', { class: 'card' });
      card.appendChild(el('img', { class: 'cover', src: a.art ? api.mediaUrl(a.art) : PLACEHOLDER, loading: 'lazy', onerror: imgFallback }));
      card.appendChild(el('div', { class: 'c-title', text: a.album }));
      card.appendChild(el('div', { class: 'c-sub', text: a.artist + (a.year ? ' · ' + a.year : '') }));
      const fab = el('button', { class: 'play-fab', html: ICONS.play, title: 'Play' });
      fab.addEventListener('click', (e) => { e.stopPropagation(); playList(a.tracks, 0); });
      card.appendChild(fab);
      card.addEventListener('click', () => { navigate({ type: 'album', key: a.key }); });
      grid.appendChild(card);
    }
    c.appendChild(grid);
  }

  function renderArtists(c) {
    const artists = getArtists();
    const head = el('div', { class: 'view-head' });
    const left = el('div');
    left.appendChild(el('h1', { text: 'Artists' }));
    left.appendChild(el('div', { class: 'sub', text: artists.length + ' artists' }));
    head.appendChild(left);
    c.appendChild(head);
    const grid = el('div', { class: 'card-grid' });
    for (const a of artists) {
      const card = el('div', { class: 'card round' });
      card.appendChild(el('img', { class: 'cover', src: a.art ? api.mediaUrl(a.art) : PLACEHOLDER, loading: 'lazy', onerror: imgFallback }));
      card.appendChild(el('div', { class: 'c-title', text: a.name }));
      card.appendChild(el('div', { class: 'c-sub', text: a.albums.size + ' album' + (a.albums.size === 1 ? '' : 's') + ' · ' + a.tracks.length + ' songs' }));
      card.addEventListener('click', () => { navigate({ type: 'artist', name: a.name }); });
      grid.appendChild(card);
    }
    c.appendChild(grid);
  }

  function detailHeader(opts) {
    const head = el('div', { class: 'detail-head' });
    if (opts.solidCover) {
      head.appendChild(el('div', { class: 'd-cover solid-cover' + (opts.round ? ' round' : ''), html: QUARTER_NOTE }));
    } else {
      head.appendChild(el('img', { class: 'd-cover' + (opts.round ? ' round' : ''), src: opts.art ? api.mediaUrl(opts.art) : PLACEHOLDER, onerror: imgFallback }));
    }
    const info = el('div');
    info.appendChild(el('div', { class: 'd-kind', text: opts.kind }));
    info.appendChild(el('div', { class: 'd-title', text: opts.title }));
    if (opts.desc) info.appendChild(el('div', { class: 'd-desc', text: opts.desc }));
    if (opts.metaEl) info.appendChild(opts.metaEl);
    else info.appendChild(el('div', { class: 'd-meta', text: opts.meta }));
    head.appendChild(info);
    return head;
  }

  function renderAlbumDetail(c, key) {
    const a = getAlbums().find((x) => x.key === key);
    if (!a) { view = { type: 'albums' }; return render(); }
    const total = a.tracks.reduce((s, t) => s + (t.duration || 0), 0);
    const meta = el('div', { class: 'd-meta' });
    meta.appendChild(linkText(a.artist, () => navigate({ type: 'artist', name: a.artist })));
    meta.appendChild(document.createTextNode(' · ' + (a.year || '—') + ' · ' + a.tracks.length + ' songs, ' + fmtTotal(total)));
    c.appendChild(detailHeader({ kind: 'Album', title: a.album, art: a.art, metaEl: meta }));
    const actions = el('div', { class: 'detail-actions' });
    actions.appendChild(el('button', { class: 'play-big', html: ICONS.play, onclick: () => playList(a.tracks, 0) }));
    actions.appendChild(el('button', { class: 'btn', text: 'Add all to playlist…', onclick: (e) => openAlbumMenu(e, a.tracks) }));
    c.appendChild(actions);
    c.appendChild(trackTable(a.tracks, { columns: ['track', 'titleArt', 'genre', 'duration'], context: 'album' }));
  }

  function renderArtistDetail(c, name) {
    const a = getArtists().find((x) => x.name === name);
    if (!a) { view = { type: 'artists' }; return render(); }
    c.appendChild(detailHeader({ kind: 'Artist', round: true, title: a.name, art: a.art, meta: a.albums.size + ' albums · ' + a.tracks.length + ' songs' }));
    const actions = el('div', { class: 'detail-actions' });
    actions.appendChild(el('button', { class: 'play-big', html: ICONS.play, onclick: () => playList(a.tracks.slice().sort(trackOrder), 0) }));
    c.appendChild(actions);
    // albums by this artist
    const albums = getAlbums().filter((al) => al.artist === name);
    if (albums.length) {
      c.appendChild(el('h2', { class: 'results-section', style: 'font-size:18px;font-weight:800;margin:6px 0 12px', text: 'Albums' }));
      const grid = el('div', { class: 'card-grid' });
      for (const al of albums) {
        const card = el('div', { class: 'card' });
        card.appendChild(el('img', { class: 'cover', src: al.art ? api.mediaUrl(al.art) : PLACEHOLDER, loading: 'lazy', onerror: imgFallback }));
        card.appendChild(el('div', { class: 'c-title', text: al.album }));
        card.appendChild(el('div', { class: 'c-sub', text: (al.year || '') + '' }));
        const fab = el('button', { class: 'play-fab', html: ICONS.play });
        fab.addEventListener('click', (e) => { e.stopPropagation(); playList(al.tracks, 0); });
        card.appendChild(fab);
        card.addEventListener('click', () => navigate({ type: 'album', key: al.key }));
        grid.appendChild(card);
      }
      c.appendChild(grid);
    }
  }

  // ============================================================
  //  PLAYLISTS
  // ============================================================
  function renderPlaylist(c, id) {
    const pl = playlists.find((p) => p.id === id);
    if (!pl) { view = { type: 'songs' }; return render(); }
    const list = pl.paths.map((p) => byPath.get(p)).filter(Boolean);
    const total = list.reduce((s, t) => s + (t.duration || 0), 0);
    const cover = pl.coverPath || (list.find((t) => t.artPath) || {}).artPath || null;
    const empty = list.length === 0 && !pl.coverPath;
    c.appendChild(detailHeader({ kind: 'Playlist', title: pl.name, desc: pl.description, art: cover, solidCover: empty, meta: list.length + ' songs, ' + fmtTotal(total) }));
    const actions = el('div', { class: 'detail-actions' });
    if (list.length) actions.appendChild(el('button', { class: 'play-big', html: ICONS.play, onclick: () => playList(list, 0) }));
    actions.appendChild(el('button', { class: 'btn', text: 'Edit details', onclick: () => renamePlaylist(pl) }));
    actions.appendChild(el('button', { class: 'btn', text: 'Delete', onclick: () => deletePlaylist(pl) }));
    c.appendChild(actions);
    if (!list.length) {
      c.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'big', text: 'This playlist is empty' }),
        el('div', { text: 'Right-click any song and choose “Add to playlist”, or drag songs onto the playlist in the sidebar.' }),
      ]));
      return;
    }
    const onRowDrop = (from, to) => {
      const moved = pl.paths.splice(from, 1)[0];
      pl.paths.splice(to, 0, moved);
      persistPlaylists();
      render();
    };
    c.appendChild(trackTable(list, { columns: ['index', 'titleArt', 'album', 'duration'], context: 'playlist', contextId: id, onRowDrop }));
  }

  function enableRowReorder(tr, index, onDrop) {
    tr.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes('text/reorder') && ![...e.dataTransfer.types].includes('text/track')) return;
      e.preventDefault();
      tr.style.borderTop = '2px solid var(--accent)';
    });
    tr.addEventListener('dragleave', () => { tr.style.borderTop = ''; });
    tr.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/reorder', String(index)); });
    tr.addEventListener('drop', (e) => {
      tr.style.borderTop = '';
      const from = e.dataTransfer.getData('text/reorder');
      if (from !== '') { e.preventDefault(); onDrop(parseInt(from, 10), index); }
    });
  }

  function newPlaylist(name, seedPaths, description) {
    const pl = {
      id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || 'New Playlist',
      description: description || '',
      paths: seedPaths ? seedPaths.slice() : [],
    };
    playlists.push(pl);
    persistPlaylists();
    renderPlaylistList();
    return pl;
  }

  function addToPlaylist(pl, paths) {
    let added = 0;
    for (const p of [].concat(paths)) {
      if (!pl.paths.includes(p)) { pl.paths.push(p); added++; }
    }
    persistPlaylists();
    renderPlaylistList();
    toast(added + ' added to “' + pl.name + '”');
    if (view.type === 'playlist' && view.id === pl.id) render();
  }

  function removeFromPlaylist(pl, index) {
    pl.paths.splice(index, 1);
    persistPlaylists();
    renderPlaylistList();
    render();
  }

  function renamePlaylist(pl) {
    const list = pl.paths.map((p) => byPath.get(p)).filter(Boolean);
    const fallback = (list.find((t) => t.artPath) || {}).artPath || null;
    openModal({
      title: 'Edit Playlist',
      name: pl.name,
      description: pl.description || '',
      saveLabel: 'Save',
      photo: {
        id: pl.id,
        cover: pl.coverPath || fallback || null,
        fallback,
        hasCustom: !!pl.coverPath,
        onApply: (p) => {
          if (p) pl.coverPath = p; else delete pl.coverPath;
          persistPlaylists();
          if (view.type === 'playlist') render();
        },
      },
      onSave: ({ name, description }) => {
        pl.name = name;
        pl.description = description;
        persistPlaylists();
        renderPlaylistList();
        if (view.type === 'playlist') render();
      },
    });
  }

  function deletePlaylist(pl) {
    if (!window.confirm('Delete playlist “' + pl.name + '”?')) return;
    playlists = playlists.filter((p) => p.id !== pl.id);
    persistPlaylists();
    renderPlaylistList();
    if (view.type === 'playlist' && view.id === pl.id) navigate({ type: 'songs' }, true);
  }

  function persistPlaylists() { api.savePlaylists(playlists); }

  function renderPlaylistList() {
    const ul = $('#playlist-list');
    ul.innerHTML = '';
    for (const pl of playlists) {
      const li = el('li', { dataset: { id: pl.id } });
      li.appendChild(el('span', { text: pl.name, style: 'overflow:hidden;text-overflow:ellipsis' }));
      li.appendChild(el('span', { class: 'pl-count', text: String(pl.paths.length) }));
      li.classList.toggle('active', view.type === 'playlist' && view.id === pl.id);
      li.addEventListener('click', () => navigate({ type: 'playlist', id: pl.id }));
      li.addEventListener('contextmenu', (e) => { e.preventDefault(); openPlaylistMenu(e, pl); });
      // drop songs onto playlist
      li.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/track')) { e.preventDefault(); li.classList.add('drop-target'); } });
      li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
      li.addEventListener('drop', (e) => {
        li.classList.remove('drop-target');
        const p = e.dataTransfer.getData('text/track');
        if (p) { e.preventDefault(); addToPlaylist(pl, p); }
      });
      ul.appendChild(li);
    }
  }

  // ============================================================
  //  SEARCH
  // ============================================================
  function renderSearch(c, query) {
    const q = norm(query);
    const head = el('div', { class: 'view-head' });
    head.appendChild(el('h1', { text: 'Results for “' + query + '”' }));
    c.appendChild(head);
    if (!q) { c.appendChild(emptyState('Type to search your library')); return; }

    const songMatches = tracks.filter((t) => norm(t.title).includes(q) || norm(t.artist).includes(q) || norm(t.album).includes(q));
    const albumMatches = getAlbums().filter((a) => norm(a.album).includes(q) || norm(a.artist).includes(q));
    const artistMatches = getArtists().filter((a) => norm(a.name).includes(q));

    if (!songMatches.length && !albumMatches.length && !artistMatches.length) {
      c.appendChild(emptyState('No results found for “' + query + '”'));
      return;
    }

    if (artistMatches.length) {
      const sec = el('div', { class: 'results-section' });
      sec.appendChild(el('h2', { text: 'Artists' }));
      const grid = el('div', { class: 'card-grid' });
      for (const a of artistMatches.slice(0, 8)) {
        const card = el('div', { class: 'card round' });
        card.appendChild(el('img', { class: 'cover', src: a.art ? api.mediaUrl(a.art) : PLACEHOLDER, onerror: imgFallback }));
        card.appendChild(el('div', { class: 'c-title', text: a.name }));
        card.appendChild(el('div', { class: 'c-sub', text: a.tracks.length + ' songs' }));
        card.addEventListener('click', () => { navigate({ type: 'artist', name: a.name }); });
        grid.appendChild(card);
      }
      sec.appendChild(grid);
      c.appendChild(sec);
    }

    if (albumMatches.length) {
      const sec = el('div', { class: 'results-section' });
      sec.appendChild(el('h2', { text: 'Albums' }));
      const grid = el('div', { class: 'card-grid' });
      for (const a of albumMatches.slice(0, 12)) {
        const card = el('div', { class: 'card' });
        card.appendChild(el('img', { class: 'cover', src: a.art ? api.mediaUrl(a.art) : PLACEHOLDER, onerror: imgFallback }));
        card.appendChild(el('div', { class: 'c-title', text: a.album }));
        card.appendChild(el('div', { class: 'c-sub', text: a.artist }));
        const fab = el('button', { class: 'play-fab', html: ICONS.play });
        fab.addEventListener('click', (e) => { e.stopPropagation(); playList(a.tracks, 0); });
        card.appendChild(fab);
        card.addEventListener('click', () => { navigate({ type: 'album', key: a.key }); });
        grid.appendChild(card);
      }
      sec.appendChild(grid);
      c.appendChild(sec);
    }

    if (songMatches.length) {
      const sec = el('div', { class: 'results-section' });
      sec.appendChild(el('h2', { text: 'Songs' }));
      sec.appendChild(trackTable(songMatches.slice(0, 100), { columns: ['index', 'titleArt', 'album', 'duration'], context: 'songs' }));
      c.appendChild(sec);
    }
  }

  function emptyState(msg) {
    return el('div', { class: 'empty' }, [
      el('div', { class: 'big', text: msg || 'Your library is empty' }),
      el('div', { text: msg ? '' : 'Add music to your folder, then click “Rescan library”.' }),
    ]);
  }

  // ============================================================
  //  ACCENT COLOR
  // ============================================================
  function applyAccent(id) {
    const a = ACCENTS.find((x) => x.id === id) || ACCENTS[0];
    document.documentElement.style.setProperty('--accent', a.accent);
    document.documentElement.style.setProperty('--accent-hover', a.hover);
  }
  function setupAccent() {
    const pop = $('#accent-pop');
    pop.innerHTML = '';
    for (const g of ['warm', 'cool', 'neutral']) {
      const row = el('div', { class: 'accent-row' });
      for (const a of ACCENTS.filter((x) => x.group === g)) {
        const sw = el('button', { class: 'swatch', title: a.id, style: 'background:' + a.accent });
        sw.classList.toggle('active', (settings.accent || 'green') === a.id);
        sw.addEventListener('click', (e) => {
          e.stopPropagation();
          settings.accent = a.id;
          applyAccent(a.id);
          api.setSettings({ accent: a.id });
          pop.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s.title === a.id));
          pop.classList.add('hidden');
        });
        row.appendChild(sw);
      }
      pop.appendChild(row);
    }
    $('#accent-btn').addEventListener('click', (e) => { e.stopPropagation(); pop.classList.toggle('hidden'); });
    document.addEventListener('click', () => pop.classList.add('hidden'));
  }

  // ============================================================
  //  RECENTLY ADDED
  // ============================================================
  function renderRecent(c) {
    const head = el('div', { class: 'view-head' });
    const left = el('div');
    left.appendChild(el('h1', { text: 'Recently Added' }));
    left.appendChild(el('div', { class: 'sub', text: 'Newest additions to your library' }));
    head.appendChild(left);
    c.appendChild(head);
    if (!tracks.length) { c.appendChild(emptyState()); return; }
    const list = tracks.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 200);
    c.appendChild(trackTable(list, { columns: ['index', 'titleArt', 'album', 'year', 'duration'], context: 'songs' }));
  }

  // ============================================================
  //  ON REPEAT (weekly smart playlist)
  // ============================================================
  function isoWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
  }
  function computeOnRepeat() {
    const from = Date.now() - 30 * 86400000;
    const counts = new Map();
    for (const p of history) {
      if (p.t < from || !byPath.has(p.p)) continue;
      counts.set(p.p, (counts.get(p.p) || 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([p]) => p);
  }
  async function refreshOnRepeat() {
    const wk = isoWeekKey(new Date());
    const cached = settings.onRepeat || { week: null, paths: [] };
    if (cached.week === wk && Array.isArray(cached.paths) && cached.paths.length) {
      onRepeatPaths = cached.paths.filter((p) => byPath.has(p));
    } else {
      onRepeatPaths = computeOnRepeat();
      settings.onRepeat = { week: wk, paths: onRepeatPaths };
      await api.setSettings({ onRepeat: settings.onRepeat });
    }
    updateOnRepeatCount();
  }
  function updateOnRepeatCount() {
    const elc = $('#onrepeat-count');
    if (elc) elc.textContent = onRepeatPaths.length ? String(onRepeatPaths.length) : '';
  }
  function renderOnRepeat(c) {
    const list = onRepeatPaths.map((p) => byPath.get(p)).filter(Boolean);
    c.appendChild(detailHeader({ kind: 'Smart Playlist', title: 'On Repeat', art: list[0] ? list[0].artPath : null, meta: 'Your most-played songs over the last 30 days · updates weekly' }));
    if (!list.length) {
      c.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'big', text: 'Nothing on repeat yet' }),
        el('div', { text: 'Play songs a few times and they’ll show up here. This list refreshes every week.' }),
      ]));
      return;
    }
    const actions = el('div', { class: 'detail-actions' });
    actions.appendChild(el('button', { class: 'play-big', html: ICONS.play, onclick: () => playList(list, 0) }));
    actions.appendChild(el('button', { class: 'btn', text: 'Add all to queue', onclick: () => { Player.addToQueue(list); toast(list.length + ' added to queue'); } }));
    c.appendChild(actions);
    c.appendChild(trackTable(list, { columns: ['index', 'titleArt', 'album', 'duration'], context: 'songs' }));
  }

  // ============================================================
  //  RECOMMENDATIONS (content-based, fully local) + AUTOPLAY + DISCOVER
  // ============================================================
  function genreTokens(t) {
    return (t.genre || '').toLowerCase().split(/[;,/]+/).map((s) => s.trim()).filter(Boolean);
  }
  function buildTasteProfile() {
    const genres = new Map(), artists = new Map();
    for (const p of history) {
      const t = byPath.get(p.p);
      if (!t) continue;
      for (const g of genreTokens(t)) genres.set(g, (genres.get(g) || 0) + 1);
      const a = t.albumArtist || t.artist;
      if (a) artists.set(a, (artists.get(a) || 0) + 1);
    }
    return { genres, artists, plays: history.length };
  }
  function similarity(a, b) {
    if (a.path === b.path) return -1;
    let score = 0;
    const aa = a.albumArtist || a.artist, ba = b.albumArtist || b.artist;
    if (aa && ba && aa === ba) score += 3;
    const ag = new Set(genreTokens(a)), bg = genreTokens(b);
    if (ag.size && bg.length) {
      let inter = 0;
      for (const g of bg) if (ag.has(g)) inter++;
      const union = new Set([...ag, ...bg]).size;
      if (union) score += 4 * (inter / union);
    }
    if (a.year && b.year) score += Math.max(0, 1.5 - Math.abs(a.year - b.year) / 8);
    return score;
  }
  // Used by the player for autoplay "radio".
  function recommendNext(seed, excludeSet) {
    if (!seed || !tracks.length) return null;
    const profile = buildTasteProfile();
    const scored = [];
    for (const t of tracks) {
      if (t.path === seed.path || (excludeSet && excludeSet.has(t.path))) continue;
      let s = similarity(seed, t);
      if (s < 0) continue;
      const aa = t.albumArtist || t.artist;
      if (aa && profile.artists.get(aa)) s += Math.min(1.5, profile.artists.get(aa) * 0.3);
      for (const g of genreTokens(t)) if (profile.genres.get(g)) s += Math.min(1, profile.genres.get(g) * 0.15);
      s += Math.random() * 0.6;
      scored.push([t, s]);
    }
    if (!scored.length) {
      const pool = tracks.filter((t) => t.path !== seed.path && !(excludeSet && excludeSet.has(t.path)));
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    }
    scored.sort((x, y) => y[1] - x[1]);
    const top = scored.slice(0, 8);
    return top[Math.floor(Math.random() * top.length)][0];
  }
  // Weekly "Discover" smart playlist: taste-matched, favouring less-played songs.
  function discoverMix() {
    const profile = buildTasteProfile();
    if (!profile.plays) {
      return tracks.slice().sort(() => Math.random() - 0.5).slice(0, 30).map((t) => t.path);
    }
    const from = Date.now() - 30 * 86400000;
    const recent = new Map();
    for (const p of history) if (p.t >= from) recent.set(p.p, (recent.get(p.p) || 0) + 1);
    const scored = [];
    for (const t of tracks) {
      let s = 0;
      const aa = t.albumArtist || t.artist;
      if (aa && profile.artists.get(aa)) s += Math.min(3, profile.artists.get(aa) * 0.5);
      for (const g of genreTokens(t)) if (profile.genres.get(g)) s += Math.min(2, profile.genres.get(g) * 0.25);
      s -= (recent.get(t.path) || 0) * 1.2;
      s += Math.random() * 1.2;
      scored.push([t, s]);
    }
    scored.sort((x, y) => y[1] - x[1]);
    return scored.slice(0, 30).map(([t]) => t.path);
  }
  async function refreshDiscover() {
    const wk = isoWeekKey(new Date());
    const cached = settings.discover || { week: null, paths: [] };
    if (cached.week === wk && Array.isArray(cached.paths) && cached.paths.length) {
      discoverPaths = cached.paths.filter((p) => byPath.has(p));
    } else {
      discoverPaths = discoverMix();
      settings.discover = { week: wk, paths: discoverPaths };
      await api.setSettings({ discover: settings.discover });
    }
    updateDiscoverCount();
  }
  function updateDiscoverCount() {
    const elc = $('#discover-count');
    if (elc) elc.textContent = discoverPaths.length ? String(discoverPaths.length) : '';
  }
  function renderDiscover(c) {
    const list = discoverPaths.map((p) => byPath.get(p)).filter(Boolean);
    c.appendChild(detailHeader({ kind: 'Smart Playlist', title: 'Discover Mix', art: list[0] ? list[0].artPath : null, meta: 'Recommended from your library based on what you play · refreshes weekly' }));
    if (!list.length) { c.appendChild(emptyState('No recommendations yet')); return; }
    const actions = el('div', { class: 'detail-actions' });
    actions.appendChild(el('button', { class: 'play-big', html: ICONS.play, onclick: () => playList(list, 0) }));
    actions.appendChild(el('button', { class: 'btn', text: 'Add all to queue', onclick: () => { Player.addToQueue(list); toast(list.length + ' added to queue'); } }));
    c.appendChild(actions);
    c.appendChild(trackTable(list, { columns: ['index', 'titleArt', 'album', 'duration'], context: 'songs' }));
    c.appendChild(el('div', { class: 'recap-note', style: 'margin-top:20px' }, [el('span', { text: '✨' }), el('span', { text: 'Content-based: matched on the genre, artist and era in your tags plus your play history — it sharpens the more you listen.' })]));
  }

  // ============================================================
  //  RECAPS (computed locally from play history)
  // ============================================================
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function startOfWeek(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return startOfDay(x); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
  function startOfYear(d) { return new Date(d.getFullYear(), 0, 1).getTime(); }
  function weekLabel(d) {
    const s = new Date(startOfWeek(d)); const e = new Date(startOfWeek(d) + 6 * 86400000);
    const opt = { month: 'short', day: 'numeric' };
    return s.toLocaleDateString(undefined, opt) + ' – ' + e.toLocaleDateString(undefined, opt);
  }
  function periodRange(period) {
    const now = new Date();
    if (period === 'week') return { from: startOfWeek(now), to: Date.now() + 1, kind: 'This Week', label: weekLabel(now) };
    if (period === 'month') return { from: startOfMonth(now), to: Date.now() + 1, kind: 'This Month', label: now.toLocaleString(undefined, { month: 'long', year: 'numeric' }) };
    return { from: startOfYear(now), to: Date.now() + 1, kind: 'This Year', label: String(now.getFullYear()) };
  }
  function aggregate(from, to) {
    const inRange = history.filter((p) => p.t >= from && p.t < to);
    let totalMs = 0;
    const byTrack = new Map(), byArtist = new Map(), byAlbum = new Map(), days = new Set();
    for (const p of inRange) {
      totalMs += p.ms || 0;
      days.add(startOfDay(new Date(p.t)));
      byTrack.set(p.p, (byTrack.get(p.p) || 0) + 1);
      const t = byPath.get(p.p);
      if (t) {
        const ak = t.albumArtist || t.artist || 'Unknown Artist';
        byArtist.set(ak, (byArtist.get(ak) || 0) + 1);
        byAlbum.set(albumKey(t), (byAlbum.get(albumKey(t)) || 0) + 1);
      }
    }
    return { count: inRange.length, totalMs, byTrack, byArtist, byAlbum, days };
  }
  function topEntries(map, n) { return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n); }
  function statBox(num, label) {
    const s = el('div', { class: 'stat' });
    s.appendChild(el('b', { text: String(num) }));
    s.appendChild(el('span', { text: label }));
    return s;
  }
  function rankList(title, entries, opts) {
    opts = opts || {};
    const wrap = el('div', { class: 'rank-list' });
    wrap.appendChild(el('h3', { text: title }));
    if (!entries.length) { wrap.appendChild(el('div', { class: 'rank-sub', text: 'Not enough data yet' })); return wrap; }
    entries.forEach((en, i) => {
      const row = el('div', { class: 'rank-row' + (opts.round ? ' round' : '') });
      row.appendChild(el('div', { class: 'rank-n', text: String(i + 1) }));
      row.appendChild(el('img', { src: en.art ? api.mediaUrl(en.art) : PLACEHOLDER, onerror: imgFallback }));
      const meta = el('div', { class: 'rank-meta' });
      meta.appendChild(el('div', { class: 'rank-title', text: en.title }));
      if (en.sub) meta.appendChild(el('div', { class: 'rank-sub', text: en.sub }));
      row.appendChild(meta);
      row.appendChild(el('div', { class: 'rank-count', text: en.count + ' play' + (en.count === 1 ? '' : 's') }));
      if (opts.onClick) row.addEventListener('click', () => opts.onClick(en));
      wrap.appendChild(row);
    });
    return wrap;
  }
  function renderRecaps(c) {
    const head = el('div', { class: 'view-head' });
    const left = el('div');
    left.appendChild(el('h1', { text: 'Your Recaps' }));
    left.appendChild(el('div', { class: 'sub', text: 'A look at your listening — computed privately on your device' }));
    head.appendChild(left);
    c.appendChild(head);
    if (!history.length) {
      c.appendChild(el('div', { class: 'empty' }, [
        el('div', { class: 'big', text: 'No listening data yet' }),
        el('div', { text: 'Play some music and your weekly, monthly and yearly recaps will appear here.' }),
      ]));
      return;
    }
    const cards = el('div', { class: 'recap-cards' });
    for (const period of ['week', 'month', 'year']) {
      const r = periodRange(period);
      const agg = aggregate(r.from, r.to);
      const card = el('div', { class: 'recap-card ' + period });
      const top = el('div');
      top.appendChild(el('div', { class: 'rc-kind', text: r.kind }));
      top.appendChild(el('div', { class: 'rc-period', text: r.label }));
      card.appendChild(top);
      card.appendChild(el('div', { class: 'rc-stat', html: '<b>' + Math.round(agg.totalMs / 60000) + '</b> minutes · ' + agg.count + ' plays' }));
      card.addEventListener('click', () => navigate({ type: 'recap', period }));
      cards.appendChild(card);
    }
    c.appendChild(cards);
    c.appendChild(el('div', { class: 'recap-note' }, [el('span', { text: '🔒' }), el('span', { text: 'Only the song and time are recorded, and only on this Mac. Nothing is uploaded.' })]));
  }
  function renderRecapDetail(c, period) {
    const r = periodRange(period);
    const agg = aggregate(r.from, r.to);
    c.appendChild(el('button', { class: 'recap-back', text: '← Recaps', onclick: () => navigate({ type: 'recaps' }) }));
    const hero = el('div', { class: 'recap-hero ' + period });
    hero.appendChild(el('div', { class: 'rh-kind', text: r.kind }));
    hero.appendChild(el('div', { class: 'rh-title', text: r.label }));
    const sg = el('div', { class: 'stat-grid' });
    sg.appendChild(statBox(Math.round(agg.totalMs / 60000), 'minutes listened'));
    sg.appendChild(statBox(agg.count, 'songs played'));
    sg.appendChild(statBox(agg.byTrack.size, 'unique tracks'));
    sg.appendChild(statBox(agg.byArtist.size, 'artists'));
    sg.appendChild(statBox(agg.days.size, 'days active'));
    hero.appendChild(sg);
    c.appendChild(hero);

    const albums = getAlbums(), artists = getArtists();
    const cols = el('div', { class: 'recap-cols' });
    const trackEntries = topEntries(agg.byTrack, 10).map(([p, count]) => {
      const t = byPath.get(p);
      return { key: p, count, title: t ? t.title : p.split('/').pop(), sub: t ? t.artist : '', art: t ? t.artPath : null, track: t };
    });
    cols.appendChild(rankList('Top tracks', trackEntries, { onClick: (en) => { if (en.track) navigate({ type: 'album', key: albumKey(en.track) }); } }));
    const artistEntries = topEntries(agg.byArtist, 5).map(([name, count]) => {
      const a = artists.find((x) => x.name === name);
      return { key: name, count, title: name, sub: '', art: a ? a.art : null };
    });
    cols.appendChild(rankList('Top artists', artistEntries, { round: true, onClick: (en) => navigate({ type: 'artist', name: en.key }) }));
    c.appendChild(cols);

    const albumEntries = topEntries(agg.byAlbum, 5).map(([k, count]) => {
      const a = albums.find((x) => x.key === k);
      return { key: k, count, title: a ? a.album : k, sub: a ? a.artist : '', art: a ? a.art : null };
    });
    const albWrap = el('div', { style: 'margin-top:24px' });
    albWrap.appendChild(rankList('Top albums', albumEntries, { onClick: (en) => navigate({ type: 'album', key: en.key }) }));
    c.appendChild(albWrap);
    c.appendChild(el('div', { class: 'recap-note' }, [el('span', { text: '🔒' }), el('span', { text: 'Calculated on your device from your local play history.' })]));
  }

  // ============================================================
  //  QUEUE PANEL
  // ============================================================
  function queueRow(t, opts) {
    opts = opts || {};
    const row = el('div', { class: 'q-row' + (opts.current ? ' current' : '') });
    row.appendChild(el('img', { src: artUrl(t), onerror: imgFallback }));
    const meta = el('div', { class: 'q-meta' });
    meta.appendChild(el('div', { class: 'q-title', text: t.title }));
    meta.appendChild(el('div', { class: 'q-artist', text: t.artist }));
    row.appendChild(meta);
    if (opts.removable) row.appendChild(el('button', { class: 'q-remove', text: '✕', onclick: (e) => { e.stopPropagation(); Player.removeFromQueue(opts.index); } }));
    if (opts.onClick) row.addEventListener('click', opts.onClick);
    if (opts.draggable) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/qreorder', String(opts.index)));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('drag-over'); const from = e.dataTransfer.getData('text/qreorder'); if (from !== '') Player.reorderQueue(parseInt(from, 10), opts.index); });
    }
    return row;
  }
  function renderQueue() {
    const panel = $('#queue-panel');
    const q = Player.getQueue();
    panel.innerHTML = '';
    const head = el('div', { class: 'q-head' });
    head.appendChild(el('span', { text: 'Queue' }));
    head.appendChild(el('button', { class: 'q-clear', text: 'Clear', onclick: () => Player.clearQueue() }));
    panel.appendChild(head);

    const ap = el('div', { class: 'q-autoplay' });
    ap.appendChild(el('span', { text: 'Autoplay similar when queue ends' }));
    const on = Player.getState().autoplay;
    const tg = el('button', { class: 'q-toggle' + (on ? ' on' : ''), html: '<span class="knob"></span>', title: 'Autoplay' });
    tg.addEventListener('click', () => {
      const next = !Player.getState().autoplay;
      Player.setAutoplay(next);
      settings.autoplay = next;
      api.setSettings({ autoplay: next });
      renderQueue();
    });
    ap.appendChild(tg);
    panel.appendChild(ap);

    const body = el('div', { class: 'q-body' });
    if (q.nowPlaying) {
      body.appendChild(el('div', { class: 'q-section-title', text: 'Now playing' }));
      body.appendChild(queueRow(q.nowPlaying, { current: true }));
    }
    if (q.userQueue.length) {
      body.appendChild(el('div', { class: 'q-section-title', text: 'Next in queue' }));
      q.userQueue.forEach((t, i) => body.appendChild(queueRow(t, { removable: true, index: i, draggable: true, onClick: () => Player.playFromQueue(i) })));
    }
    if (q.upNext.length) {
      body.appendChild(el('div', { class: 'q-section-title', text: 'Next up' }));
      q.upNext.slice(0, 60).forEach((t, i) => body.appendChild(queueRow(t, { onClick: () => Player.playUpNext(i) })));
    }
    if (!q.nowPlaying && !q.userQueue.length && !q.upNext.length) {
      body.appendChild(el('div', { class: 'empty', style: 'padding:40px 10px' }, [
        el('div', { class: 'big', text: 'Queue is empty' }),
        el('div', { text: 'Play something, or add songs with “Add to queue”.' }),
      ]));
    }
    panel.appendChild(body);
  }
  function setupQueue() {
    const btn = $('#btn-queue');
    const panel = $('#queue-panel');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('hidden');
      const open = !panel.classList.contains('hidden');
      btn.classList.toggle('on', open);
      if (open) renderQueue();
    });
    Player.subscribe((type) => {
      if ((type === 'queue' || type === 'track') && !panel.classList.contains('hidden')) renderQueue();
    });
  }

  // ============================================================
  //  CONTEXT MENUS
  // ============================================================
  function showMenu(x, y, items) {
    const menu = $('#context-menu');
    menu.innerHTML = '';
    for (const it of items) {
      if (it.sep) { menu.appendChild(el('div', { class: 'cm-sep' })); continue; }
      if (it.label) { menu.appendChild(el('div', { class: 'cm-label', text: it.label })); continue; }
      const item = el('div', { class: 'cm-item', text: it.text });
      item.addEventListener('click', () => { hideMenu(); it.action(); });
      menu.appendChild(item);
    }
    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  }
  function hideMenu() { $('#context-menu').classList.add('hidden'); }

  function playlistTargets(paths) {
    const items = [{ text: '＋ New playlist…', action: () => openModal({ title: 'New Playlist', saveLabel: 'Create', onSave: ({ name, description }) => { const pl = newPlaylist(name, null, description); addToPlaylist(pl, paths); } }) }];
    if (playlists.length) items.push({ sep: true });
    for (const pl of playlists) items.push({ text: pl.name, action: () => addToPlaylist(pl, paths) });
    return items;
  }

  function openTrackMenu(e, t, context, index) {
    const items = [
      { text: 'Play', action: () => playList([t], 0) },
      { text: 'Play next', action: () => { Player.playNext(t); toast('Playing next'); } },
      { text: 'Add to queue', action: () => { Player.addToQueue(t); toast('Added to queue'); } },
      { sep: true },
      { label: 'Add to playlist' },
      ...playlistTargets([t.path]),
      { sep: true },
      { text: 'Go to album', action: () => gotoAlbum(t) },
      { text: 'Go to artist', action: () => gotoArtist(t) },
    ];
    if (context === 'playlist' && view.type === 'playlist') {
      items.push({ sep: true });
      items.push({ text: 'Remove from this playlist', action: () => { const pl = playlists.find((p) => p.id === view.id); if (pl) removeFromPlaylist(pl, index); } });
    }
    showMenu(e.clientX, e.clientY, items);
  }

  function openAlbumMenu(e, albumTracks) {
    showMenu(e.clientX, e.clientY, [
      { text: 'Add to queue', action: () => { Player.addToQueue(albumTracks); toast(albumTracks.length + ' added to queue'); } },
      { sep: true },
      { label: 'Add to playlist' },
      ...playlistTargets(albumTracks.map((t) => t.path)),
    ]);
  }

  function openPlaylistMenu(e, pl) {
    showMenu(e.clientX, e.clientY, [
      { text: 'Play', action: () => { const list = pl.paths.map((p) => byPath.get(p)).filter(Boolean); if (list.length) playList(list, 0); } },
      { text: 'Rename…', action: () => renamePlaylist(pl) },
      { text: 'Delete', action: () => deletePlaylist(pl) },
    ]);
  }

  document.addEventListener('click', hideMenu);
  document.addEventListener('scroll', hideMenu, true);

  // ============================================================
  //  PLAYER BAR
  // ============================================================
  function applyShuffleUI() {
    const s = Player.getState();
    $('#btn-shuffle').classList.toggle('on', s.shuffle);
  }

  function setupPlayerBar() {
    $('#btn-play').innerHTML = ICONS.play;
    $('#btn-prev').innerHTML = ICONS.prev;
    $('#btn-next').innerHTML = ICONS.next;
    $('#btn-shuffle').innerHTML = ICONS.shuffle;
    $('#btn-repeat').innerHTML = ICONS.repeat;

    $('#btn-play').addEventListener('click', () => Player.toggle());
    $('#btn-next').addEventListener('click', () => Player.next());
    $('#btn-prev').addEventListener('click', () => Player.prev());
    $('#btn-shuffle').addEventListener('click', () => { Player.toggleShuffle(); persistPlayerPrefs(); });
    $('#btn-repeat').addEventListener('click', () => { Player.cycleRepeat(); persistPlayerPrefs(); });

    const seek = $('#seek');
    let seeking = false;
    seek.addEventListener('input', () => { seeking = true; const pct = seek.value / 1000 * 100; seek.style.setProperty('--pct', pct + '%'); });
    seek.addEventListener('change', () => { Player.seekFraction(seek.value / 1000); seeking = false; });
    seek.classList.add('filled');

    const vol = $('#volume');
    vol.classList.add('filled');
    vol.value = settings.volume;
    vol.style.setProperty('--pct', settings.volume * 100 + '%');
    vol.addEventListener('input', () => { Player.setVolume(parseFloat(vol.value)); vol.style.setProperty('--pct', vol.value * 100 + '%'); persistPlayerPrefs(); });

    Player.subscribe((type, s) => {
      if (type === 'track' || type === 'state') {
        $('#btn-play').innerHTML = s.playing ? ICONS.pause : ICONS.play;
        $('#btn-shuffle').classList.toggle('on', s.shuffle);
        const rb = $('#btn-repeat');
        rb.classList.toggle('on', s.repeat !== 'off');
        rb.innerHTML = s.repeat === 'one' ? ICONS.repeatOne : ICONS.repeat;
        rb.title = 'Repeat: ' + s.repeat;
        api.updateNowPlaying({ title: s.current ? s.current.title : null, artist: s.current ? s.current.artist : null, playing: s.playing });
      }
      if (type === 'track') {
        const t = s.current;
        $('#np-art').src = t ? artUrl(t) : PLACEHOLDER;
        $('#np-title').textContent = t ? t.title : '—';
        $('#np-artist').textContent = t ? t.artist : '';
        document.title = t ? t.title + ' — ' + t.artist : 'Music Player';
        // refresh playing highlight in current view
        document.querySelectorAll('.track-row').forEach((tr) => tr.classList.toggle('playing', !!t && tr.dataset.path === t.path));
      }
      if (type === 'time' || type === 'track') {
        if (!seeking) {
          const frac = s.duration ? s.time / s.duration : 0;
          seek.value = Math.round(frac * 1000);
          seek.style.setProperty('--pct', frac * 100 + '%');
        }
        $('#cur-time').textContent = fmtTime(s.time);
        $('#dur-time').textContent = fmtTime(s.duration || (s.current && s.current.duration) || 0);
      }
    });
  }

  function persistPlayerPrefs() {
    const s = Player.getState();
    api.setSettings({ volume: s.volume, shuffle: s.shuffle, repeat: s.repeat });
  }

  // ============================================================
  //  THEME
  // ============================================================
  function applyTheme(dark) { document.body.dataset.theme = dark ? 'dark' : 'light'; }
  function markThemeSeg(choice) {
    document.querySelectorAll('#theme-seg button').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === choice));
  }

  // ============================================================
  //  NAV + EVENTS
  // ============================================================
  function syncNavActive() {
    document.querySelectorAll('.nav-item').forEach((b) => {
      const v = b.dataset.view;
      b.classList.toggle('active', v === view.type || (view.type === 'album' && v === 'albums') || (view.type === 'artist' && v === 'artists') || (view.type === 'recap' && v === 'recaps'));
    });
    document.querySelectorAll('#playlist-list li').forEach((li) => li.classList.toggle('active', view.type === 'playlist' && li.dataset.id === view.id));
  }

  function setupNav() {
    document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', async () => {
      const v = b.dataset.view;
      if (v === 'recaps' || v === 'onrepeat') await reloadHistory();
      $('#search').value = '';
      navigate({ type: v });
    }));
    $('#new-playlist').addEventListener('click', () => openModal({ title: 'New Playlist', saveLabel: 'Create', onSave: ({ name, description }) => { const pl = newPlaylist(name, null, description); navigate({ type: 'playlist', id: pl.id }); } }));

    let searchTimer;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const q = e.target.value;
      searchTimer = setTimeout(() => {
        if (q.trim()) navigate({ type: 'search', query: q }, view.type === 'search');
        else if (view.type === 'search') navigate({ type: 'songs' }, true);
      }, 120);
    });

    $('#nav-back').addEventListener('click', goBack);
    $('#nav-fwd').addEventListener('click', goForward);

    $('#rescan').addEventListener('click', rescan);

    document.querySelectorAll('#theme-seg button').forEach((b) => b.addEventListener('click', async () => {
      const choice = b.dataset.themeChoice;
      const info = await api.setTheme(choice);
      settings.theme = choice;
      applyTheme(info.dark);
      markThemeSeg(choice);
    }));

    api.onThemeUpdated((info) => { if (settings.theme === 'system') applyTheme(info.dark); });

    $('#lib-path').addEventListener('click', async () => {
      const folder = await api.chooseFolder();
      if (folder) { settings.libraryRoot = folder; await rescan(); updateLibPath(); }
    });
  }

  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      const inField = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.metaKey && e.key === '[') { e.preventDefault(); goBack(); return; }
      if (e.metaKey && e.key === ']') { e.preventDefault(); goForward(); return; }
      if (e.key === '/' && !inField) { e.preventDefault(); $('#search').focus(); return; }
      if (inField) return;
      if (e.code === 'Space') { e.preventDefault(); Player.toggle(); }
      else if (e.key === 'ArrowRight' && e.metaKey) { Player.next(); }
      else if (e.key === 'ArrowLeft' && e.metaKey) { Player.prev(); }
      else if (e.key === 'ArrowRight') { const s = Player.getState(); if (s.duration) Player.seekFraction((s.time + 5) / s.duration); }
      else if (e.key === 'ArrowLeft') { const s = Player.getState(); if (s.duration) Player.seekFraction((s.time - 5) / s.duration); }
    });
  }

  // ============================================================
  //  RESCAN + INIT
  // ============================================================
  async function ingest(result) {
    tracks = result.tracks || [];
    byPath = new Map(tracks.map((t) => [t.path, t]));
    Player.refreshQueue(byPath);
  }

  function mergeTracks(list) {
    let added = 0;
    for (const t of list) {
      if (!byPath.has(t.path)) { tracks.push(t); byPath.set(t.path, t); added++; }
    }
    return added;
  }

  // Re-load files dragged in previously (kept in settings) so they survive restarts/rescans.
  async function loadImported() {
    const paths = (settings.importedPaths || []).filter(Boolean);
    if (!paths.length) return;
    try {
      mergeTracks(await api.importPaths(paths));
      Player.refreshQueue(byPath);
    } catch (e) { /* ignore */ }
  }

  function setupDropZone() {
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    // Only show the full-screen import overlay for real files from Finder, not
    // for songs dragged inside the app (those use the selective sidebar blur).
    const isFileDrag = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files'));
    window.addEventListener('dragenter', (e) => { stop(e); if (isFileDrag(e)) document.body.classList.add('dragging'); });
    window.addEventListener('dragover', (e) => { stop(e); if (isFileDrag(e)) document.body.classList.add('dragging'); });
    window.addEventListener('dragleave', (e) => { stop(e); if (e.relatedTarget === null) document.body.classList.remove('dragging'); });
    window.addEventListener('drop', async (e) => {
      stop(e);
      document.body.classList.remove('dragging');
      document.body.classList.remove('dragging-track');
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      const paths = files.map((f) => api.getPathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      toast('Importing…');
      let imported = [];
      try { imported = await api.importPaths(paths); } catch (err) { /* ignore */ }
      if (!imported.length) { toast('No playable audio found'); return; }
      mergeTracks(imported);
      const set = new Set(settings.importedPaths || []);
      paths.forEach((p) => set.add(p));
      settings.importedPaths = [...set];
      api.setSettings({ importedPaths: settings.importedPaths });
      Player.refreshQueue(byPath);
      navigate({ type: 'album', key: albumKey(imported[0]) }); // show the dropped album
      toast('Added ' + imported.length + ' song' + (imported.length === 1 ? '' : 's'));
    });
  }

  function updateLibPath() {
    api.getLibraryRoot().then((root) => { $('#lib-path').textContent = root || ''; });
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.classList.add('hidden'), 250); }, 1800);
  }

  async function rescan() {
    const btn = $('#rescan');
    btn.classList.add('spinning');
    try {
      const result = await api.rescan();
      await ingest(result);
      await loadImported();
      await reloadHistory();
      await refreshOnRepeat();
      await refreshDiscover();
      renderPlaylistList();
      render();
      toast('Library updated · ' + tracks.length + ' songs');
    } finally {
      btn.classList.remove('spinning');
    }
  }

  async function reloadHistory() { try { history = await api.getHistory(); } catch (e) { /* ignore */ } }

  async function init() {
    settings = await api.getSettings();
    const theme = await api.getTheme();
    applyTheme(theme.dark);
    markThemeSeg(settings.theme || 'system');
    // migrate legacy accent ids that were removed in the warm/cool re-sort
    if (!ACCENTS.some((a) => a.id === settings.accent)) {
      const legacy = { pink: 'rose', indigo: 'purple' };
      settings.accent = legacy[settings.accent] || 'green';
      api.setSettings({ accent: settings.accent });
    }
    applyAccent(settings.accent || 'green');

    setupPlayerBar();
    setupNav();
    setupKeyboard();
    setupAccent();
    setupQueue();
    setupDropZone();

    // Dock right-click menu + media-key controls drive the player.
    api.onDockControl((action) => {
      if (action === 'playpause') Player.toggle();
      else if (action === 'next') Player.next();
      else if (action === 'prev') Player.prev();
    });
    window.addEventListener('focus', reloadHistory);

    Player.setVolume(settings.volume != null ? settings.volume : 1);
    Player.setShuffle(!!settings.shuffle);
    Player.setRepeat(settings.repeat || 'off');

    playlists = await api.getPlaylists();
    renderPlaylistList();
    updateLibPath();

    history = await api.getHistory();

    Player.setRecommender(recommendNext);
    Player.setAutoplay(settings.autoplay !== false);

    const result = await api.getLibrary();
    await ingest(result);
    await loadImported();
    await refreshOnRepeat();
    await refreshDiscover();
    navigate(view); // seed the back/forward history with the initial view
  }

  window.addEventListener('DOMContentLoaded', init);
})();
