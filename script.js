/*
  Music Cloud — main.js (full upgrade)
  Core IndexedDB logic preserved exactly.
  Added: search, sort, favorites, shuffle, repeat,
         waveform visualizer, toast, mute, recently played,
         seek progress fill, play/pause icon sync.
*/

/* ══════════════ CONSTANTS ══════════════ */
const DB_NAME    = "music-cloud";
const DB_VERSION = 1;
const STORE_TRACKS = "tracks";
const AUDIO_EXTENSIONS = ["mp3","wav","ogg","m4a","aac","flac","webm","opus"];

/* ══════════════ ELEMENT REFS ══════════════ */
/* These IDs are required by the original logic — never renamed */
const els = {
  fileInput:    document.getElementById("fileInput"),
  dropzone:     document.getElementById("dropzone"),
  trackList:    document.getElementById("trackList"),
  libraryMeta:  document.getElementById("libraryMeta"),
  audio:        document.getElementById("audio"),
  playBtn:      document.getElementById("playBtn"),
  prevBtn:      document.getElementById("prevBtn"),
  nextBtn:      document.getElementById("nextBtn"),
  seek:         document.getElementById("seek"),
  volume:       document.getElementById("volume"),
  timeCurrent:  document.getElementById("timeCurrent"),
  timeDuration: document.getElementById("timeDuration"),
  nowTitle:     document.getElementById("nowTitle"),
  nowSub:       document.getElementById("nowSub"),
  clearAllBtn:  document.getElementById("clearAllBtn"),
};

/* New element refs (added in upgrade) */
const ui = {
  searchInput:      document.getElementById("searchInput"),
  searchClear:      document.getElementById("searchClear"),
  sortSelect:       document.getElementById("sortSelect"),
  emptyState:       document.getElementById("emptyState"),
  noResultsState:   document.getElementById("noResultsState"),
  trackColsHeader:  document.getElementById("trackColsHeader"),
  shuffleBtn:       document.getElementById("shuffleBtn"),
  repeatBtn:        document.getElementById("repeatBtn"),
  playIcon:         document.getElementById("playIcon"),
  muteBtn:          document.getElementById("muteBtn"),
  volIcon:          document.getElementById("volIcon"),
  playerFavBtn:     document.getElementById("playerFavBtn"),
  audioVisualizer:  document.getElementById("audioVisualizer"),
  toast:            document.getElementById("toast"),
  libraryViewTitle: document.getElementById("libraryViewTitle"),
  favBadge:         document.getElementById("favBadge"),
  navFavorites:     document.getElementById("navFavorites"),
  recentSection:    document.getElementById("recentSection"),
  recentList:       document.getElementById("recentList"),
  storageText:      document.getElementById("storageQuotaText"),
  storageFill:      document.getElementById("storageQuotaFill"),
  waveformCanvas:   document.getElementById("waveformCanvas"),
  waveformPlaceholder: document.getElementById("waveformPlaceholder"),
  expandedFavBtn:   document.getElementById("expandedFavBtn"),
  expandedPlayIcon: document.getElementById("expandedPlayIcon"),
  expandedShuffleBtn: document.getElementById("expandedShuffleBtn"),
  expandedRepeatBtn:  document.getElementById("expandedRepeatBtn"),
  mobileMenuBtn:    document.getElementById("mobileMenuBtn"),
  sidebar:          document.getElementById("sidebar"),
};

/* ══════════════ STATE ══════════════ */
let db              = null;
let tracks          = [];        // full library
let filteredTracks  = [];        // after search/filter
let currentIndex    = -1;        // index in filteredTracks
let currentObjectUrl = null;
let isSeeking       = false;
let isShuffle       = false;
let isRepeat        = false;
let isMuted         = false;
let prevVolume      = 1;
let searchQuery     = "";
let sortMode        = "addedAt-asc";
let viewMode        = "library";  // "library" | "favorites"
let favorites       = new Set(JSON.parse(localStorage.getItem("mc-favs") || "[]"));
let recentlyPlayed  = JSON.parse(localStorage.getItem("mc-recent") || "[]"); // array of track IDs
let toastTimer      = null;
let waveformCtx     = null;
let animationId     = null;

