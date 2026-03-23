import { toast, formatBytes, formatTime } from './utils.js';
import { initDb, loadDbTracks, saveDbTrack, deleteDbTrack, clearAllDbTracks } from './db.js';
import { processFiles, sanitizeFilename } from './upload.js';
import { Player } from './player.js';
import {
  supabase,
} from './supabase.js';

const els = {
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
  uploadBtnLabel: document.getElementById("uploadBtnLabel"),
  uploadFeedback: document.getElementById("uploadFeedback"),
  uploadStatusText: document.getElementById("uploadStatusText"),
  uploadProgressFill: document.getElementById("uploadProgressFill"),
  trackList: document.getElementById("trackList"),
  libraryMeta: document.getElementById("libraryMeta"),
  audio: document.getElementById("audio"),
  playBtn: document.getElementById("playBtn"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  seek: document.getElementById("seek"),
  volume: document.getElementById("volume"),
  timeCurrent: document.getElementById("timeCurrent"),
  timeDuration: document.getElementById("timeDuration"),
  nowTitle: document.getElementById("nowTitle"),
  nowSub: document.getElementById("nowSub"),
  playerArt: document.getElementById("playerArt"),
  playerArtImg: document.getElementById("playerArtImg"),
  authModal: document.getElementById("authModal"),
  authBackdrop: document.getElementById("authBackdrop"),
  authCloseBtn: document.getElementById("authCloseBtn"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  loginBtn: document.getElementById("loginBtn"),
  signupBtn: document.getElementById("signupBtn"),
  googleLoginBtn: document.getElementById("googleLoginBtn"),
  fab: document.getElementById("fab"),
  mobileUploadBtn: document.getElementById("mobileUploadBtn"),
  uploadModal: document.getElementById("uploadModal"),
  uploadBackdrop: document.getElementById("uploadBackdrop"),
  uploadCloseBtn: document.getElementById("uploadCloseBtn"),
  appShell: document.querySelector('.app-shell'),
  bottomPlayer: document.getElementById('bottomPlayer'),
  expandPlayerBtn: document.getElementById('expandPlayerBtn'),
  expandedPlayer: document.getElementById('expandedPlayer'),
  minimizePlayerBtn: document.getElementById('minimizePlayerBtn'),
  expandedArt: document.getElementById('expandedArt'),
  expandedArtImg: document.getElementById('expandedArtImg'),
  expandedTitle: document.getElementById('expandedTitle'),
  expandedMeta: document.getElementById('expandedMeta'),
  expandedQuality: document.getElementById('expandedQuality'),
  expandedSeek: document.getElementById('expandedSeek'),
  expandedTimeCurrent: document.getElementById('expandedTimeCurrent'),
  expandedTimeDuration: document.getElementById('expandedTimeDuration'),
  expandedPlayBtn: document.getElementById('expandedPlayBtn'),
  expandedPrevBtn: document.getElementById('expandedPrevBtn'),
  expandedNextBtn: document.getElementById('expandedNextBtn'),
  expandedShuffleBtn: document.getElementById('expandedShuffleBtn'),
  expandedRepeatBtn: document.getElementById('expandedRepeatBtn'),
  audioVisualizer: document.getElementById('audioVisualizer'),
  visualizerCanvas: document.getElementById('visualizerCanvas'),
  settingsModal: document.getElementById('settingsModal'),
  settingsBackdrop: document.getElementById('settingsBackdrop'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  settingsNavBtn: document.getElementById('settingsNavBtn'),
  themeToggle: document.getElementById('themeToggle'),
  logoutBtnSettings: document.getElementById('logoutBtnSettings'),
  settingsUserEmail: document.getElementById('settingsUserEmail'),
  desktopNav: document.getElementById('desktopNav'),
  desktopNavItems: document.querySelectorAll('.desktop-nav__item'),
  bottomNavItems: document.querySelectorAll('.bottom-nav__item'),
  storageQuota: document.getElementById('storageQuota'),
  storageQuotaFill: document.getElementById('storageQuotaFill'),
  storageQuotaText: document.getElementById('storageQuotaText'),
  dragOverlay: document.getElementById('dragOverlay'),
  heroUploadBtn: document.getElementById('heroUploadBtn'),
  nowPlayingTitle: document.getElementById('nowPlayingTitle'),
  nowPlayingArtist: document.getElementById('nowPlayingArtist'),
  nowPlayingArt: document.getElementById('nowPlayingArt'),
  nowPlayingImg: document.getElementById('nowPlayingImg'),
  playBtnDesktop: document.getElementById('playBtnDesktop'),
  prevBtnDesktop: document.getElementById('prevBtnDesktop'),
  nextBtnDesktop: document.getElementById('nextBtnDesktop'),
  desktopVisualizerCanvas: document.getElementById('desktopVisualizerCanvas'),
};

let user = null;
let tracks = [];
let filteredTracks = [];
let playlists = [];
let currentIndex = -1;
let isSeeking = false;
let isExpandedSeeking = false;
let isShuffleEnabled = false;
let isRepeatEnabled = false;
let player;
let isUploading = false;

const BUCKET = 'Songs';
const STORAGE_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;
const FAVORITES_KEY_PREFIX = 'music-cloud-favorites';
const LIBRARY_KEY_PREFIX = 'music-cloud-library';

let currentView = 'all';
let favoriteTrackIds = new Set();
let libraryTrackIds = new Set();
let hasSavedLibraryCollection = false;

function getFavoritesStorageKey() {
  return `${FAVORITES_KEY_PREFIX}:${user?.id || 'guest'}`;
}

function getLibraryStorageKey() {
  return `${LIBRARY_KEY_PREFIX}:${user?.id || 'guest'}`;
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem(getFavoritesStorageKey());
    const ids = raw ? JSON.parse(raw) : [];
    favoriteTrackIds = new Set(Array.isArray(ids) ? ids : []);
  } catch {
    favoriteTrackIds = new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(getFavoritesStorageKey(), JSON.stringify([...favoriteTrackIds]));
}

function loadLibraryCollection() {
  hasSavedLibraryCollection = false;
  try {
    const raw = localStorage.getItem(getLibraryStorageKey());
    if (!raw) {
      libraryTrackIds = new Set();
      return;
    }
    const ids = JSON.parse(raw);
    libraryTrackIds = new Set(Array.isArray(ids) ? ids : []);
    hasSavedLibraryCollection = true;
  } catch {
    libraryTrackIds = new Set();
  }
}

function saveLibraryCollection() {
  localStorage.setItem(getLibraryStorageKey(), JSON.stringify([...libraryTrackIds]));
}

function isInLibrary(trackId) {
  return libraryTrackIds.has(trackId);
}

function addToLibrary(trackId) {
  if (!trackId || libraryTrackIds.has(trackId)) return false;
  libraryTrackIds.add(trackId);
  saveLibraryCollection();
  return true;
}

function syncLibraryCollectionWithTracks() {
  const currentTrackIds = new Set(tracks.map((track) => track.id));

  if (!hasSavedLibraryCollection) {
    libraryTrackIds = new Set(currentTrackIds);
    saveLibraryCollection();
    hasSavedLibraryCollection = true;
    return;
  }

  for (const id of [...libraryTrackIds]) {
    if (!currentTrackIds.has(id)) libraryTrackIds.delete(id);
  }

  for (const id of currentTrackIds) {
    if (!libraryTrackIds.has(id)) libraryTrackIds.add(id);
  }

  saveLibraryCollection();
}

function isFavorite(trackId) {
  return favoriteTrackIds.has(trackId);
}

function toggleFavorite(trackId) {
  if (!trackId) return false;
  if (favoriteTrackIds.has(trackId)) favoriteTrackIds.delete(trackId);
  else favoriteTrackIds.add(trackId);
  saveFavorites();
  return favoriteTrackIds.has(trackId);
}

function setActiveNavigation(view) {
  const navToDesktopView = { home: 'home', library: 'library', favorites: 'favorites' };
  const desktopActive = navToDesktopView[view] || 'home';
  els.desktopNavItems.forEach((item) => {
    item.classList.toggle('desktop-nav__item--active', item.dataset.nav === desktopActive);
  });
  const mobileActive = view === 'favorites' ? 'library' : (view === 'library' ? 'library' : 'home');
  els.bottomNavItems.forEach((item) => {
    item.classList.toggle('bottom-nav__item--active', item.dataset.nav === mobileActive);
  });
}

function setView(view) {
  currentView = view;
  applySearchFilter();
  renderPlaylist();
  setActiveNavigation(view);
}

function updateStorageQuotaUi() {
  if (!els.storageQuotaFill || !els.storageQuotaText) return;
  const usedBytes = tracks.reduce((sum, track) => sum + (Number(track.size) || 0), 0);
  const usedPct = Math.min(100, (usedBytes / STORAGE_LIMIT_BYTES) * 100);
  els.storageQuotaFill.style.setProperty('--progress', `${usedPct.toFixed(2)}%`);
  els.storageQuotaText.textContent = `${formatBytes(usedBytes)} of ${formatBytes(STORAGE_LIMIT_BYTES)} used`;
}

async function init() {
  initTheme();
  player = new Player(els.audio);
  wireEvents();
  await initDb();

  const { data: sessionData } = await supabase.auth.getSession();
  await handleAuthChange(sessionData?.session?.user ?? null);

  supabase.auth.onAuthStateChange(async (event, session) => {
    const sessionUser = session?.user ?? null;
    if (event === 'SIGNED_IN') {
      await handleAuthChange(sessionUser);
      hideAuthModal();
      await refreshLibrary();
      return;
    }
    if (event === 'SIGNED_OUT') {
      await handleAuthChange(null);
      stopPlayback();
      showAuthModal();
      return;
    }
    await handleAuthChange(sessionUser);
  });
}

async function handleAuthChange(u) {
  user = u;
  els.appShell.classList.toggle('is-authenticated', !!user);
  if (els.settingsUserEmail) {
    els.settingsUserEmail.textContent = user ? user.email : 'Not logged in';
  }
  if (user) {
    loadFavorites();
    loadLibraryCollection();
    hideAuthModal();
    await refreshLibrary();
  } else {
    showAuthModal();
    tracks = [];
    filteredTracks = [];
    favoriteTrackIds = new Set();
    libraryTrackIds = new Set();
    hasSavedLibraryCollection = false;
    currentView = 'all';
    updateStorageQuotaUi();
    renderPlaylist();
  }
}

async function refreshLibrary() {
  if (!user) {
    tracks = [];
    filteredTracks = [];
    renderPlaylist();
    return;
  }

  const cached = await loadDbTracks();
  const cacheMap = new Map(cached.map((t) => [t.id, t]));

  const { data, error } = await supabase.storage.from(BUCKET).list(user.id, { limit: 1000 });
  if (error) {
    console.error('Storage list error', error);
    toast('Could not load your songs');
    return;
  }

  tracks = (data || []).map((obj) => {
    const [trackId, original] = obj.name.split('__');
    const path = `${user.id}/${obj.name}`;
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const cachedTrack = cacheMap.get(trackId);
    const artwork =
      cachedTrack?.artwork_url || cachedTrack?.artworkUrl ||
      cachedTrack?.thumbnail_url || cachedTrack?.thumbnailUrl ||
      cachedTrack?.cover_url || cachedTrack?.coverUrl || null;

    return {
      id: trackId,
      name: original || obj.name,
      size: obj.metadata?.size || obj.size || 0,
      duration: cachedTrack?.duration ?? null,
      addedAt: cachedTrack?.addedAt ?? Date.now(),
      url: pub.publicUrl,
      artwork,
      path,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  syncLibraryCollectionWithTracks();
  updateStorageQuotaUi();
  applySearchFilter();
  renderPlaylist();

  if (tracks.length && currentIndex === -1) {
    selectTrack(0, { autoplay: false });
  } else if (!tracks.length) {
    stopPlayback();
  }
}

function applySearchFilter() {
  if (currentView === 'library') {
    filteredTracks = tracks.filter((track) => isInLibrary(track.id));
    return;
  }
  if (currentView === 'favorites') {
    filteredTracks = tracks.filter((track) => isFavorite(track.id));
    return;
  }
  filteredTracks = tracks;
}

function resolveArtworkUrl(track) {
  const candidates = [
    track?.artwork, track?.artwork_url, track?.artworkUrl,
    track?.thumbnail, track?.thumbnail_url, track?.thumbnailUrl,
    track?.cover, track?.cover_url, track?.coverUrl,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim()) || null;
}

function setArtwork(containerEl, imgEl, src, altText) {
  if (!containerEl || !imgEl) return;
  const hasArtwork = typeof src === 'string' && src.trim().length > 0;
  containerEl.classList.toggle('has-image', hasArtwork);
  if (hasArtwork) {
    imgEl.src = src;
    imgEl.alt = altText;
    imgEl.classList.remove('hidden');
    return;
  }
  imgEl.removeAttribute('src');
  imgEl.classList.add('hidden');
}

function getCurrentTrack() {
  if (currentIndex < 0 || currentIndex >= tracks.length) return null;
  return tracks[currentIndex] || null;
}

function getTrackQualityLabel(track) {
  return (Number(track?.size) || 0) > 10000000 ? 'Lossless' : '320kbps';
}

function syncExpandedPlaybackProgress() {
  if (!els.expandedSeek || !els.expandedTimeCurrent || !els.expandedTimeDuration) return;
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  if (!isExpandedSeeking) {
    els.expandedSeek.value = pct;
    els.expandedSeek.style.setProperty('--fill', `${pct}%`);
  }
  els.expandedTimeCurrent.textContent = formatTime(currentTime);
  els.expandedTimeDuration.textContent = formatTime(duration);
}

function syncExpandedPlayerData() {
  if (!els.expandedPlayer) return;
  const track = getCurrentTrack();
  if (!track) {
    if (els.expandedTitle) els.expandedTitle.textContent = 'Nothing yet';
    if (els.expandedMeta) els.expandedMeta.textContent = 'Select a song to start';
    if (els.expandedQuality) els.expandedQuality.textContent = '320kbps';
    setArtwork(els.expandedArt, els.expandedArtImg, null, 'Expanded player cover art');
    if (els.expandedSeek) {
      els.expandedSeek.value = '0';
      els.expandedSeek.style.setProperty('--fill', '0%');
    }
    if (els.expandedTimeCurrent) els.expandedTimeCurrent.textContent = '0:00';
    if (els.expandedTimeDuration) els.expandedTimeDuration.textContent = '0:00';
    return;
  }
  if (els.expandedTitle) els.expandedTitle.textContent = track.name;
  if (els.expandedMeta) {
    els.expandedMeta.textContent = `${track.duration ? formatTime(track.duration) : '--:--'} • ${formatBytes(track.size)}`;
  }
  if (els.expandedQuality) els.expandedQuality.textContent = getTrackQualityLabel(track);
  setArtwork(els.expandedArt, els.expandedArtImg, resolveArtworkUrl(track), `${track.name} cover art`);
  syncExpandedPlaybackProgress();
}

function openExpandedPlayer() {
  if (!els.expandedPlayer) return;
  syncExpandedPlayerData();
  els.expandedPlayer.classList.add('is-open');
  els.expandedPlayer.removeAttribute('inert');
  els.expandedPlayer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('expanded-player-open');
}

function closeExpandedPlayer() {
  if (!els.expandedPlayer) return;
  els.expandedPlayer.classList.remove('is-open');
  els.expandedPlayer.setAttribute('aria-hidden', 'true');
  els.expandedPlayer.setAttribute('inert', '');
  document.body.classList.remove('expanded-player-open');
}

function selectTrack(index, { autoplay }) {
  if (index < 0 || index >= filteredTracks.length) return;
  const track = filteredTracks[index];
  currentIndex = tracks.findIndex((t) => t.id === track.id);

  els.seek.value = "0";
  els.timeCurrent.textContent = "0:00";
  els.timeDuration.textContent = track.duration == null ? "0:00" : formatTime(track.duration);
  els.nowTitle.textContent = track.name;
  els.nowSub.textContent = `${track.duration ? formatTime(track.duration) : '--:--'} • ${formatBytes(track.size)}`;

  if (els.nowPlayingTitle) els.nowPlayingTitle.textContent = track.name;
  if (els.nowPlayingArtist) {
    els.nowPlayingArtist.textContent = `${formatBytes(track.size)} • ${track.duration ? formatTime(track.duration) : '--:--'}`;
  }

  const artworkUrl = resolveArtworkUrl(track);
  setArtwork(els.playerArt, els.playerArtImg, artworkUrl, `${track.name} cover art`);
  setArtwork(els.nowPlayingArt, els.nowPlayingImg, artworkUrl, `${track.name} cover art`);
  setArtwork(els.expandedArt, els.expandedArtImg, artworkUrl, `${track.name} cover art`);

  if (els.expandedTitle) els.expandedTitle.textContent = track.name;
  if (els.expandedMeta) {
    els.expandedMeta.textContent = `${track.duration ? formatTime(track.duration) : '--:--'} • ${formatBytes(track.size)}`;
  }
  if (els.expandedQuality) els.expandedQuality.textContent = getTrackQualityLabel(track);

  applyDynamicColor(currentIndex);
  highlightActiveRow();

  if (autoplay) {
    player.loadAndPlay(track.url).then(updatePlayBtn);
  } else {
    els.audio.src = track.url;
  }
  updatePlayBtn();
  syncExpandedPlaybackProgress();
}

function stopPlayback() {
  player.stop();
  currentIndex = -1;
  els.seek.value = "0";
  els.timeCurrent.textContent = "0:00";
  els.timeDuration.textContent = "0:00";
  els.nowTitle.textContent = "Nothing yet";
  els.nowSub.textContent = "Select a song to start";
  if (els.nowPlayingTitle) els.nowPlayingTitle.textContent = 'Nothing Playing';
  if (els.nowPlayingArtist) els.nowPlayingArtist.textContent = 'Select a song';
  setArtwork(els.playerArt, els.playerArtImg, null, 'Current track cover art');
  setArtwork(els.nowPlayingArt, els.nowPlayingImg, null, 'Now playing cover art');
  setArtwork(els.expandedArt, els.expandedArtImg, null, 'Expanded player cover art');
  els.audio.removeAttribute('src');
  updatePlayBtn();
  syncExpandedPlayerData();
  highlightActiveRow();
}

function playPause() {
  if (currentIndex === -1 && filteredTracks.length > 0) {
    selectTrack(0, { autoplay: true });
    return;
  }
  player.toggle().then(updatePlayBtn).catch(() => updatePlayBtn());
}

function nextTrack() {
  if (!filteredTracks.length) return;
  if (isShuffleEnabled && filteredTracks.length > 1) {
    const currentTrackId = tracks[currentIndex]?.id;
    const candidates = filteredTracks.filter((track) => track.id !== currentTrackId);
    const randomTrack = candidates[Math.floor(Math.random() * candidates.length)];
    const randomIndex = filteredTracks.findIndex((track) => track.id === randomTrack?.id);
    if (randomIndex >= 0) { selectTrack(randomIndex, { autoplay: true }); return; }
  }
  const currentFilteredIndex = filteredTracks.findIndex(t => t.id === tracks[currentIndex]?.id);
  const idx = currentFilteredIndex >= filteredTracks.length - 1 ? 0 : currentFilteredIndex + 1;
  selectTrack(idx, { autoplay: true });
}

function prevTrack() {
  if (!filteredTracks.length) return;
  const currentFilteredIndex = filteredTracks.findIndex(t => t.id === tracks[currentIndex]?.id);
  const idx = currentFilteredIndex <= 0 ? filteredTracks.length - 1 : currentFilteredIndex - 1;
  selectTrack(idx, { autoplay: true });
}

function updatePlayBtn() {
  const icon = player.paused ? "▶" : "⏸";
  els.playBtn.textContent = icon;
  if (els.playBtnDesktop) els.playBtnDesktop.textContent = icon;
  if (els.expandedPlayBtn) els.expandedPlayBtn.textContent = icon;
  if (els.audioVisualizer) els.audioVisualizer.classList.toggle('playing', !player.paused);
}

function initTheme() {
  const savedTheme = localStorage.getItem('music-cloud-theme') || 'dark';
  document.body.className = `theme-${savedTheme}`;
  updateThemeColors(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.body.classList.contains('theme-light') ? 'light' : 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.body.className = `theme-${newTheme}`;
  localStorage.setItem('music-cloud-theme', newTheme);
  updateThemeColors(newTheme);
  toast(`Switched to ${newTheme} mode`);
}

function updateThemeColors(theme) {
  const root = document.documentElement;
  if (theme === 'light') {
    root.style.setProperty('--bg', '#f8f8fc');
    root.style.setProperty('--panel', '#ffffff');
    root.style.setProperty('--surface', '#ffffff');
    root.style.setProperty('--surface-2', '#f0f0f5');
    root.style.setProperty('--hover', '#e8e8f0');
    root.style.setProperty('--text', '#1a1a2e');
    root.style.setProperty('--text-sec', '#5a5a7a');
    root.style.setProperty('--line', 'rgba(0, 0, 0, 0.08)');
    root.style.setProperty('--shadow-sm', '0 2px 12px rgba(0, 0, 0, 0.08)');
    root.style.setProperty('--shadow', '0 8px 32px rgba(0, 0, 0, 0.12)');
    root.style.setProperty('--shadow-lg', '0 16px 48px rgba(0, 0, 0, 0.15)');
  } else {
    root.style.setProperty('--bg', '#0b0b0f');
    root.style.setProperty('--panel', '#121218');
    root.style.setProperty('--surface', '#181820');
    root.style.setProperty('--surface-2', '#202028');
    root.style.setProperty('--hover', '#26262f');
    root.style.setProperty('--text', '#fafaff');
    root.style.setProperty('--text-sec', '#9494b8');
    root.style.setProperty('--line', 'rgba(255, 255, 255, 0.06)');
    root.style.setProperty('--shadow-sm', '0 2px 12px rgba(0, 0, 0, 0.3)');
    root.style.setProperty('--shadow', '0 8px 32px rgba(0, 0, 0, 0.5)');
    root.style.setProperty('--shadow-lg', '0 16px 48px rgba(0, 0, 0, 0.6)');
  }
}

const COLOR_PALETTES = [
  { primary: '#7c73ff', secondary: '#ff7eb3' },
  { primary: '#00d95f', secondary: '#00f5a0' },
  { primary: '#ff6b6b', secondary: '#ffd93d' },
  { primary: '#4ecdc4', secondary: '#44a3ff' },
  { primary: '#ff9f43', secondary: '#ee5a6f' },
  { primary: '#a29bfe', secondary: '#fd79a8' },
];

let currentColorIndex = 0;

function applyDynamicColor(trackIndex) {
  currentColorIndex = trackIndex % COLOR_PALETTES.length;
  const palette = COLOR_PALETTES[currentColorIndex];
  const root = document.documentElement;
  root.style.setProperty('--dynamic-accent', palette.primary);
  root.style.setProperty('--dynamic-accent-2', palette.secondary);
  root.style.setProperty('--dynamic-color-1', `${palette.primary}33`);
  root.style.setProperty('--accent', palette.primary);
  root.style.setProperty('--accent-2', palette.secondary);
}

function showSettingsModal() {
  els.settingsModal.removeAttribute('inert');
  els.settingsModal.classList.add('show');
}

function hideSettingsModal() {
  els.settingsModal.classList.remove('show');
  setTimeout(() => els.settingsModal.setAttribute('inert', ''), 300);
}

function highlightActiveRow() {
  const activeId = currentIndex >= 0 ? tracks[currentIndex]?.id : null;
  for (const row of els.trackList.querySelectorAll(".row")) {
    row.classList.toggle("row--active", row.dataset.id === activeId);
  }
}

function renderPlaylist() {
  els.libraryMeta.textContent = `${filteredTracks.length} song${filteredTracks.length === 1 ? "" : "s"}`;
  els.trackList.innerHTML = "";

  if (!filteredTracks.length) {
    els.trackList.innerHTML = `
      <div class="row">
        <div class="row__thumb"></div>
        <div class="row__main">
          <div class="row__title">No songs yet</div>
          <div class="row__sub">Upload some audio to build your library</div>
        </div>
      </div>
    `;
    return;
  }

  filteredTracks.forEach((track, idx) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = track.id;

    const qualityBadge = track.size > 10000000 ? 'Lossless' : '320kbps';
    const durText = track.duration == null ? "--:--" : formatTime(track.duration);

    row.innerHTML = `
      <div class="row__thumb">
        <img class="row__thumb-img hidden" alt="${track.name} cover art" loading="lazy">
        <svg class="row__thumb-fallback" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
      </div>
      <div class="row__main">
        <div class="row__title">
          <span class="track-name"></span>
          <div class="quality-badge">${qualityBadge}</div>
        </div>
        <div class="row__sub"></div>
      </div>
      <div class="row__actions">
        <button class="btn btn--danger" type="button" data-action="delete">Delete</button>
        <button class="btn" type="button" data-action="like">${isFavorite(track.id) ? 'Liked' : 'Like'}</button>
        <button class="btn" type="button" data-action="library">${isInLibrary(track.id) ? 'In Library' : 'Add to Library'}</button>
      </div>
    `;

    row.querySelector('.track-name').textContent = track.name;
    row.querySelector('.row__sub').textContent = `${durText} • ${formatBytes(track.size)}`;

    const rowThumb = row.querySelector('.row__thumb');
    const rowThumbImg = row.querySelector('.row__thumb-img');
    setArtwork(rowThumb, rowThumbImg, resolveArtworkUrl(track), `${track.name} cover art`);

    rowThumbImg.addEventListener('error', () => {
      setArtwork(rowThumb, rowThumbImg, null, `${track.name} cover art`);
    });

    row.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      const action = btn?.dataset?.action;

      if (action === 'delete') {
        e.stopPropagation();
        await removeTrack(track);
        return;
      }
      if (action === 'like') {
        e.stopPropagation();
        const nowFavorite = toggleFavorite(track.id);
        row.querySelector('[data-action="like"]').textContent = nowFavorite ? 'Liked' : 'Like';
        toast(nowFavorite ? 'Added to favorites' : 'Removed from favorites');
        if (currentView === 'favorites' && !nowFavorite) {
          applySearchFilter();
          renderPlaylist();
        }
        return;
      }
      if (action === 'library') {
        e.stopPropagation();
        const added = addToLibrary(track.id);
        if (added) {
          row.querySelector('[data-action="library"]').textContent = 'In Library';
          toast('Added to Library');
        } else {
          toast('Already in Library');
        }
        return;
      }

      selectTrack(idx, { autoplay: true });
    });

    els.trackList.appendChild(row);
  });

  highlightActiveRow();
}

async function removeTrack(track) {
  if (!user) { toast('Login required'); return; }
  if (!confirm(`Are you sure you want to delete "${track.name}"?`)) return;

  const { error } = await supabase.storage.from(BUCKET).remove([track.path]);
  if (error) {
    console.error('Delete failed', error);
    toast('Delete failed');
    return;
  }
  await deleteDbTrack(track.id);
  if (track?.id) {
    favoriteTrackIds.delete(track.id);
    libraryTrackIds.delete(track.id);
    saveFavorites();
    saveLibraryCollection();
  }
  toast(`"${track.name}" was deleted.`);
  await refreshLibrary();
}

function setUploadUiState(active, message = '', progress = 0) {
  isUploading = active;
  els.fileInput.disabled = active;
  els.dropzone.classList.toggle('dropzone--disabled', active);
  els.uploadBtnLabel?.classList.toggle('btn--disabled', active);
  els.uploadBtnLabel?.setAttribute('aria-disabled', active ? 'true' : 'false');

  if (active) {
    els.uploadFeedback?.classList.remove('hidden');
    if (els.uploadStatusText) els.uploadStatusText.textContent = message;
    if (els.uploadProgressFill) els.uploadProgressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    return;
  }

  if (els.uploadStatusText && message) els.uploadStatusText.textContent = message;
  if (els.uploadProgressFill) els.uploadProgressFill.style.width = '100%';
}

function hideUploadUiStateLater() {
  window.setTimeout(() => {
    if (isUploading) return;
    els.uploadFeedback?.classList.add('hidden');
    if (els.uploadProgressFill) els.uploadProgressFill.style.width = '0%';
  }, 2000);
}

// ─── PATCHED: handleUpload ────────────────────────────────────────
// BEFORE: serial for loop — waited for each upload to finish
//         before starting the next one
//
// AFTER:  uploadPool(3) — uploads 3 files at the same time.
//         When one finishes, the next starts immediately.
//         10 files now take ~⅓ of the original time.
// ─────────────────────────────────────────────────────────────────
async function handleUpload(files) {
  if (!user) { toast('Login to upload'); showAuthModal(); return; }
  if (!files || !files.length) return;

  isUploading = false;
  els.uploadFeedback?.classList.add('hidden');
  setUploadUiState(true, 'Preparing upload...', 0);

  try {
    // processFiles now reads all durations in parallel too (see upload.js)
    const parsed = await processFiles(files);

    if (!parsed.length) {
      setUploadUiState(false, 'No valid audio files found', 0);
      hideUploadUiStateLater();
      toast('No valid audio files found');
      return;
    }

    const total = parsed.length;
    let completed = 0;
    let failed = 0;

    function onFileDone(succeeded) {
      completed++;
      if (!succeeded) failed++;
      const pct = Math.round((completed / total) * 100);
      setUploadUiState(
        true,
        `Uploaded ${completed - failed}/${total}${failed ? ` · ${failed} failed` : ''}`,
        pct
      );
    }

    // Upload 3 files at a time instead of 1 at a time
    await uploadPool(parsed, 3, async (t) => {
      try {
        await uploadOneFile(t);
        onFileDone(true);
      } catch (err) {
        console.error(`Failed to upload "${t.name}":`, err.message);
        toast(`Failed: ${t.name}`);
        onFileDone(false);
      }
    });

    const uploaded = completed - failed;
    setUploadUiState(false, `Upload complete! ${uploaded} song${uploaded !== 1 ? 's' : ''} added`, 100);
    hideUploadUiStateLater();
    toast(`Added ${uploaded} song${uploaded !== 1 ? 's' : ''}`);
    await refreshLibrary();
    setTimeout(hideUploadModal, 1200);

  } catch (err) {
    console.error('Upload error', err);
    setUploadUiState(false, 'Upload failed', 0);
    hideUploadUiStateLater();
    toast(err.message || 'Upload failed. Check console for details.');
  }
}

// ─── NEW: uploadPool ──────────────────────────────────────────────
// Runs at most `limit` tasks at the same time.
// Think of it as a queue with `limit` workers pulling from it.
// ─────────────────────────────────────────────────────────────────
async function uploadPool(items, limit, task) {
  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) await task(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
}

// ─── NEW: uploadOneFile ───────────────────────────────────────────
// Uploads one track to Supabase Storage then saves to DB.
// Same logic as the old for-loop body, just extracted so it
// can run concurrently inside uploadPool.
// ─────────────────────────────────────────────────────────────────
async function uploadOneFile(t) {
  if (!user?.id) throw new Error('Not logged in');
  if (!t?.blob) throw new Error(`Missing file data for ${t?.name || 'file'}`);

  const storageName = t.storageName || sanitizeFilename(t.name || 'file');
  const path = `${user.id}/${t.id}__${storageName}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, t.blob, { cacheControl: '3600', upsert: false });

  if (upErr) throw new Error(`Failed to upload ${t.name}: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

  await saveDbTrack({
    id:       t.id,
    name:     t.name,
    type:     t.type,
    size:     t.size,
    duration: t.duration,
    addedAt:  t.addedAt,
    url:      pub.publicUrl,
    path,
    user_id:  user.id,
  });
}

function wireEvents() {
  els.fileInput.addEventListener("change", () => {
    if (els.fileInput.files.length > 0) {
      handleUpload(els.fileInput.files);
      els.fileInput.value = "";
    }
  });

  els.dropzone.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isUploading) return;
    els.fileInput.click();
  });

  els.dropzone.addEventListener("keydown", (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isUploading) els.fileInput.click();
    }
  });

  els.dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploading) els.dropzone.classList.add("dragover");
  });

  els.dropzone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.dropzone.classList.remove("dragover");
  });

  els.dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.dropzone.classList.remove("dragover");
    if (isUploading) return;
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  });

  els.uploadBtnLabel.addEventListener("click", (e) => {
    if (isUploading) { e.preventDefault(); e.stopPropagation(); }
  });

  els.playBtn.addEventListener("click", playPause);
  els.prevBtn.addEventListener("click", prevTrack);
  els.nextBtn.addEventListener("click", nextTrack);

  els.expandPlayerBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    openExpandedPlayer();
  });

  els.bottomPlayer?.addEventListener('click', (event) => {
    const interactiveTarget = event.target.closest('button, input, .range, .vol, .row__actions');
    if (interactiveTarget) return;
    openExpandedPlayer();
  });

  els.minimizePlayerBtn?.addEventListener('click', closeExpandedPlayer);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.expandedPlayer?.classList.contains('is-open')) {
      closeExpandedPlayer();
    }
  });

  if (els.playBtnMobile) els.playBtnMobile.addEventListener("click", playPause);
  if (els.prevBtnMobile) els.prevBtnMobile.addEventListener("click", prevTrack);
  if (els.nextBtnMobile) els.nextBtnMobile.addEventListener("click", nextTrack);
  if (els.playBtnDesktop) els.playBtnDesktop.addEventListener("click", playPause);
  if (els.prevBtnDesktop) els.prevBtnDesktop.addEventListener("click", prevTrack);
  if (els.nextBtnDesktop) els.nextBtnDesktop.addEventListener("click", nextTrack);

  els.expandedPlayBtn?.addEventListener('click', playPause);
  els.expandedPrevBtn?.addEventListener('click', prevTrack);
  els.expandedNextBtn?.addEventListener('click', nextTrack);

  els.expandedShuffleBtn?.addEventListener('click', () => {
    isShuffleEnabled = !isShuffleEnabled;
    els.expandedShuffleBtn.classList.toggle('is-active', isShuffleEnabled);
  });

  els.expandedRepeatBtn?.addEventListener('click', () => {
    isRepeatEnabled = !isRepeatEnabled;
    els.expandedRepeatBtn.classList.toggle('is-active', isRepeatEnabled);
  });

  if (els.heroUploadBtn) els.heroUploadBtn.addEventListener("click", showUploadModal);

  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) els.dragOverlay?.classList.add('show');
  });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) els.dragOverlay?.classList.remove('show');
  });
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    els.dragOverlay?.classList.remove('show');
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  });

  els.volume.addEventListener("input", () => {
    els.audio.volume = Number(els.volume.value);
  });

  els.playerArtImg?.addEventListener('error', () => {
    setArtwork(els.playerArt, els.playerArtImg, null, 'Current track cover art');
  });
  els.nowPlayingImg?.addEventListener('error', () => {
    setArtwork(els.nowPlayingArt, els.nowPlayingImg, null, 'Now playing cover art');
  });
  els.expandedArtImg?.addEventListener('error', () => {
    setArtwork(els.expandedArt, els.expandedArtImg, null, 'Expanded player cover art');
  });

  els.seek.addEventListener("pointerdown", () => { isSeeking = true; });
  els.seek.addEventListener("pointerup", () => { isSeeking = false; });
  els.seek.addEventListener("input", () => {
    if (!isSeeking) return;
    const pct = els.seek.value / 100;
    if (player.duration > 0) els.timeCurrent.textContent = formatTime(pct * player.duration);
  });
  els.seek.addEventListener("change", () => { player.seek(els.seek.value); });

  els.expandedSeek?.addEventListener('pointerdown', () => { isExpandedSeeking = true; });
  els.expandedSeek?.addEventListener('pointerup', () => { isExpandedSeeking = false; });
  els.expandedSeek?.addEventListener('input', () => {
    if (!isExpandedSeeking) return;
    const pct = Number(els.expandedSeek.value) / 100;
    if (player.duration > 0) {
      els.expandedTimeCurrent.textContent = formatTime(pct * player.duration);
      els.expandedSeek.style.setProperty('--fill', `${pct * 100}%`);
    }
  });
  els.expandedSeek?.addEventListener('change', () => {
    player.seek(Number(els.expandedSeek.value));
    isExpandedSeeking = false;
  });

  els.audio.addEventListener("loadedmetadata", async () => {
    els.timeDuration.textContent = formatTime(player.duration);
    if (els.expandedTimeDuration) els.expandedTimeDuration.textContent = formatTime(player.duration);
    const track = tracks[currentIndex];
    if (track && track.duration == null && Number.isFinite(player.duration)) {
      track.duration = player.duration;
      await saveDbTrack(track);
      renderPlaylist();
    }
    syncExpandedPlayerData();
  });

  els.audio.addEventListener("timeupdate", () => {
    if (isSeeking) return;
    let pct = 0;
    if (player.duration > 0) pct = (player.currentTime / player.duration) * 100;
    els.seek.value = pct;
    els.seek.style.setProperty('--fill', `${pct}%`);
    els.timeCurrent.textContent = formatTime(player.currentTime);
    syncExpandedPlaybackProgress();
  });

  els.audio.addEventListener("play", updatePlayBtn);
  els.audio.addEventListener("pause", updatePlayBtn);
  els.audio.addEventListener('ended', () => {
    if (isRepeatEnabled && currentIndex >= 0) {
      els.audio.currentTime = 0;
      els.audio.play().catch(() => updatePlayBtn());
      return;
    }
    nextTrack();
  });

  els.authCloseBtn.addEventListener('click', hideAuthModal);
  els.authBackdrop.addEventListener('click', hideAuthModal);
  els.fab.addEventListener('click', showUploadModal);
  els.mobileUploadBtn.addEventListener('click', showUploadModal);
  els.uploadCloseBtn.addEventListener('click', hideUploadModal);
  els.uploadBackdrop.addEventListener('click', hideUploadModal);
  els.settingsNavBtn.addEventListener('click', showSettingsModal);
  els.settingsCloseBtn.addEventListener('click', hideSettingsModal);
  els.settingsBackdrop.addEventListener('click', hideSettingsModal);
  els.themeToggle.addEventListener('click', toggleTheme);
  els.logoutBtnSettings.addEventListener('click', handleLogout);

  els.desktopNav?.addEventListener('click', (event) => {
    const item = event.target.closest('.desktop-nav__item');
    if (!item) return;
    event.preventDefault();
    const nav = item.dataset.nav;
    if (nav === 'upload') { showUploadModal(); return; }
    if (nav === 'favorites') { setView('favorites'); return; }
    setView(nav === 'library' ? 'library' : 'home');
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  });

  els.bottomNavItems.forEach((item) => {
    item.addEventListener('click', () => {
      const nav = item.dataset.nav;
      if (nav === 'home') {
        setView('home');
        document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (nav === 'library') setView('library');
    });
  });

  const openStorageSummary = () => {
    const usedBytes = tracks.reduce((sum, track) => sum + (Number(track.size) || 0), 0);
    const freeBytes = Math.max(0, STORAGE_LIMIT_BYTES - usedBytes);
    toast(`Storage: ${formatBytes(usedBytes)} used, ${formatBytes(freeBytes)} free`);
  };
  els.storageQuota?.addEventListener('click', openStorageSummary);
  els.storageQuota?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openStorageSummary();
  });
}

