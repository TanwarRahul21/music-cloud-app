import { toast, formatBytes, formatTime } from './utils.js';
import { initDb, loadDbTracks, saveDbTrack, deleteDbTrack, clearAllDbTracks } from './db.js';
import { processFiles } from './upload.js';
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
  audioVisualizer: document.getElementById('audioVisualizer'),
  visualizerCanvas: document.getElementById('visualizerCanvas'),
  settingsModal: document.getElementById('settingsModal'),
  settingsBackdrop: document.getElementById('settingsBackdrop'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  settingsNavBtn: document.getElementById('settingsNavBtn'),
  themeToggle: document.getElementById('themeToggle'),
  logoutBtnSettings: document.getElementById('logoutBtnSettings'),
  settingsUserEmail: document.getElementById('settingsUserEmail'),
  // Desktop elements
  dragOverlay: document.getElementById('dragOverlay'),
  heroUploadBtn: document.getElementById('heroUploadBtn'),
  nowPlayingTitle: document.getElementById('nowPlayingTitle'),
  nowPlayingArtist: document.getElementById('nowPlayingArtist'),
  nowPlayingArt: document.getElementById('nowPlayingArt'),
  playBtnDesktop: document.getElementById('playBtnDesktop'),
  prevBtnDesktop: document.getElementById('prevBtnDesktop'),
  nextBtnDesktop: document.getElementById('nextBtnDesktop'),
  desktopVisualizerCanvas: document.getElementById('desktopVisualizerCanvas'),
};

let user = null;
let tracks = [];
let filteredTracks = [];
let playlists = []; // Playlists not implemented in this redesign
let currentIndex = -1;
let isSeeking = false;
let player;
let isUploading = false;

const BUCKET = 'Songs';

