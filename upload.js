import { genId } from './utils.js';

const AUDIO_EXTENSIONS = ["mp3","wav","ogg","m4a","aac","flac","webm","opus"];

// sanitize filename for storage
export function sanitizeFilename(filename) {
  if (!filename) return 'untitled';

  // Split filename and extension
  const lastDot = filename.lastIndexOf('.');
  let name = lastDot > 0 ? filename.substring(0, lastDot) : filename;
  const ext = lastDot > 0 ? filename.substring(lastDot) : '';

  // Replace spaces with underscores
  name = name.replace(/\s+/g, '_');

  // Remove or replace special characters - keep only alphanumeric, underscore, hyphen
  name = name.replace(/[^\w\-]/g, '_');

  // Remove multiple consecutive underscores
  name = name.replace(/_+/g, '_');

  // Trim underscores from start and end
  name = name.replace(/^_+|_+$/g, '');

  // Limit length (keep first 100 chars of name)
  if (name.length > 100) {
    name = name.substring(0, 100);
  }

  // If name is empty after sanitization, use a default
  if (!name) name = 'file';

  return name + ext;
}

// check if file is audio
export function isAudioFile(file){
  if(!file) return false;
  if(file.type && file.type.startsWith("audio/")) return true;

  const lower = (file.name || "").toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => lower.endsWith(`.${ext}`));
}

// get audio duration
export function getDuration(blob){
  return new Promise((resolve)=>{
    const audio = document.createElement("audio");
    audio.preload = "metadata";

    const url = URL.createObjectURL(blob);

    const cleanup = ()=>{
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      audio.load();
    };

    audio.onloadedmetadata = ()=>{
      const dur = audio.duration;
      cleanup();
      resolve(Number.isFinite(dur) ? dur : null);
    };

    audio.onerror = ()=>{
      cleanup();
      resolve(null);
    };

    audio.src = url;
  });
}

// process files
export async function processFiles(fileList){

  const incoming = Array.from(fileList || []);
  const files = incoming.filter(isAudioFile);
  const validTracks = [];

  for(const file of files){

    const duration = await getDuration(file);

    validTracks.push({
      id: genId(),
      name: file.name, // Original filename for display
      storageName: sanitizeFilename(file.name), // Sanitized filename for storage
      size: file.size,
      type: file.type || "",
      addedAt: Date.now(),
      duration: duration,
      blob: file
    });

  }

  return validTracks;
}