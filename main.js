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
  fab: document.getElementById("fab"),
  mobileUploadBtn: document.getElementById("mobileUploadBtn"),
  uploadModal: document.getElementById("uploadModal"),
  uploadBackdrop: document.getElementById("uploadBackdrop"),
  uploadCloseBtn: document.getElementById("uploadCloseBtn"),
  appShell: document.querySelector('.app-shell'),
  topPlayer: document.getElementById('topPlayer'),
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
  els.userEmail.textContent = user ? user.email : 'Guest';
  els.appShell.classList.toggle('is-authenticated', !!user);

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

    const durText = track.duration == null ? "--:--" : formatTime(track.duration);
    row.innerHTML = `
      <div class="row__thumb" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
      </div>
      <div class="row__main">
        <div class="row__title"></div>
        <div class="row__sub"></div>
      </div>
      <div class="row__actions">
        <button class="btn btn--danger" type="button" data-action="delete">Delete</button>
        <button class="btn" type="button" data-action="playlist">Add</button>
      </div>
    `;
    row.querySelector('.row__title').textContent = track.name;
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
  setUploadUiState(true, 'Preparing upload...', 0);

  try {
    const parsed = await processFiles(files);
    if (!parsed.length) {
      setUploadUiState(false, 'No valid audio files found', 0);
      hideUploadUiStateLater();
      return toast('No valid audio files found');
    }

    let uploaded = 0;

    for (const t of parsed) {
      setUploadUiState(true, `Uploading... (${uploaded + 1}/${parsed.length})`, (uploaded / parsed.length) * 100);
      const path = `${user.id}/${t.id}__${t.name}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, t.blob, { cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const record = { id: t.id, name: t.name, size: t.size, duration: t.duration, addedAt: t.addedAt, url: pub.publicUrl, path, user_id: user.id };
      await saveDbTrack(record);
      uploaded += 1;
      setUploadUiState(true, `Uploading... (${uploaded}/${parsed.length})`, (uploaded / parsed.length) * 100);
    }

    setUploadUiState(false, `Upload complete!`, 100);
    hideUploadUiStateLater();
    toast(`Added ${uploaded} song(s)`);
    await refreshLibrary();
    setTimeout(hideUploadModal, 1000);
  } catch (err) {
    console.error('Upload error', err);
    setUploadUiState(false, 'Upload failed', 0);
    hideUploadUiStateLater();
    toast('Upload failed. Check console for details.');
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

  els.playBtn.addEventListener("click", playPause);
  els.prevBtn.addEventListener("click", prevTrack);
  els.nextBtn.addEventListener("click", nextTrack);

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

  // Modal wiring
  els.authCloseBtn.addEventListener('click', hideAuthModal);
  els.authBackdrop.addEventListener('click', hideAuthModal);
  els.fab.addEventListener('click', showUploadModal);
  els.mobileUploadBtn.addEventListener('click', showUploadModal);
  els.uploadCloseBtn.addEventListener('click', hideUploadModal);
  els.uploadBackdrop.addEventListener('click', hideUploadModal);
}

function showAuthModal() {
  els.authModal.classList.add('show');
}
function hideAuthModal() {
  els.authModal.classList.remove('show');
}
function showUploadModal() {
  els.uploadModal.classList.add('show');
}
function hideUploadModal() {
  els.uploadModal.classList.remove('show');
}

function setAuthButtonsLoading(isLoading) {
  els.loginBtn.disabled = isLoading;
  els.signupBtn.disabled = isLoading;
  els.googleLoginBtn.disabled = isLoading;
  els.sendOtpBtn.disabled = isLoading;
  els.verifyOtpBtn.disabled = isLoading;
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

async function handleSendOtp(event) {
  event.preventDefault();
  const phone = (els.phoneInput?.value || '').trim();
  if (!phone) return toast('Phone number is required.');

  setAuthButtonsLoading(true);
  try {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) return toast(error.message);
    toast('OTP sent. Check your phone.');
    els.otpInput?.focus();
  } finally {
    setAuthButtonsLoading(false);
  }
}

async function handleVerifyOtp(event) {
  event.preventDefault();
  const phone = (els.phoneInput?.value || '').trim();
  const token = (els.otpInput?.value || '').trim();
  if (!phone || !token) return toast('Phone and OTP code are required.');

  setAuthButtonsLoading(true);
  try {
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) return toast(error.message);
    hideAuthModal();
  } finally {
    setAuthButtonsLoading(false);
  }
}

// Auth event listeners
els.loginBtn.addEventListener('click', handleLogin);
els.signupBtn.addEventListener('click', handleSignup);
els.logoutBtn.addEventListener('click', handleLogout);
els.googleLoginBtn.addEventListener('click', handleGoogleLogin);
els.sendOtpBtn.addEventListener('click', handleSendOtp);
els.verifyOtpBtn.addEventListener('click', handleVerifyOtp);

window.addEventListener('beforeunload', () => player?.cleanup());

init();
