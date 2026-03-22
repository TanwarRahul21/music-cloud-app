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
  if (!file) return false;
  if (file.type && file.type.startsWith("audio/")) return true;
  const lower = (file.name || "").toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => lower.endsWith(`.${ext}`));
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
      const duration = await getDuration(file);
      return {
        id:          genId(),
        name:        file.name,
        storageName: sanitizeFilename(file.name),
        size:        file.size,
        type:        file.type || "",
        addedAt:     Date.now(),
        duration:    duration,
        blob:        file,
      };
    })
  );

  return validTracks;
}