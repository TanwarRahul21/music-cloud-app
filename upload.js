import { genId } from './utils.js';

const AUDIO_EXTENSIONS = ["mp3","wav","ogg","m4a","aac","flac","webm","opus"];

// sanitize filename for storage — unchanged
export function sanitizeFilename(filename) {
  if (!filename) return 'untitled';
  const lastDot = filename.lastIndexOf('.');
  let name = lastDot > 0 ? filename.substring(0, lastDot) : filename;
  const ext  = lastDot > 0 ? filename.substring(lastDot) : '';
  name = name.replace(/\s+/g, '_');
  name = name.replace(/[^\w\-]/g, '_');
  name = name.replace(/_+/g, '_');
  name = name.replace(/^_+|_+$/g, '');
  if (name.length > 100) name = name.substring(0, 100);
  if (!name) name = 'file';
  return name + ext;
}

// check if file is audio — unchanged
export function isAudioFile(file) {
  if (!file || !file.name) return false;
  const ext = file.name.toLowerCase().split('.').pop();
  return ['mp3','wav','flac','aac','ogg','m4a','opus','wma'].includes(ext);
}

// get audio duration — unchanged
export function getDuration(blob) {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const url = URL.createObjectURL(blob);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      audio.load();
    };
    audio.onloadedmetadata = () => {
      const dur = audio.duration;
      cleanup();
      resolve(Number.isFinite(dur) ? dur : null);
    };
    audio.onerror = () => {
      cleanup();
      resolve(null);
    };
    audio.src = url;
  });
}

// ensure duration lookup never hangs forever; fallback to null after a timeout
async function safeGetDuration(blob, timeoutMs = 5000) {
  try {
    return await Promise.race([
      getDuration(blob),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function getArtworkDataUrl(file) {
  const metadataLib = globalThis.musicMetadata;
  if (!metadataLib?.parseBlob) return null;
  try {
    const metadata = await metadataLib.parseBlob(file);
    const picture = metadata?.common?.picture?.[0];
    if (!picture?.data) return null;
    const mime = picture.format || 'image/jpeg';
    const artBlob = new Blob([picture.data], { type: mime });
    return await blobToDataUrl(artBlob);
  } catch {
    return null;
  }
}

// ─── PATCHED: processFiles ────────────────────────────────────────
// BEFORE: for loop with await — read each duration one by one
//         10 files = ~10 seconds just to prepare before uploading
//
// AFTER:  Promise.all — read all durations at the same time
//         10 files = ~1 second
// ─────────────────────────────────────────────────────────────────
export async function processFiles(fileList) {
  const incoming = Array.from(fileList || []);
  const files = incoming.filter(isAudioFile);

  const validTracks = await Promise.all(
    files.map(async (file) => {
      const [duration, artworkUrl] = await Promise.all([
        safeGetDuration(file),
        getArtworkDataUrl(file),
      ]);
      return {
        id:          genId(),
        name:        file.name,
        storageName: sanitizeFilename(file.name),
        size:        file.size,
        type:        file.type || "",
        addedAt:     Date.now(),
        duration:    duration,
        artwork_url: artworkUrl,
        blob:        file,
      };
    })
  );

  return validTracks;
}