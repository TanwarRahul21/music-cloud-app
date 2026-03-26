export class Player {
  constructor(audioElement) {
    this.audio = audioElement;
    this.endedHandler = null;
  }

  // Look closely at this function! 
  // Make sure there is NO URL.createObjectURL here.
  async loadAndPlay(url) {
    this.audio.src = url; // <-- Just pass the Supabase string directly!
    try {
      await this.audio.play();
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn("Autoplay prevented or playback interrupted", err);
      }
    }
  }

  async toggle() {
    if (this.audio.paused) {
      try {
        await this.audio.play();
      } catch (err) {
        if (err?.name !== 'AbortError') throw err;
      }
    } else {
      this.audio.pause();
    }
  }

  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  seek(percent) {
    if (this.duration > 0) {
      this.audio.currentTime = (percent / 100) * this.duration;
    }
  }

  setVolume(val) {
    this.audio.volume = val / 100;
  }

  get paused() {
    return this.audio.paused;
  }

  get duration() {
    return this.audio.duration;
  }

  get currentTime() {
    return this.audio.currentTime;
  }

  onEnded(handler) {
    if (typeof handler !== 'function') return;
    if (this.endedHandler) {
      this.audio.removeEventListener('ended', this.endedHandler);
    }
    this.endedHandler = handler;
    this.audio.addEventListener('ended', handler);
  }

  cleanup() {
    this.audio.pause();
    this.audio.src = "";
  }
}