function showAuthModal() {
  els.authModal.removeAttribute('inert');
  els.authModal.classList.add('show');
  setTimeout(() => els.authEmail.focus(), 300);
}
function hideAuthModal() {
  els.authModal.classList.remove('show');
  setTimeout(() => els.authModal.setAttribute('inert', ''), 300);
}
function showUploadModal() {
  isUploading = false;
  els.uploadFeedback?.classList.add('hidden');
  if (els.uploadProgressFill) els.uploadProgressFill.style.width = '0%';
  els.fileInput.disabled = false;
  els.dropzone.classList.remove('dropzone--disabled');
  els.uploadBtnLabel?.classList.remove('btn--disabled');
  els.uploadBtnLabel?.setAttribute('aria-disabled', 'false');
  els.uploadModal.removeAttribute('inert');
  els.uploadModal.classList.add('show');
  setTimeout(() => els.dropzone.focus(), 300);
}
function hideUploadModal() {
  els.uploadModal.classList.remove('show');
  setTimeout(() => els.uploadModal.setAttribute('inert', ''), 300);
}

function setAuthButtonsLoading(isLoading) {
  els.loginBtn.disabled = isLoading;
  els.signupBtn.disabled = isLoading;
  els.googleLoginBtn.disabled = isLoading;
}