/* ══════════════ UTILITIES ══════════════ */

function formatTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function genId() {
  return Date.now() + "-" + Math.random().toString(36).slice(2);
}

function isLikelyAudioFile(file) {
  if (!file || !file.name) return false;
  const validExtensions = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.mp4', '.wma', '.opus'];
  const fileName = file.name.toLowerCase();
  return validExtensions.some(ext => fileName.endsWith(ext));
}

function cleanName(filename) {
  return filename
    .replace(/\.[^/.]+$/, "")         // remove extension
    .replace(/[-_]/g, " ")             // dashes/underscores → spaces
    .replace(/\s+/g, " ")
    .trim();
}

function showToast(msg, duration = 2200) {
  if (!ui.toast) return;
  if (toastTimer) clearTimeout(toastTimer);
  ui.toast.textContent = msg;
  ui.toast.classList.add("show");
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), duration);
}

function saveFavorites() {
  localStorage.setItem("mc-favs", JSON.stringify([...favorites]));
}

function saveRecent() {
  localStorage.setItem("mc-recent", JSON.stringify(recentlyPlayed));
}

function pushRecent(trackId) {
  recentlyPlayed = recentlyPlayed.filter(id => id !== trackId);
  recentlyPlayed.unshift(trackId);
  recentlyPlayed = recentlyPlayed.slice(0, 5);
  saveRecent();
  renderRecentList();
}

function getDurationFromBlob(blob) {
  return new Promise(resolve => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(blob);
    audio.onloadedmetadata = () => { resolve(audio.duration); URL.revokeObjectURL(url); };
    audio.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    audio.src = url;
  });
}

/* ══════════════ IndexedDB (ORIGINAL — unchanged) ══════════════ */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE_TRACKS, { keyPath: "id" });
      store.createIndex("addedAt", "addedAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(name, mode) {
  return db.transaction(name, mode).objectStore(name);
}

