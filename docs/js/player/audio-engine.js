// 自分の音源を鳴らす係。<audio> は1個だけ作って使い回す（iPhone で画面オフのまま次の曲へ進むため）。

function silentWav() {
  // 0.1秒・8kHz・8bit の無音 WAV
  const n = 800, buf = new Uint8Array(44 + n), v = new DataView(buf.buffer);
  const s = (o, str) => [...str].forEach((c, i) => (buf[o + i] = c.charCodeAt(0)));
  s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  s(36, 'data'); v.setUint32(40, n, true); buf.fill(128, 44);
  let bin = ''; buf.forEach((b) => (bin += String.fromCharCode(b)));
  return 'data:audio/wav;base64,' + btoa(bin);
}
const SILENT = silentWav();

export class AudioEngine {
  constructor(el) {
    this.el = el;
    this.unlocked = false;
    this.pendingSeek = 0;
    el.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek > 0 && isFinite(el.duration)) {
        el.currentTime = Math.min(this.pendingSeek, el.duration - 0.5);
      }
      this.pendingSeek = 0;
    });
  }

  /** 無音の解除中・解除用の無音が入っているあいだは、再生の状態として扱わない */
  get isSilent() { return this.priming || this.el.src.startsWith('data:audio/wav'); }

  /** 最初のタップのときに、消音で一瞬だけ鳴らしておく（以後、タップなしでも play() が通るように） */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const el = this.el;
    if (!el.src) el.src = SILENT;
    const src = el.src;
    this.priming = true;
    el.muted = true;
    const done = () => {
      if (el.src === src) el.pause();
      el.muted = false;
      this.priming = false;
    };
    const p = el.play();
    if (p) p.then(done).catch(() => { el.muted = false; this.priming = false; });
    else done();
  }

  load(url, startAt = 0) {
    this.pendingSeek = startAt;
    this.el.src = url;
    this.el.load();
  }

  play() { return this.el.play(); }
  pause() { if (!this.el.paused) this.el.pause(); }
  seek(t) {
    if (this.el.readyState >= 1) this.el.currentTime = t;
    else this.pendingSeek = t;
  }
  get time() { return this.el.readyState >= 1 ? this.el.currentTime : this.pendingSeek; }
  get duration() { return isFinite(this.el.duration) ? this.el.duration : null; }
}