async function init() {
  initTheme(); // Initialize theme from localStorage
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
    hideAuthModal();
    await refreshLibrary();
  } else {
    showAuthModal();
    tracks = [];
    filteredTracks = [];
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
    return {
      id: trackId,
      name: original || obj.name,
      size: obj.metadata?.size || obj.size || 0,
      duration: cachedTrack?.duration ?? null,
      addedAt: cachedTrack?.addedAt ?? Date.now(),
      url: pub.publicUrl,
      path,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  applySearchFilter();
  renderPlaylist();

  if (tracks.length && currentIndex === -1) {
    selectTrack(0, { autoplay: false });
  } else if (!tracks.length) {
    stopPlayback();
  }
}

function applySearchFilter() {
  // Search not implemented in this redesign
  filteredTracks = tracks;
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

  // Update desktop "Now Playing" sidebar
  if (els.nowPlayingTitle) {
    els.nowPlayingTitle.textContent = track.name;
  }
  if (els.nowPlayingArtist) {
    els.nowPlayingArtist.textContent = `${formatBytes(track.size)} • ${track.duration ? formatTime(track.duration) : '--:--'}`;
  }

  // Apply dynamic color theming based on current track
  applyDynamicColor(currentIndex);

  highlightActiveRow();

  if (autoplay) {
    player.loadAndPlay(track.url).then(updatePlayBtn);
  } else {
    els.audio.src = track.url;
  }
  updatePlayBtn();
}

function stopPlayback() {
  player.stop();
  currentIndex = -1;
  els.seek.value = "0";
  els.timeCurrent.textContent = "0:00";
  els.timeDuration.textContent = "0:00";
  els.nowTitle.textContent = "Nothing yet";
  els.nowSub.textContent = "Select a song to start";
  els.audio.removeAttribute('src');
  updatePlayBtn();
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

  // Update desktop play button
  if (els.playBtnDesktop) {
    els.playBtnDesktop.textContent = icon;
  }

  // Update audio visualizer visibility
  if (els.audioVisualizer) {
    els.audioVisualizer.classList.toggle('playing', !player.paused);
  }
}

// ─── Theme Management ─── //
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

// ─── Dynamic Color Theming ─── //
const COLOR_PALETTES = [
  { primary: '#7c73ff', secondary: '#ff7eb3' }, // Purple-Pink
  { primary: '#00d95f', secondary: '#00f5a0' }, // Green
  { primary: '#ff6b6b', secondary: '#ffd93d' }, // Red-Yellow
  { primary: '#4ecdc4', secondary: '#44a3ff' }, // Teal-Blue
  { primary: '#ff9f43', secondary: '#ee5a6f' }, // Orange-Red
  { primary: '#a29bfe', secondary: '#fd79a8' }, // Lavender-Pink
];

let currentColorIndex = 0;

function applyDynamicColor(trackIndex) {
  // Cycle through color palettes based on track index
  currentColorIndex = trackIndex % COLOR_PALETTES.length;
  const palette = COLOR_PALETTES[currentColorIndex];

  const root = document.documentElement;
  root.style.setProperty('--dynamic-accent', palette.primary);
  root.style.setProperty('--dynamic-accent-2', palette.secondary);
  root.style.setProperty('--dynamic-color-1', `${palette.primary}33`); // 20% opacity

  // Smoothly transition accent colors
  root.style.setProperty('--accent', palette.primary);
  root.style.setProperty('--accent-2', palette.secondary);
}

// ─── Settings Modal ─── //
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

    // Determine quality based on size (rough estimation)
    const qualityBadge = track.size > 10000000 ? 'Lossless' : '320kbps';
    const durText = track.duration == null ? "--:--" : formatTime(track.duration);

    row.innerHTML = `
      <div class="row__thumb">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
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
        <button class="btn" type="button" data-action="playlist">Add</button>
      </div>
    `;

    row.querySelector('.track-name').textContent = track.name;
    row.querySelector('.row__sub').textContent = `${durText} • ${formatBytes(track.size)}`;

    row.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      const action = btn?.dataset?.action;

      if (action === 'delete') {
        e.stopPropagation();
        await removeTrack(track);
        return;
      }

      if (action === 'playlist') {
        e.stopPropagation();
        toast('Playlists coming soon!');
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

async function handleUpload(files) {
  if (!user) { toast('Login to upload'); showAuthModal(); return; }
  if (!files || !files.length) return;

  // Reset upload state first
  isUploading = false;
  els.uploadFeedback?.classList.add('hidden');

  setUploadUiState(true, 'Preparing upload...', 0);

  try {
    const parsed = await processFiles(files);
    if (!parsed.length) {
      setUploadUiState(false, 'No valid audio files found', 0);
      hideUploadUiStateLater();
      toast('No valid audio files found');
      return;
    }

    let uploaded = 0;

    for (const t of parsed) {
      setUploadUiState(true, `Uploading... (${uploaded + 1}/${parsed.length})`, (uploaded / parsed.length) * 100);
      const path = `${user.id}/${t.id}__${t.storageName}`; // Use sanitized filename
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, t.blob, { cacheControl: '3600', upsert: false });
      if (upErr) {
        console.error('Upload error for file:', t.name, upErr);
        throw new Error(`Failed to upload ${t.name}: ${upErr.message}`);
      }
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const record = { id: t.id, name: t.name, size: t.size, duration: t.duration, addedAt: t.addedAt, url: pub.publicUrl, path, user_id: user.id };
      await saveDbTrack(record);
      uploaded += 1;
      setUploadUiState(true, `Uploaded ${uploaded}/${parsed.length}`, (uploaded / parsed.length) * 100);
    }

    setUploadUiState(false, `Upload complete!`, 100);
    hideUploadUiStateLater();
    toast(`Added ${uploaded} song(s)`);
    await refreshLibrary();
    setTimeout(hideUploadModal, 1200);
  } catch (err) {
    console.error('Upload error', err);
    setUploadUiState(false, 'Upload failed', 0);
    hideUploadUiStateLater();
    toast(err.message || 'Upload failed. Check console for details.');
  }
}

function wireEvents() {
  els.fileInput.addEventListener("change", () => {
    if (els.fileInput.files.length > 0) {
      handleUpload(els.fileInput.files);
      els.fileInput.value = "";
    }
  });

  // Better dropzone click handling
  els.dropzone.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isUploading) return;
    els.fileInput.click();
  });

  // Keyboard support for dropzone
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
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  });

  // Make upload button label work better
  els.uploadBtnLabel.addEventListener("click", (e) => {
    if (isUploading) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  els.playBtn.addEventListener("click", playPause);
  els.prevBtn.addEventListener("click", prevTrack);
  els.nextBtn.addEventListener("click", nextTrack);
  if (els.playBtnMobile) els.playBtnMobile.addEventListener("click", playPause);
  if (els.prevBtnMobile) els.prevBtnMobile.addEventListener("click", prevTrack);
  if (els.nextBtnMobile) els.nextBtnMobile.addEventListener("click", nextTrack);

  // Desktop controls
  if (els.playBtnDesktop) els.playBtnDesktop.addEventListener("click", playPause);
  if (els.prevBtnDesktop) els.prevBtnDesktop.addEventListener("click", prevTrack);
  if (els.nextBtnDesktop) els.nextBtnDesktop.addEventListener("click", nextTrack);
  if (els.heroUploadBtn) els.heroUploadBtn.addEventListener("click", showUploadModal);

  // Global drag and drop
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      els.dragOverlay?.classList.add('show');
    }
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      els.dragOverlay?.classList.remove('show');
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    els.dragOverlay?.classList.remove('show');

    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  });

  els.volume.addEventListener("input", () => {
    els.audio.volume = Number(els.volume.value);
  });

  els.seek.addEventListener("pointerdown", () => { isSeeking = true; });
  els.seek.addEventListener("pointerup", () => { isSeeking = false; });
  els.seek.addEventListener("input", () => {
    if (!isSeeking) return;
    const pct = els.seek.value / 100;
    if (player.duration > 0) {
      els.timeCurrent.textContent = formatTime(pct * player.duration);
    }
  });
  els.seek.addEventListener("change", () => { player.seek(els.seek.value); });

  els.audio.addEventListener("loadedmetadata", async () => {
    els.timeDuration.textContent = formatTime(player.duration);
    const track = tracks[currentIndex];
    if (track && track.duration == null && Number.isFinite(player.duration)) {
       track.duration = player.duration;
       await saveDbTrack(track);
       renderPlaylist();
    }
  });
  
  els.audio.addEventListener("timeupdate", () => {
    if (isSeeking) return;
    let pct = 0;
    if (player.duration > 0) pct = (player.currentTime / player.duration) * 100;
    els.seek.value = pct;
    els.seek.style.setProperty('--fill', `${pct}%`);
    els.timeCurrent.textContent = formatTime(player.currentTime);
  });

  els.audio.addEventListener("play", updatePlayBtn);
  els.audio.addEventListener("pause", updatePlayBtn);
  els.audio.addEventListener("ended", nextTrack);

  // Modal wiring
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
  // Reset upload state when opening modal
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

// Auth event listeners
els.loginBtn.addEventListener('click', handleLogin);
els.signupBtn.addEventListener('click', handleSignup);
els.googleLoginBtn.addEventListener('click', handleGoogleLogin);

window.addEventListener('beforeunload', () => player?.cleanup());

init();
