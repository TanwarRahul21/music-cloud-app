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
  clearAllBtn: document.getElementById("clearAllBtn"),
  searchInput: document.getElementById("searchInput"),
  userEmail: document.getElementById("userEmail"),
  logoutBtn: document.getElementById("logoutBtn"),
  authModal: document.getElementById("authModal"),
  authBackdrop: document.getElementById("authBackdrop"),
  authCloseBtn: document.getElementById("authCloseBtn"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  loginBtn: document.getElementById("loginBtn"),
  signupBtn: document.getElementById("signupBtn"),
  googleLoginBtn: document.getElementById("googleLoginBtn"),
  phoneInput: document.getElementById("phoneInput"),
  sendOtpBtn: document.getElementById("sendOtpBtn"),
  otpInput: document.getElementById("otpInput"),
  verifyOtpBtn: document.getElementById("verifyOtpBtn"),
  playlistNameInput: document.getElementById("playlistNameInput"),
  playlistCreateBtn: document.getElementById("playlistCreateBtn"),
  playlistList: document.getElementById("playlistList"),
  libraryPanel: document.querySelector('.library-panel'),
  playerPanel: document.querySelector('.player-panel'),
};

let user = null;
let tracks = [];
let filteredTracks = [];
let playlists = loadPlaylists();
let currentIndex = -1;
let isSeeking = false;
let player;
let isUploading = false;

const BUCKET = 'Songs';

function loadPlaylists() {
  try {
    const raw = localStorage.getItem('mc-playlists-v1');
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function savePlaylists() {
  localStorage.setItem('mc-playlists-v1', JSON.stringify(playlists));
}

async function init() {
  player = new Player(els.audio);
  wireEvents();
  await initDb();

  const { data: sessionData } = await supabase.auth.getSession();
  await handleAuthChange(sessionData?.session?.user ?? null);

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN') {
      await handleAuthChange(session?.user ?? null);
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

    await handleAuthChange(session?.user ?? null);
  });
}

async function handleAuthChange(u) {
  user = u;
  els.userEmail.textContent = user ? user.email : 'Guest';
  toggleAuthButtons();
  toggleAppPanels();
  await refreshLibrary();
}

function toggleAuthButtons() {
  const isAuthed = !!user;
  els.logoutBtn.style.display = isAuthed ? 'inline-flex' : 'none';
}

function toggleAppPanels() {
  const isAuthed = !!user;
  els.libraryPanel?.classList.toggle('hidden', !isAuthed);
  els.playerPanel?.classList.toggle('hidden', !isAuthed);

  if (isAuthed) {
    hideAuthModal();
  } else {
    showAuthModal();
  }
}

async function refreshLibrary() {
  if (!user) {
    tracks = [];
    filteredTracks = [];
    renderPlaylist();
    return;
  }

  // Load cached durations
  const cached = await loadDbTracks();
  const cacheMap = new Map(cached.map((t) => [t.id, t]));

  // List files from Supabase Storage
  const { data, error } = await supabase.storage.from(BUCKET).list(user.id, { limit: 100 });
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
  }).sort((a,b)=>a.name.localeCompare(b.name));

  applySearchFilter();
  renderPlaylist();
  renderPlaylists();

  if (tracks.length && currentIndex === -1) selectTrack(0, { autoplay: false });
}

