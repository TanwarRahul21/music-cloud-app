/*
Music Cloud (beginner-friendly)
Upload local audio → store in IndexedDB → play music
*/

const DB_NAME = "music-cloud";
const DB_VERSION = 1;
const STORE_TRACKS = "tracks";

const AUDIO_EXTENSIONS = ["mp3","wav","ogg","m4a","aac","flac","webm","opus"];

const els = {
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
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
};

let db = null;
let tracks = [];
let currentIndex = -1;
let currentObjectUrl = null;
let isSeeking = false;

function toast(msg){
  console.log(msg);
}

function formatTime(sec){
  if(!sec) return "0:00";
  const m = Math.floor(sec/60);
  const s = Math.floor(sec%60);
  return `${m}:${String(s).padStart(2,"0")}`;
}

function formatBytes(bytes){
  if(!bytes) return "0";
  return (bytes/1024/1024).toFixed(2)+" MB";
}

function genId(){
  return Date.now()+"-"+Math.random();
}

function isLikelyAudioFile(file){
  if(file.type && file.type.startsWith("audio/")) return true;
  const name = file.name.toLowerCase();
  return AUDIO_EXTENSIONS.some(ext=>name.endsWith("."+ext));
}

function getDurationFromBlob(blob){
  return new Promise(resolve=>{
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(blob);

    audio.onloadedmetadata = ()=>{
      resolve(audio.duration);
      URL.revokeObjectURL(url);
    };

    audio.onerror = ()=>{
      resolve(null);
      URL.revokeObjectURL(url);
    };

    audio.src = url;
  });
}

/* ---------- IndexedDB ---------- */

function openDb(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME,DB_VERSION);

    req.onupgradeneeded=()=>{
      const db=req.result;
      const store=db.createObjectStore(STORE_TRACKS,{keyPath:"id"});
      store.createIndex("addedAt","addedAt");
    };

    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

function tx(name,mode){
  return db.transaction(name,mode).objectStore(name);
}

function idb(req){
  return new Promise((res,rej)=>{
    req.onsuccess=()=>res(req.result);
    req.onerror=()=>rej(req.error);
  });
}

async function loadTracks(){
  const store=tx(STORE_TRACKS,"readonly");
  tracks = await idb(store.getAll()) || [];
  tracks.sort((a,b)=>a.addedAt-b.addedAt);
  renderPlaylist();
}

async function saveTrack(track){
  const store=tx(STORE_TRACKS,"readwrite");
  await idb(store.put(track));
}

async function deleteTrack(id){
  const store=tx(STORE_TRACKS,"readwrite");
  await idb(store.delete(id));
}

async function clearAllTracks(){
  const store=tx(STORE_TRACKS,"readwrite");
  await idb(store.clear());
}

/* ---------- Upload ---------- */

async function addFiles(fileList) {
  const incoming = Array.from(fileList || []);
  const files = incoming.filter(isLikelyAudioFile);

  if (!files.length) {
    toast("Please upload audio files");
    return;
  }

  for (const file of files) {
    try {
      const duration = await getDurationFromBlob(file);

      const track = {
        id: genId(),
        name: file.name,
        size: file.size,
        type: file.type,
        addedAt: Date.now(),
        duration: duration,
        blob: file
      };

      await saveTrack(track);

    } catch (err) {
      console.error("Upload error:", err);
    }
  }

  await loadTracks();

  if (currentIndex === -1 && tracks.length) {
    setCurrentByIndex(0, { autoplay: false });
  }
}

/* ---------- Player ---------- */