function idb(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function loadTracks() {
  const store = tx(STORE_TRACKS, "readonly");
  tracks = await idb(store.getAll()) || [];
  applySort();
  renderPlaylist();
  updateStorageQuota();
}

async function saveTrack(track) {
  const store = tx(STORE_TRACKS, "readwrite");
  await idb(store.put(track));
}

async function deleteTrack(id) {
  const store = tx(STORE_TRACKS, "readwrite");
  await idb(store.delete(id));
}

async function clearAllTracks() {
  const store = tx(STORE_TRACKS, "readwrite");
  await idb(store.clear());
}

/* ══════════════ UPLOAD (ORIGINAL — unchanged) ══════════════ */

async function addFiles(fileList) {
  const incoming = Array.from(fileList || []);
  const files = incoming.filter(isLikelyAudioFile);

  if (!files.length) {
    showToast("Please select audio files");
    return;
  }

  showToast(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`);

  for (const file of files) {
    try {
      const duration = await getDurationFromBlob(file);
      const track = {
        id:       genId(),
        name:     file.name,
        size:     file.size,
        type:     file.type,
        addedAt:  Date.now(),
        duration: duration,
        blob:     file,
      };
      await saveTrack(track);
    } catch (err) {
      console.error("Upload error:", err);
    }
  }

  await loadTracks();

  if (currentIndex === -1 && filteredTracks.length) {
    setCurrentByIndex(0, { autoplay: false });
  }

  showToast(`Added ${files.length} track${files.length > 1 ? "s" : ""}`);
}

/* ══════════════ SORT & FILTER ══════════════ */

function applySort() {
  const [field, dir] = sortMode.split("-");
  tracks.sort((a, b) => {
    let va = a[field] ?? 0;
    let vb = b[field] ?? 0;
    if (field === "name") { va = va.toLowerCase(); vb = vb.toLowerCase(); }
    if (va < vb) return dir === "asc" ? -1 : 1;
    if (va > vb) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

function applySearch() {
  const q = searchQuery.toLowerCase().trim();
  const source = viewMode === "favorites"
    ? tracks.filter(t => favorites.has(t.id))
    : tracks;

  filteredTracks = q
    ? source.filter(t => t.name.toLowerCase().includes(q))
    : [...source];
}

/* ══════════════ PLAYER (ORIGINAL core — unchanged) ══════════════ */

function setCurrentByIndex(i, { autoplay }) {
  if (i < 0 || i >= filteredTracks.length) return;

  currentIndex = i;
  const track  = filteredTracks[i];

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(track.blob);

  if (els.audio) els.audio.src = currentObjectUrl;

  // Update player UI
  if (els.nowTitle) els.nowTitle.textContent = cleanName(track.name);
  if (els.nowSub)   els.nowSub.textContent   = formatTime(track.duration);

  // Sync expanded player
  const expTitle = document.getElementById("expandedTitle");
  const expMeta  = document.getElementById("expandedMeta");
  if (expTitle) expTitle.textContent = cleanName(track.name);
  if (expMeta)  expMeta.textContent  = formatBytes(track.size);

  // Update favorite buttons
  syncFavButtons(track.id);

  // Push to recently played
  pushRecent(track.id);

  // Re-render to highlight active row
  renderPlaylist();

  if (autoplay && els.audio) els.audio.play();
}

function playPause() {
  if (currentIndex === -1) {
    if (filteredTracks.length) setCurrentByIndex(0, { autoplay: true });
    return;
  }
  if (els.audio) {
    if (els.audio.paused) els.audio.play();
    else                   els.audio.pause();
  }
}

function prev() {
  if (!filteredTracks.length) return;
  if (isShuffle) {
    setCurrentByIndex(randomIndex(), { autoplay: true });
    return;
  }
  const i = currentIndex <= 0 ? filteredTracks.length - 1 : currentIndex - 1;
  setCurrentByIndex(i, { autoplay: true });
}

function next() {
  if (!filteredTracks.length) return;
  if (isShuffle) {
    setCurrentByIndex(randomIndex(), { autoplay: true });
    return;
  }
  const i = currentIndex >= filteredTracks.length - 1 ? 0 : currentIndex + 1;
  setCurrentByIndex(i, { autoplay: true });
}

function randomIndex() {
  if (filteredTracks.length <= 1) return 0;
  let i;
  do { i = Math.floor(Math.random() * filteredTracks.length); } while (i === currentIndex);
  return i;
}

/* ══════════════ PLAY/PAUSE ICON SYNC ══════════════ */

const PLAY_PATH  = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
const PAUSE_PATH = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`;

function syncPlayIcons(playing) {
  const paths = playing ? PAUSE_PATH : PLAY_PATH;
  if (ui.playIcon)         ui.playIcon.innerHTML         = paths;
  if (ui.expandedPlayIcon) ui.expandedPlayIcon.innerHTML = paths;
  if (ui.audioVisualizer) {
    if (playing) ui.audioVisualizer.classList.add("playing");
    else         ui.audioVisualizer.classList.remove("playing");
  }
}

/* ══════════════ FAVORITES ══════════════ */

function toggleFavorite(trackId) {
  if (favorites.has(trackId)) {
    favorites.delete(trackId);
    showToast("Removed from favorites");
  } else {
    favorites.add(trackId);
    showToast("Added to favorites ♥");
  }
  saveFavorites();
  syncFavButtons(trackId);
  updateFavBadge();
  if (viewMode === "favorites") renderPlaylist(); // refresh favorites view
}

function syncFavButtons(trackId) {
  const isFav = favorites.has(trackId);
  [ui.playerFavBtn, ui.expandedFavBtn].forEach(btn => {
    if (!btn) return;
    btn.classList.toggle("player__fav-btn--active", isFav);
    const svg = btn.querySelector("svg");
    if (svg) svg.setAttribute("fill", isFav ? "currentColor" : "none");
  });
}

function updateFavBadge() {
  const count = favorites.size;
  if (ui.favBadge) {
    ui.favBadge.style.display = count ? "inline-block" : "none";
    ui.favBadge.textContent = count;
  }
}

/* ══════════════ SHUFFLE / REPEAT ══════════════ */

function toggleShuffle() {
  isShuffle = !isShuffle;
  [ui.shuffleBtn, ui.expandedShuffleBtn].forEach(btn => {
    if (btn) btn.classList.toggle("is-active", isShuffle);
  });
  showToast(isShuffle ? "Shuffle on" : "Shuffle off");
}

function toggleRepeat() {
  isRepeat = !isRepeat;
  [ui.repeatBtn, ui.expandedRepeatBtn].forEach(btn => {
    if (btn) btn.classList.toggle("is-active", isRepeat);
  });
  if (els.audio) els.audio.loop = isRepeat;
  showToast(isRepeat ? "Repeat on" : "Repeat off");
}

/* ══════════════ MUTE ══════════════ */

const VOL_FULL = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
const VOL_MUTE = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"></line><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"></line>`;

function toggleMute() {
  if (!els.audio) return;
  if (isMuted) {
    isMuted = false;
    els.audio.volume = prevVolume;
    if (els.volume) els.volume.value = prevVolume;
  } else {
    isMuted = true;
    prevVolume = els.audio.volume || 1;
    els.audio.volume = 0;
    if (els.volume) els.volume.value = 0;
  }
  if (ui.volIcon) ui.volIcon.innerHTML = isMuted ? VOL_MUTE : VOL_FULL;
}

/* ══════════════ SEEK PROGRESS FILL ══════════════ */

function updateSeekFill(pct) {
  if (els.seek) els.seek.style.setProperty("--pct", pct + "%");
}

/* ══════════════ STORAGE QUOTA ══════════════ */

function updateStorageQuota() {
  const total = tracks.reduce((sum, t) => sum + (t.size || 0), 0);
  const gb    = 4 * 1024 * 1024 * 1024;
  const pct   = Math.min((total / gb) * 100, 100).toFixed(1);
  if (ui.storageText)  ui.storageText.textContent = formatBytes(total) + " used";
  if (ui.storageFill)  ui.storageFill.style.setProperty("--progress", pct + "%");
}

/* ══════════════ RECENTLY PLAYED ══════════════ */

function renderRecentList() {
  if (!ui.recentList || !ui.recentSection) return;
  const items = recentlyPlayed
    .map(id => tracks.find(t => t.id === id))
    .filter(Boolean)
    .slice(0, 5);

  if (!items.length) {
    ui.recentSection.style.display = "none";
    return;
  }

  ui.recentSection.style.display = "block";
  ui.recentList.innerHTML = items.map(t => `
    <div class="recent-item" data-id="${t.id}">
      <div class="recent-item__dot"></div>
      <span class="recent-item__name">${cleanName(t.name)}</span>
    </div>
  `).join("");

  ui.recentList.querySelectorAll(".recent-item").forEach(item => {
    item.addEventListener("click", () => {
      const id  = item.dataset.id;
      const idx = filteredTracks.findIndex(t => t.id === id);
      if (idx !== -1) setCurrentByIndex(idx, { autoplay: true });
    });
  });
}

/* ══════════════ WAVEFORM CANVAS ══════════════ */

function drawWaveformIdle() {
  const canvas = ui.waveformCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W   = canvas.offsetWidth || 400;
  const H   = canvas.offsetHeight || 56;
  canvas.width  = W;
  canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const bars = 60;
  const gap  = 2;
  const barW = (W - gap * (bars - 1)) / bars;

  for (let i = 0; i < bars; i++) {
    const height = (Math.sin(i * 0.35) * 0.3 + Math.random() * 0.5 + 0.15) * H * 0.7;
    const x = i * (barW + gap);
    const y = (H - height) / 2;
    ctx.fillStyle = "rgba(139,92,246,0.25)";
    ctx.beginPath();
    ctx.roundRect(x, y, barW, height, 2);
    ctx.fill();
  }
}

function animateWaveform() {
  const canvas = ui.waveformCanvas;
  if (!canvas || !els.audio) return;

  const ctx = canvas.getContext("2d");
  const W   = canvas.offsetWidth  || 400;
  const H   = canvas.offsetHeight || 56;
  canvas.width  = W;
  canvas.height = H;

  const bars    = 60;
  const gap     = 2;
  const barW    = (W - gap * (bars - 1)) / bars;
  const pct     = els.audio.duration
    ? els.audio.currentTime / els.audio.duration
    : 0;
  const played  = Math.floor(pct * bars);

  ctx.clearRect(0, 0, W, H);

  for (let i = 0; i < bars; i++) {
    const phase  = i * 0.28 + (els.audio.currentTime || 0) * 2;
    const height = (Math.abs(Math.sin(phase)) * 0.55 + 0.18) * H * 0.82;
    const x      = i * (barW + gap);
    const y      = (H - height) / 2;
    ctx.fillStyle = i < played ? "rgba(139,92,246,0.9)" : "rgba(139,92,246,0.2)";
    ctx.beginPath();
    ctx.roundRect(x, y, barW, height, 2);
    ctx.fill();
  }

  animationId = requestAnimationFrame(animateWaveform);
}

function startWaveform() {
  if (animationId) cancelAnimationFrame(animationId);
  if (ui.waveformPlaceholder) ui.waveformPlaceholder.style.display = "none";
  if (ui.waveformCanvas)      ui.waveformCanvas.style.display = "block";
  animateWaveform();
}

function stopWaveform() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
  drawWaveformIdle();
}

/* ══════════════ RENDER PLAYLIST ══════════════ */

function renderPlaylist() {
  applySearch();

  const container = els.trackList;
  if (!container) return;
  container.innerHTML = "";

  // Meta count
  const source = viewMode === "favorites"
    ? tracks.filter(t => favorites.has(t.id))
    : tracks;
  if (els.libraryMeta) els.libraryMeta.textContent = source.length + " song" + (source.length !== 1 ? "s" : "");

  const hasTracks  = source.length > 0;
  const hasResults = filteredTracks.length > 0;

  // Empty state
  if (ui.emptyState)      ui.emptyState.style.display      = (!hasTracks && !searchQuery) ? "flex" : "none";
  if (ui.noResultsState)  ui.noResultsState.style.display  = (hasTracks && !hasResults)   ? "flex" : "none";
  if (ui.trackColsHeader) ui.trackColsHeader.classList.toggle("hidden", !hasResults);

  // Render rows
  filteredTracks.forEach((t, i) => {
    const isActive = i === currentIndex;
    const isFav    = favorites.has(t.id);
    const name     = cleanName(t.name);

    const row = document.createElement("div");
    row.className = "row" + (isActive ? " row--active" : "");
    row.setAttribute("role", "listitem");

    row.innerHTML = `
      <div class="row__num${isActive ? " row__num--active" : ""}">
        <span class="row__num-val">${i + 1}</span>
        <span class="row__play-icon" style="display:none">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </span>
      </div>
      <div class="row__main">
        <div class="row__thumb">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
        </div>
        <div class="row__text">
          <div class="row__title">${name}</div>
          <div class="row__sub">${formatTime(t.duration)}&nbsp;·&nbsp;${formatBytes(t.size)}</div>
        </div>
      </div>
      <button class="row__fav${isFav ? " row__fav--active" : ""}" data-fav="${t.id}" aria-label="Favorite" title="${isFav ? "Remove favorite" : "Add to favorites"}">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="${isFav ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>
      <div class="row__dur">${formatTime(t.duration)}</div>
    `;

    // Hover: swap number for play icon
    const numVal   = row.querySelector(".row__num-val");
    const playIcon = row.querySelector(".row__play-icon");
    row.addEventListener("mouseenter", () => {
      if (numVal)   numVal.style.display   = "none";
      if (playIcon) playIcon.style.display = "flex";
    });
    row.addEventListener("mouseleave", () => {
      if (numVal)   numVal.style.display   = "";
      if (playIcon) playIcon.style.display = "none";
    });

    // Click row → play
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-fav]")) return;
      setCurrentByIndex(i, { autoplay: true });
    });

    // Fav button
    const favBtn = row.querySelector("[data-fav]");
    if (favBtn) {
      favBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFavorite(t.id);
        renderPlaylist();
      });
    }

    container.appendChild(row);
  });

  renderRecentList();
  updateFavBadge();
}

/* ══════════════ MODAL HELPERS ══════════════ */

function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.removeAttribute("inert");
  m.classList.add("show");
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.setAttribute("inert", "");
  m.classList.remove("show");
}

/* ══════════════ EXPANDED PLAYER ══════════════ */

function openExpandedPlayer() {
  const ep = document.getElementById("expandedPlayer");
  if (!ep) return;
  ep.removeAttribute("inert");
  ep.removeAttribute("aria-hidden");
  ep.classList.add("is-open");
  drawWaveformIdle();
  if (!els.audio?.paused) startWaveform();
}

function closeExpandedPlayer() {
  const ep = document.getElementById("expandedPlayer");
  if (!ep) return;
  ep.setAttribute("inert", "");
  ep.setAttribute("aria-hidden", "true");
  ep.classList.remove("is-open");
  if (animationId) cancelAnimationFrame(animationId);
}

/* ══════════════ VIEW SWITCHING ══════════════ */

function setView(mode) {
  viewMode = mode;
  if (ui.libraryViewTitle) {
    ui.libraryViewTitle.textContent = mode === "favorites" ? "Favorites" : "Library";
  }
  searchQuery = "";
  if (ui.searchInput) ui.searchInput.value = "";
  if (ui.searchClear) ui.searchClear.classList.add("hidden");
  renderPlaylist();

  // Update nav active state
  document.querySelectorAll(".desktop-nav__item").forEach(a => a.classList.remove("desktop-nav__item--active"));
  const target = document.querySelector(`[data-nav="${mode}"]`);
  if (target) target.classList.add("desktop-nav__item--active");
}

/* ══════════════ WIRE ALL EVENTS ══════════════ */

function wireEvents() {
  /* ── Original events (preserved) ── */
  if (els.fileInput) {
    els.fileInput.addEventListener("change", async () => {
      await addFiles(els.fileInput.files);
      els.fileInput.value = "";
      closeModal("uploadModal");
    });
  }

  if (els.playBtn) els.playBtn.onclick = playPause;
  if (els.prevBtn) els.prevBtn.onclick = prev;
  if (els.nextBtn) els.nextBtn.onclick = next;

  if (els.volume && els.audio) {
    els.volume.addEventListener("input", () => {
      els.audio.volume = parseFloat(els.volume.value);
      isMuted = els.audio.volume === 0;
      if (ui.volIcon) ui.volIcon.innerHTML = isMuted ? VOL_MUTE : VOL_FULL;
    });
  }

  if (els.seek && els.audio) {
    els.seek.addEventListener("mousedown",  () => { isSeeking = true; });
    els.seek.addEventListener("touchstart", () => { isSeeking = true; }, { passive: true });
    els.seek.addEventListener("input", () => {
      if (els.audio.duration) {
        els.audio.currentTime = (els.seek.value / 100) * els.audio.duration;
        updateSeekFill(parseFloat(els.seek.value));
      }
    });
    els.seek.addEventListener("mouseup",  () => { isSeeking = false; });
    els.seek.addEventListener("touchend", () => { isSeeking = false; });

    els.audio.addEventListener("timeupdate", () => {
      if (!isSeeking && els.audio.duration) {
        const pct = (els.audio.currentTime / els.audio.duration) * 100;
        els.seek.value = pct;
        updateSeekFill(pct);
        if (els.timeCurrent) els.timeCurrent.textContent = formatTime(els.audio.currentTime);
        // Sync expanded seek
        const expSeek    = document.getElementById("expandedSeek");
        const expCurrent = document.getElementById("expandedTimeCurrent");
        if (expSeek)    expSeek.value = pct;
        if (expCurrent) expCurrent.textContent = formatTime(els.audio.currentTime);
      }
    });

    els.audio.addEventListener("loadedmetadata", () => {
      if (els.timeDuration) els.timeDuration.textContent = formatTime(els.audio.duration);
      const expDur = document.getElementById("expandedTimeDuration");
      if (expDur) expDur.textContent = formatTime(els.audio.duration);
    });

    // Auto-next on track end
    els.audio.addEventListener("ended", () => {
      if (!isRepeat) next();
    });

    // Play/pause icon sync
    els.audio.addEventListener("play",  () => { syncPlayIcons(true);  if (document.getElementById("expandedPlayer")?.classList.contains("is-open")) startWaveform(); });
    els.audio.addEventListener("pause", () => { syncPlayIcons(false); stopWaveform(); });
  }

  if (els.clearAllBtn) {
    els.clearAllBtn.onclick = async () => {
      if (!tracks.length) return;
      if (!confirm("Remove all tracks from your library?")) return;
      await clearAllTracks();
      tracks = []; filteredTracks = []; currentIndex = -1;
      favorites.clear(); saveFavorites();
      recentlyPlayed = []; saveRecent();
      if (els.audio) { els.audio.src = ""; els.audio.pause(); }
      if (els.nowTitle) els.nowTitle.textContent = "Nothing yet";
      if (els.nowSub)   els.nowSub.textContent   = "Select a song to start";
      syncPlayIcons(false);
      updateStorageQuota();
      renderPlaylist();
      showToast("Library cleared");
    };
  }

  /* ── New events ── */

  // Shuffle / Repeat
  if (ui.shuffleBtn)       ui.shuffleBtn.onclick       = toggleShuffle;
  if (ui.repeatBtn)        ui.repeatBtn.onclick        = toggleRepeat;
  if (ui.expandedShuffleBtn) ui.expandedShuffleBtn.onclick = toggleShuffle;
  if (ui.expandedRepeatBtn)  ui.expandedRepeatBtn.onclick  = toggleRepeat;

  // Mute
  if (ui.muteBtn) ui.muteBtn.onclick = toggleMute;

  // Fav buttons (player bar + expanded)
  if (ui.playerFavBtn) {
    ui.playerFavBtn.onclick = () => {
      if (currentIndex === -1) return;
      toggleFavorite(filteredTracks[currentIndex].id);
    };
  }
  if (ui.expandedFavBtn) {
    ui.expandedFavBtn.onclick = () => {
      if (currentIndex === -1) return;
      toggleFavorite(filteredTracks[currentIndex].id);
    };
  }

  // Expanded player controls
  document.getElementById("expandedPlayBtn")?.addEventListener("click", playPause);
  document.getElementById("expandedPrevBtn")?.addEventListener("click", prev);
  document.getElementById("expandedNextBtn")?.addEventListener("click", next);

  // Expanded seek
  const expSeek = document.getElementById("expandedSeek");
  if (expSeek && els.audio) {
    expSeek.addEventListener("input", () => {
      if (els.audio.duration) {
        els.audio.currentTime = (expSeek.value / 100) * els.audio.duration;
      }
    });
  }

  // Expand / minimize player
  document.getElementById("expandPlayerBtn")?.addEventListener("click",   openExpandedPlayer);
  document.getElementById("minimizePlayerBtn")?.addEventListener("click", closeExpandedPlayer);

  // Close expanded on backdrop click
  document.getElementById("expandedPlayer")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeExpandedPlayer();
  });

  // Upload modal
  const uploadTriggers = ["heroUploadBtn","emptyUploadBtn","sidebarUploadBtn","mobileUploadBtn","fab"];
  uploadTriggers.forEach(id => {
    document.getElementById(id)?.addEventListener("click", () => openModal("uploadModal"));
  });
  document.getElementById("uploadCloseBtn")?.addEventListener("click",  () => closeModal("uploadModal"));
  document.getElementById("uploadBackdrop")?.addEventListener("click",  () => closeModal("uploadModal"));

  // Dropzone
  const dropzone = document.getElementById("dropzone");
  if (dropzone && els.fileInput) {
    dropzone.addEventListener("click", () => els.fileInput.click());
    dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("dragover"); });
    dropzone.addEventListener("dragleave", ()  => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", async e => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      await addFiles(e.dataTransfer.files);
      closeModal("uploadModal");
    });
  }

  // Settings modal
  document.getElementById("settingsNavBtn")?.addEventListener("click",  () => openModal("settingsModal"));
  document.getElementById("settingsCloseBtn")?.addEventListener("click", () => closeModal("settingsModal"));
  document.getElementById("settingsBackdrop")?.addEventListener("click", () => closeModal("settingsModal"));

  // Theme toggle
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    document.body.classList.toggle("theme-dark");
    document.body.classList.toggle("theme-light");
    showToast(document.body.classList.contains("theme-light") ? "Light mode" : "Dark mode");
  });

  // Search
  if (ui.searchInput) {
    ui.searchInput.addEventListener("input", () => {
      searchQuery = ui.searchInput.value;
      const hasQuery = !!searchQuery.trim();
      if (ui.searchClear) ui.searchClear.classList.toggle("hidden", !hasQuery);
      renderPlaylist();
    });
  }
  if (ui.searchClear) {
    ui.searchClear.addEventListener("click", () => {
      searchQuery = "";
      if (ui.searchInput) ui.searchInput.value = "";
      ui.searchClear.classList.add("hidden");
      renderPlaylist();
      ui.searchInput?.focus();
    });
  }

  // Sort
  if (ui.sortSelect) {
    ui.sortSelect.addEventListener("change", () => {
      sortMode = ui.sortSelect.value;
      applySort();
      renderPlaylist();
    });
  }

  // Nav — favorites view
  document.querySelectorAll(".desktop-nav__item, .bottom-nav__item").forEach(item => {
    item.addEventListener("click", () => {
      const nav = item.dataset.nav;
      if (nav === "favorites") {
        setView("favorites");
      } else if (nav === "home" || nav === "library") {
        setView("library");
      }
    });
  });

  // Global drag-to-upload
  const dragOverlay = document.getElementById("dragOverlay");
  let dragCounter = 0;
  document.addEventListener("dragenter", e => {
    if ([...e.dataTransfer.types].includes("Files")) {
      dragCounter++;
      dragOverlay?.classList.add("show");
    }
  });
  document.addEventListener("dragleave", () => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dragOverlay?.classList.remove("show"); }
  });
  document.addEventListener("dragover", e => e.preventDefault());
  document.addEventListener("drop", async e => {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay?.classList.remove("show");
    await addFiles(e.dataTransfer.files);
  });

  // Mobile sidebar
  if (ui.mobileMenuBtn) {
    ui.mobileMenuBtn.addEventListener("click", () => {
      ui.sidebar?.classList.toggle("open");
      // create/toggle overlay
      let overlay = document.getElementById("sidebarOverlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "sidebarOverlay";
        overlay.className = "sidebar-overlay";
        document.body.appendChild(overlay);
        overlay.addEventListener("click", () => {
          ui.sidebar?.classList.remove("open");
          overlay.classList.remove("show");
        });
      }
      overlay.classList.toggle("show", ui.sidebar?.classList.contains("open"));
    });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", e => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === " " || e.code === "Space") { e.preventDefault(); playPause(); }
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    if (e.key === "ArrowLeft")  { e.preventDefault(); prev(); }
    if (e.key === "m" || e.key === "M") toggleMute();
    if (e.key === "s" || e.key === "S") toggleShuffle();
    if (e.key === "Escape") closeExpandedPlayer();
  });
}

/* ══════════════ INIT ══════════════ */

async function init() {
  wireEvents();
  db = await openDb();
  await loadTracks();
  updateFavBadge();

  if (filteredTracks.length) {
    setCurrentByIndex(0, { autoplay: false });
  }

  // Init waveform idle state
  drawWaveformIdle();
}

init();