function applySearchFilter() {
  const q = (els.searchInput?.value || '').trim().toLowerCase();
  if (!q) {
    filteredTracks = tracks;
  } else {
    filteredTracks = tracks.filter(t => t.name.toLowerCase().includes(q));
  }
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
  els.nowSub.textContent = "Add a song to start";
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
  els.playBtn.textContent = player.paused ? "▶" : "⏸";
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
        <div class="row__main">
          <div class="row__title">No songs yet</div>
          <div class="row__sub">Upload some audio to build your playlist</div>
        </div>
      </div>
    `;
    return;
  }

  filteredTracks.forEach((track, idx) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = track.id;

    const durText = track.duration == null ? "--:--" : formatTime(track.duration);
    row.innerHTML = `
      <div class="row__main">
        <div class="row__title"></div>
        <div class="row__sub"></div>
      </div>
      <div class="row__actions">
        <button class="btn" type="button" data-action="play">Play</button>
        <button class="btn btn--danger" type="button" data-action="delete">Delete</button>
        <button class="btn btn--ghost playlist-add" type="button">Add to playlist</button>
      </div>
    `;
    row.querySelector('.row__title').textContent = track.name;
    row.querySelector('.row__sub').textContent = `${durText} • ${formatBytes(track.size)}`;

    row.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      const action = btn?.dataset?.action;
      if (btn?.classList.contains('playlist-add')) {
        e.stopPropagation();
        promptAddToPlaylist(track.id);
        return;
      }

      if (action === 'delete') {
        e.stopPropagation();
        await removeTrack(track);
        return;
      }

      selectTrack(idx, { autoplay: true });
    });

    els.trackList.appendChild(row);
  });

  highlightActiveRow();
}

function renderPlaylists() {
  els.playlistList.innerHTML = '';
  if (!playlists.length) {
    els.playlistList.innerHTML = '<div class="playlist__item"><div class="playlist__item-title">No playlists yet</div></div>';
    return;
  }

  playlists.forEach(pl => {
    const div = document.createElement('div');
    div.className = 'playlist__item';
    div.innerHTML = `
      <div>
        <div class="playlist__item-title"></div>
        <div class="playlist__item-count"></div>
      </div>
      <button class="btn btn--ghost playlist-play" type="button">Play</button>
    `;
    div.querySelector('.playlist__item-title').textContent = pl.name;
    div.querySelector('.playlist__item-count').textContent = `${pl.trackIds.length} song${pl.trackIds.length===1?'':'s'}`;
    div.querySelector('.playlist-play').addEventListener('click', () => {
      if (!pl.trackIds.length) return;
      const firstId = pl.trackIds[0];
      const idx = filteredTracks.findIndex(t=>t.id===firstId) >=0 ? filteredTracks.findIndex(t=>t.id===firstId) : tracks.findIndex(t=>t.id===firstId);
      if (idx >=0) selectTrack(idx, { autoplay:true });
    });
    els.playlistList.appendChild(div);
  });
}

async function removeTrack(track) {
  if (!user) { toast('Login required'); return; }
  const { error } = await supabase.storage.from(BUCKET).remove([track.path]);
  if (error) {
    console.error('Delete failed', error);
    toast('Delete failed');
    return;
  }
  await deleteDbTrack(track.id);
  await refreshLibrary();
  if (!tracks.length) stopPlayback();
}

function promptAddToPlaylist(trackId) {
  const name = prompt('Add to playlist (existing name or new):');
  if (!name) return;
  let pl = playlists.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!pl) {
    pl = { id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(), name, trackIds: [] };
    playlists.push(pl);
  }
  if (!pl.trackIds.includes(trackId)) pl.trackIds.push(trackId);
  savePlaylists();
  renderPlaylists();
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
  }, 1000);
}

async function handleUpload(files) {
  if (!user) { toast('Login to upload'); showAuthModal(); return; }
  if (!files || !files.length) return;
  setUploadUiState(true, 'Uploading song...', 0);

  try {
    const parsed = await processFiles(files);
    if (!parsed.length) {
      setUploadUiState(false, 'No valid audio files found', 0);
      hideUploadUiStateLater();
      return toast('No valid audio files found');
    }

    let uploaded = 0;

    for (const t of parsed) {
      setUploadUiState(true, `Uploading song... (${uploaded + 1}/${parsed.length})`, (uploaded / parsed.length) * 100);
      const path = `${user.id}/${t.id}__${t.name}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, t.blob, { cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const record = { id: t.id, name: t.name, size: t.size, duration: t.duration, addedAt: t.addedAt, url: pub.publicUrl, path, user_id: user.id };
      await saveDbTrack(record);
      uploaded += 1;
      setUploadUiState(true, `Uploading song... (${uploaded}/${parsed.length})`, (uploaded / parsed.length) * 100);
    }

    setUploadUiState(false, `Upload complete (${uploaded}/${parsed.length})`, 100);
    hideUploadUiStateLater();
    toast(`Added ${uploaded} Song(s)`);
    await refreshLibrary();
  } catch (err) {
    console.error('Upload error', err);
    setUploadUiState(false, 'Upload failed', 0);
    hideUploadUiStateLater();
    toast('Upload failed');
  }
}

function wireEvents() {
  els.fileInput.addEventListener("change", () => {
    handleUpload(els.fileInput.files);
    els.fileInput.value = "";
  });

  els.dropzone.addEventListener("click", () => {
    if (isUploading) return;
    els.fileInput.click();
  });
  els.dropzone.addEventListener("dragover", (e) => { e.preventDefault(); els.dropzone.classList.add("dragover"); });
  els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("dragover"));
  els.dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    if (isUploading) return;
    els.dropzone.classList.remove("dragover");
    handleUpload(e.dataTransfer.files);
  });

  els.searchInput.addEventListener('input', () => { applySearchFilter(); renderPlaylist(); });

  els.playBtn.addEventListener("click", playPause);
  els.prevBtn.addEventListener("click", prevTrack);
  els.nextBtn.addEventListener("click", nextTrack);

  els.clearAllBtn.addEventListener("click", async () => {
    if (!tracks.length || !user) return;
    if (!confirm("Clear library entirely?")) return;
    const paths = tracks.map(t => t.path);
    await supabase.storage.from(BUCKET).remove(paths);
    await clearAllDbTracks();
    await refreshLibrary();
    stopPlayback();
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
    els.timeCurrent.textContent = formatTime(player.currentTime);
  });

  els.audio.addEventListener("play", updatePlayBtn);
  els.audio.addEventListener("pause", updatePlayBtn);
  els.audio.addEventListener("ended", nextTrack);

  els.authCloseBtn.addEventListener('click', () => {
    if (!user) return;
    hideAuthModal();
  });
  els.authBackdrop.addEventListener('click', () => {
    if (!user) return;
    hideAuthModal();
  });

  els.playlistCreateBtn.addEventListener('click', () => {
    const name = (els.playlistNameInput.value || '').trim();
    if (!name) return;
    playlists.push({ id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(), name, trackIds: [] });
    els.playlistNameInput.value = '';
    savePlaylists();
    renderPlaylists();
  });
}