async function handleLogin(event) {
  event.preventDefault();
  const email = (els.authEmail.value || '').trim();
  const password = els.authPassword.value || '';
  if (!email || !password) return toast('Email and password are required.');
  setAuthButtonsLoading(true);
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return toast(error.message);
    hideAuthModal();
  } finally {
    setAuthButtonsLoading(false);
  }
}

async function handleSignup(event) {
  event.preventDefault();
  const email = (els.authEmail.value || '').trim();
  const password = els.authPassword.value || '';
  if (!email || !password) return toast('Email and password are required.');
  setAuthButtonsLoading(true);
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return toast(error.message);
    if (data?.session) {
      toast('Signup successful! You are now logged in.');
      hideAuthModal();
    } else {
      toast('Signup successful! Check your email to confirm.');
    }
  } finally {
    setAuthButtonsLoading(false);
  }
}

async function handleLogout(event) {
  event.preventDefault();
  const { error } = await supabase.auth.signOut();
  if (error) toast(error.message);
  hideSettingsModal();
}

async function handleGoogleLogin(event) {
  event.preventDefault();
  setAuthButtonsLoading(true);
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) toast(error.message);
  } finally {
    setAuthButtonsLoading(false);
  }
}

els.loginBtn.addEventListener('click', handleLogin);
els.signupBtn.addEventListener('click', handleSignup);
els.googleLoginBtn.addEventListener('click', handleGoogleLogin);

window.addEventListener('beforeunload', () => player?.cleanup());

init();