function setCurrentByIndex(i,{autoplay}){
  if(i<0||i>=tracks.length) return;

  currentIndex=i;
  const track=tracks[i];

  if(currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl=URL.createObjectURL(track.blob);

  if(els.audio) {
    els.audio.src=currentObjectUrl;
  }

  if(els.nowTitle) els.nowTitle.textContent=track.name;
  if(els.nowSub) els.nowSub.textContent=formatTime(track.duration);

  if(autoplay && els.audio){
    els.audio.play();
  }
}

function playPause(){
  if(currentIndex===-1){
    if(tracks.length) setCurrentByIndex(0,{autoplay:true});
    return;
  }

  if(els.audio) {
    if(els.audio.paused) els.audio.play();
    else els.audio.pause();
  }
}

function prev(){
  if(!tracks.length) return;
  currentIndex = currentIndex<=0 ? tracks.length-1 : currentIndex-1;
  setCurrentByIndex(currentIndex,{autoplay:true});
}

function next(){
  if(!tracks.length) return;
  currentIndex = currentIndex>=tracks.length-1 ? 0 : currentIndex+1;
  setCurrentByIndex(currentIndex,{autoplay:true});
}

/* ---------- Playlist UI ---------- */

function renderPlaylist(){
  if(els.trackList) els.trackList.innerHTML="";
  if(els.libraryMeta) els.libraryMeta.textContent=tracks.length+" songs";

  // Show/hide empty state
  const emptyState = document.getElementById("emptyState");
  if(emptyState) emptyState.style.display = tracks.length ? "none" : "flex";

  tracks.forEach((t,i)=>{
    const row=document.createElement("div");
    row.className="row";
    if(i===currentIndex) row.classList.add("row--active");

    row.innerHTML=`
      <div class="row__thumb">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
      </div>
      <div class="row__main">
        <div class="row__title">${t.name}</div>
        <div class="row__sub">${formatTime(t.duration)} &nbsp;·&nbsp; ${formatBytes(t.size)}</div>
      </div>
      <button data-i="${i}">Play</button>
    `;

    row.querySelector("button").onclick=(e)=>{
      e.stopPropagation();
      setCurrentByIndex(i,{autoplay:true});
    };

    row.onclick=()=>{
      setCurrentByIndex(i,{autoplay:true});
    };

    if(els.trackList) els.trackList.appendChild(row);
  });
}

/* ---------- Events ---------- */

function wireEvents(){
  if(els.fileInput) {
    els.fileInput.addEventListener("change",async()=>{
      const files=els.fileInput.files;
      await addFiles(files);
      els.fileInput.value="";
    });
  }

  if(els.playBtn) els.playBtn.onclick=playPause;
  if(els.prevBtn) els.prevBtn.onclick=prev;
  if(els.nextBtn) els.nextBtn.onclick=next;

  if(els.volume && els.audio){
    els.volume.addEventListener("input",()=>{
      els.audio.volume=els.volume.value;
    });
  }

  if(els.seek && els.audio){
    els.seek.addEventListener("mousedown",()=>{ isSeeking=true; });
    els.seek.addEventListener("input",()=>{
      if(els.audio.duration){
        els.audio.currentTime=(els.seek.value/100)*els.audio.duration;
      }
    });
    els.seek.addEventListener("mouseup",()=>{ isSeeking=false; });

    els.audio.addEventListener("timeupdate",()=>{
      if(!isSeeking && els.audio.duration){
        const pct=(els.audio.currentTime/els.audio.duration)*100;
        els.seek.value=pct;
        if(els.timeCurrent) els.timeCurrent.textContent=formatTime(els.audio.currentTime);
      }
    });

    els.audio.addEventListener("loadedmetadata",()=>{
      if(els.timeDuration) els.timeDuration.textContent=formatTime(els.audio.duration);
    });
  }

  if(els.clearAllBtn){
    els.clearAllBtn.onclick=async()=>{
      if(!confirm("Remove all tracks?")) return;
      await clearAllTracks();
      tracks=[];
      currentIndex=-1;
      if(els.audio){ els.audio.src=""; }
      if(els.nowTitle) els.nowTitle.textContent="Nothing yet";
      if(els.nowSub) els.nowSub.textContent="Select a song to start";
      renderPlaylist();
    };
  }
}

/* ---------- Init ---------- */

async function init(){
  wireEvents();
  db = await openDb();
  await loadTracks();
  if(tracks.length){
    setCurrentByIndex(0,{autoplay:false});
  }

  // ── WIRING FIX 1 ──────────────────────────────────────────────
  // heroUploadBtn (topbar) and emptyUploadBtn (empty state CTA)
  // both open the upload modal. fileInput stays hidden in the DOM.
  const uploadModal = document.getElementById("uploadModal");

  function openUploadModal(){
    if(uploadModal){
      uploadModal.removeAttribute("inert");
      uploadModal.classList.add("show");
    }
  }

  function closeUploadModal(){
    if(uploadModal){
      uploadModal.setAttribute("inert","");
      uploadModal.classList.remove("show");
    }
  }

  document.getElementById("heroUploadBtn")?.addEventListener("click", openUploadModal);
  document.getElementById("emptyUploadBtn")?.addEventListener("click", openUploadModal);
  document.getElementById("sidebarUploadBtn")?.addEventListener("click", openUploadModal);
  document.getElementById("mobileUploadBtn")?.addEventListener("click", openUploadModal);
  document.getElementById("fab")?.addEventListener("click", openUploadModal);
  document.getElementById("uploadCloseBtn")?.addEventListener("click", closeUploadModal);
  document.getElementById("uploadBackdrop")?.addEventListener("click", closeUploadModal);

  // ── WIRING FIX 2 ──────────────────────────────────────────────
  // Dropzone inside modal triggers fileInput
  const dropzone = document.getElementById("dropzone");
  if(dropzone && els.fileInput){
    dropzone.addEventListener("click", ()=> els.fileInput.click());
    dropzone.addEventListener("dragover", e=>{ e.preventDefault(); dropzone.classList.add("dragover"); });
    dropzone.addEventListener("dragleave", ()=> dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", async e=>{
      e.preventDefault();
      dropzone.classList.remove("dragover");
      await addFiles(e.dataTransfer.files);
      closeUploadModal();
    });
  }

  // ── WIRING FIX 3 ──────────────────────────────────────────────
  // Settings modal
  const settingsModal = document.getElementById("settingsModal");
  document.getElementById("settingsNavBtn")?.addEventListener("click", ()=>{
    if(settingsModal){
      settingsModal.removeAttribute("inert");
      settingsModal.classList.add("show");
    }
  });
  document.getElementById("settingsCloseBtn")?.addEventListener("click", ()=>{
    if(settingsModal){
      settingsModal.setAttribute("inert","");
      settingsModal.classList.remove("show");
    }
  });
  document.getElementById("settingsBackdrop")?.addEventListener("click", ()=>{
    if(settingsModal){
      settingsModal.setAttribute("inert","");
      settingsModal.classList.remove("show");
    }
  });

  // Global drag-to-upload (outside modal)
  const dragOverlay = document.getElementById("dragOverlay");
  let dragCounter = 0;
  document.addEventListener("dragenter", e=>{
    if([...e.dataTransfer.types].includes("Files")){
      dragCounter++;
      dragOverlay?.classList.add("show");
    }
  });
  document.addEventListener("dragleave", ()=>{
    dragCounter--;
    if(dragCounter<=0){ dragCounter=0; dragOverlay?.classList.remove("show"); }
  });
  document.addEventListener("dragover", e=> e.preventDefault());
  document.addEventListener("drop", async e=>{
    e.preventDefault();
    dragCounter=0;
    dragOverlay?.classList.remove("show");
    await addFiles(e.dataTransfer.files);
  });
}

init();