function showAuthModal() {
  els.authModal.setAttribute('aria-hidden', 'false');
  els.authModal.removeAttribute('inert');
  els.authModal.classList.add('show');
  requestAnimationFrame(() => {
    els.authEmail?.focus();
  });
}
function hideAuthModal() {
  if (els.authModal.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  els.authModal.classList.remove('show');
  els.authModal.setAttribute('aria-hidden', 'true');
  els.authModal.setAttribute('inert', '');
}

function getAuthFormValues() {
  const email = (els.authEmail.value || '').trim();
  const password = els.authPassword.value || '';
  return { email, password };
}

function validateAuthInputs(email, password) {
  if (!email || !password) {
    toast('Email and password are required');
    return false;
  }
  if (!email.includes('@')) {
    toast('Enter a valid email');
    return false;
  }
  if (password.length < 6) {
    toast('Password must be at least 6 characters');
    return false;
  }
  return true;
}

function setAuthButtonsLoading(isLoading) {
  if (els.loginBtn) els.loginBtn.disabled = isLoading;
  if (els.signupBtn) els.signupBtn.disabled = isLoading;
  if (els.googleLoginBtn) els.googleLoginBtn.disabled = isLoading;
  if (els.sendOtpBtn) els.sendOtpBtn.disabled = isLoading;
  if (els.verifyOtpBtn) els.verifyOtpBtn.disabled = isLoading;
}

function getPhoneNumber() {
  return (els.phoneInput?.value || '').trim();
}

function getOtpCode() {
  return (els.otpInput?.value || '').trim();
}

async function handleLogin(event) {
  event.preventDefault();

  const email = (document.getElementById('authEmail')?.value || '').trim();
  const password = document.getElementById('authPassword')?.value || '';

  if (!email || !password) {
    alert('Email and password are required.');
    return;
  }

  setAuthButtonsLoading(true);

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      alert(error.message);
      return;
    }

    hideAuthModal();
  } finally {
    setAuthButtonsLoading(false);
  }
}

async function handleSignup(event) {
  event.preventDefault();

  const email = (document.getElementById('authEmail')?.value || '').trim();
  const password = document.getElementById('authPassword')?.value || '';

  if (!email || !password) {
    alert('Email and password are required.');
    return;
  }

  setAuthButtonsLoading(true);

  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      alert(error.message);
      return;
    }

    if (data?.session) {
      alert('Signup successful! You are now logged in.');
      hideAuthModal();
      return;
    }

    alert('Signup successful! Check your email to confirm, then login.');
    showAuthModal();
  } finally {
    setAuthButtonsLoading(false);
  }
}

async function handleLogout(event) {
  event.preventDefault();
  const { error } = await supabase.auth.signOut();
  if (error) alert(error.message);
}

async function handleGoogleLogin(event) {
  event.preventDefault();

  setAuthButtonsLoading(true);
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      alert(error.message);
      return;
    }
    // Redirect happens automatically on success
  } finally {
    setAuthButtonsLoading(false);
  }
}

async function handleSendOtp(event) {
  event.preventDefault();
  const phone = getPhoneNumber();
  if (!phone) {
    alert('Phone number is required (include country code, e.g. +1...).');
    return;
  }

  setAuthButtonsLoading(true);
  try {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) {
      alert(error.message);
      return;
    }
    alert('OTP sent. Check your phone.');
    els.otpInput?.focus();
  } finally {
    setAuthButtonsLoading(false);
  }
}

async function handleVerifyOtp(event) {
  event.preventDefault();
  const phone = getPhoneNumber();
  const token = getOtpCode();
  if (!phone) {
    alert('Phone number is required.');
    return;
  }
  if (!token) {
    alert('OTP code is required.');
    return;
  }

  setAuthButtonsLoading(true);
  try {
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) {
      alert(error.message);
      return;
    }
    hideAuthModal();
  } finally {
    setAuthButtonsLoading(false);
  }
}

// Clean, single-source auth wiring (no onclick)
if (els.loginBtn) els.loginBtn.addEventListener('click', handleLogin);
if (els.signupBtn) els.signupBtn.addEventListener('click', handleSignup);
if (els.logoutBtn) els.logoutBtn.addEventListener('click', handleLogout);
if (els.googleLoginBtn) els.googleLoginBtn.addEventListener('click', handleGoogleLogin);
if (els.sendOtpBtn) els.sendOtpBtn.addEventListener('click', handleSendOtp);
if (els.verifyOtpBtn) els.verifyOtpBtn.addEventListener('click', handleVerifyOtp);

window.addEventListener('beforeunload', () => player?.cleanup());

init();
