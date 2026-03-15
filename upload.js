import { genId } from './utils.js';
import { supabase } from "./supabase.js";

const AUDIO_EXTENSIONS = ["mp3","wav","ogg","m4a","aac","flac","webm","opus"];

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

// upload song to supabase
export async function uploadSong(file){

  // create unique filename
  const fileName = Date.now() + "_" + file.name;

  const { data, error } = await supabase.storage
    .from("Songs")
    .upload(fileName, file);

  if(error){
    console.error("Upload failed:", error);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from("Songs")
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}

// process files
export async function processFiles(fileList){

  const incoming = Array.from(fileList || []);
  const files = incoming.filter(isAudioFile);
  const validTracks = [];

  for(const file of files){

    const duration = await getDuration(file);
    const cloudUrl = await uploadSong(file);

    validTracks.push({
      id: genId(),
      name: file.name,
      size: file.size,
      type: file.type || "",
      addedAt: Date.now(),
      duration: duration,
      url: cloudUrl
    });

  }

  return validTracks;
}