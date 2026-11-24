// 再生の司令塔。キュー・シャッフル・リピート・続きから再生・ロック画面（Media Session）を受け持つ。
// 自分の音源（AudioEngine）か YouTube（YouTubeEngine）かは、ここで振り分ける。
//
// 状態 status:
//   idle     何も選ばれていない
//   loading  読み込み中
//   playing  再生中
//   paused   一時停止
//   waiting  待機中（自動で鳴らせなかった。タップすれば続きが鳴る）
import { AudioEngine } from './audio-engine.js';
import { YouTubeEngine, YT_STATE } from './youtube-engine.js';
import { shuffled, store } from '../util.js';

const RESUME_KEY = 'crate.resume';
const SETTINGS_KEY = 'crate.settings';

export class Player extends EventTarget {
  constructor({ api, lib, audioEl, ytMountId }) {
    super();
    this.api = api;
    this.lib = lib;
    this.audio = new AudioEngine(audioEl);
    this.yt = new YouTubeEngine(ytMountId, {
      onState: (s) => this.#onYtState(s),
      onError: (c) => this.#onYtError(c),
    });

    this.current = null;
    this.status = 'idle';
    this.time = 0;
    this.duration = null;
    this.shuffle = false;
    this.repeat = 'off'; // off | all | one
    this.ctx = { label: '', key: '', original: [], order: [], index: -1 };
    this.upNext = [];
    this.fromUpNext = false;
    this.settings = { skipYtWhenHidden: false, ...store.get(SETTINGS_KEY, {}) };
    this._token = 0;
    this._skipCount = 0;
    this._lastSave = 0;

    this.#wireAudio(audioEl);
    this.#wireMediaSession();
    setInterval(() => this.#pollYt(), 500);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    window.addEventListener('pagehide', () => this.save());
  }

  // ---------- 外から呼ぶ ----------
  track(id) { return this.lib.trackById(id); }
  get isYt() { return this.current?.kind === 'youtube'; }
  get currentTime() { return this.isYt ? this.yt.time : this.audio.time; }

  /** 一覧の曲をタップしたとき。その一覧の残りがキューになる */
  playList(ids, startId, label, key) {
    this.audio.unlock();
    const t = this.track(startId);
    if (t) delete t.unplayable;
    this.ctx = { label, key, original: ids.slice(), order: [], index: -1 };
    this.#applyOrder(startId);
    this.fromUpNext = false;
    this.#start(startId, { gesture: true });
  }

  /** プレイリストの「再生」「シャッフル」ボタン */
  playAll(ids, label, key, { shuffle } = {}) {
    if (!ids.length) return;
    if (shuffle != null) this.shuffle = shuffle;
    const start = this.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
    this.playList(ids, start, label, key);
  }

  toggle() {
    if (!this.current) return;
    this.audio.unlock();
    if (this.status === 'playing' || this.status === 'loading') this.pause();
    else this.resume();
  }

  resume() {
    const t = this.current;
    if (!t) return;
    this.audio.unlock();
    if (t.kind === 'file') {
      // URL の期限が近い・まだ読み込んでいない → 同じ位置から新しい URL で読み込み直す
      if (!this.audio.el.src || this.audio.isSilent || this.api.needsFreshUrl(t)) {
        this.#start(t.id, { gesture: true, startAt: this.audio.time || this.time });
        return;
      }
      this.status = 'loading';
      this.emit();
      this.audio.play().then(() => this.#setStatus('playing')).catch((e) => {
        if (e.name === 'NotAllowedError') this.#setStatus('waiting');
      });
    } else {
      this.status = 'loading';
      this.emit();
      this.yt.play();
    }
  }

  pause() {
    if (!this.current) return;
    if (this.isYt) this.yt.pause(); else this.audio.pause();
    this.#setStatus('paused');
    this.save();
  }

  next() { this.audio.unlock(); this.#advance(false); }

  prev() {
    this.audio.unlock();
    if (this.currentTime > 3) { this.seek(0); return; }
    if (this.fromUpNext && this.ctx.index >= 0) {
      this.fromUpNext = false;
      this.#start(this.ctx.order[this.ctx.index], { gesture: true });
    } else if (this.ctx.index > 0) {
      this.ctx.index--;
      this.#start(this.ctx.order[this.ctx.index], { gesture: true });
    } else this.seek(0);
  }

  seek(t) {
    if (!this.current) return;
    if (!this.isYt && this.api.needsFreshUrl(this.current)) {
      // 期限切れの URL でシークすると新しい要求が 403 になるので、新しい URL で読み込み直す
      this.#start(this.current.id, { gesture: true, startAt: t, autoplay: this.status === 'playing' || this.status === 'loading' });
      return;
    }
    if (this.isYt) this.yt.seek(t); else this.audio.seek(t);
    this.time = t;
    this.emitTime();
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.#applyOrder(this.current?.id);
    this.emit();
    this.save();
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this.emit();
    this.save();
  }

  /** キュー：次に再生／最後に追加 */
  addNext(id) { this.upNext.unshift(id); this.emit(); this.save(); }
  addToEnd(id) { this.upNext.push(id); this.emit(); this.save(); }
  removeUpNext(i) { this.upNext.splice(i, 1); this.emit(); this.save(); }
  clearUpNext() { this.upNext = []; this.emit(); this.save(); }

  /** キュー画面で曲を押したとき */
  jumpUpNext(i) {
    const id = this.upNext[i];
    this.upNext.splice(0, i + 1);
    this.fromUpNext = true;
    this.audio.unlock();
    this.#start(id, { gesture: true });
  }
  jumpCtx(i) {
    this.ctx.index = i;
    this.fromUpNext = false;
    this.audio.unlock();
    this.#start(this.ctx.order[i], { gesture: true });
  }

  /** 曲がライブラリから消えたとき */
  forget(id) {
    this.upNext = this.upNext.filter((x) => x !== id);
    const cur = this.current?.id;
    this.ctx.original = this.ctx.original.filter((x) => x !== id);
    this.ctx.order = this.ctx.order.filter((x) => x !== id);
    this.ctx.index = cur ? this.ctx.order.indexOf(cur) : -1;
    if (cur === id) {
      this.pause();
      this.current = null;
      this.status = 'idle';
    }
    this.emit();
    this.save();
  }

  setSetting(k, v) {
    this.settings[k] = v;
    store.set(SETTINGS_KEY, this.settings);
    this.emit();
  }

  emit() { this.dispatchEvent(new Event('change')); }
  emitTime() { this.dispatchEvent(new Event('time')); }
  toast(msg) { this.dispatchEvent(new CustomEvent('toast', { detail: msg })); }

  // ---------- 続きから再生 ----------
  save() {
    if (!this.current) { store.del(RESUME_KEY); return; }
    store.set(RESUME_KEY, {
      v: 1, currentId: this.current.id, time: Math.floor(this.currentTime || this.time || 0),
      ctx: this.ctx, upNext: this.upNext, fromUpNext: this.fromUpNext, shuffle: this.shuffle, repeat: this.repeat,
    });
  }

  /** 起動時。鳴らさずに、一時停止の状態で戻すだけ */
  restore() {
    const s = store.get(RESUME_KEY, null);
    if (!s || s.v !== 1 || !this.track(s.currentId)) return false;
    const alive = (ids) => (ids || []).filter((id) => this.track(id));
    this.shuffle = !!s.shuffle;
    this.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
    this.ctx = { ...s.ctx, original: alive(s.ctx?.original), order: alive(s.ctx?.order) };
    this.ctx.index = this.ctx.order.indexOf(s.currentId);
    this.upNext = alive(s.upNext);
    this.fromUpNext = !!s.fromUpNext;
    this.#start(s.currentId, { autoplay: false, startAt: s.time || 0 });
    return true;
  }

  // ---------- 内部 ----------
  #setStatus(s) {
    this.status = s;
    if (s === 'playing') this._skipCount = 0;
    this.emit();
    this.#updateMediaSession();
  }

  #applyOrder(currentId) {
    const { original } = this.ctx;
    if (this.shuffle) {
      const has = currentId && original.includes(currentId);
      this.ctx.order = has ? [currentId, ...shuffled(original.filter((x) => x !== currentId))] : shuffled(original);
    } else {
      this.ctx.order = original.slice();
    }
    this.ctx.index = currentId ? this.ctx.order.indexOf(currentId) : -1;
  }

  async #start(id, { gesture = false, autoplay = true, startAt = 0, isRetry = false } = {}) {
    const t = this.track(id);
    if (!t) { if (autoplay) this.#advance(true); return; }
    const token = ++this._token;
    if (!isRetry) this._retried = false;

    // 画面オフ中は YouTube を飛ばす（設定がオンのとき）
    if (t.kind === 'youtube' && autoplay && !gesture && document.hidden && this.settings.skipYtWhenHidden) {
      this.current = t;
      if (++this._skipCount > this.ctx.order.length + this.upNext.length + 1) { this.#setStatus('paused'); return; }
      this.#advance(true);
      return;
    }

    this.current = t;
    this.time = startAt;
    this.duration = t.duration ?? null;
    this.status = autoplay ? 'loading' : 'paused';
    this.emit();
    this.#updateMediaSession();
    this.save();

    if (t.kind === 'file') {
      this.yt.pause();
      let url;
      try { url = await this.api.getStreamUrl(t); } catch (e) {
        if (token === this._token) this.#fail(t, '曲を取得できませんでした');
        return;
      }
      if (token !== this._token) return;
      this.audio.load(url, startAt);
      if (!autoplay) return;
      try {
        await this.audio.play();
        if (token === this._token) this.#setStatus('playing');
      } catch (e) {
        if (token !== this._token) return;
        if (e.name === 'NotAllowedError') this.#setStatus('waiting');
        else if (e.name !== 'AbortError') this.#fail(t, 'この曲を再生できませんでした');
      }
    } else {
      this.audio.pause();
      try { await this.yt.load(t.ref, startAt, autoplay); } catch (e) {
        if (token === this._token) this.#fail(t, e.message || 'YouTube を読み込めませんでした');
        return;
      }
      if (token !== this._token || !autoplay) return;
      // iPhone では、タップなしの自動再生が拒否されることがある → 待機中にする
      setTimeout(() => {
        if (token !== this._token) return;
        const s = this.yt.state;
        if (s !== YT_STATE.PLAYING && s !== YT_STATE.BUFFERING && this.status === 'loading') this.#setStatus('waiting');
      }, 2500);
    }
  }

  #advance(auto) {
    const t = this.current;
    if (auto && this.repeat === 'one' && t && !t.unplayable) { this.#start(t.id); return; }
    let id = null;
    while (this.upNext.length) {
      const c = this.upNext.shift();
      if (this.track(c)) { id = c; break; }
    }
    if (id) this.fromUpNext = true;
    else {
      let i = this.ctx.index + 1;
      if (i >= this.ctx.order.length) {
        if (this.repeat !== 'off' && this.ctx.order.length) i = 0;
        else { this.#endOfQueue(); return; }
      }
      this.ctx.index = i;
      this.fromUpNext = false;
      id = this.ctx.order[i];
    }
    this.#start(id, { gesture: !auto });
  }

  #endOfQueue() {
    if (this.isYt) this.yt.pause(); else this.audio.pause();
    this.#setStatus('paused');
    this.toast('キューの最後まで再生しました');
    this.save();
  }

  #fail(t, msg) {
    t.unplayable = true;
    this.lib.dispatchEvent(new Event('change'));
    if (++this._skipCount > 5) {
      this.toast(msg + '。再生を止めました');
      this.#setStatus('paused');
      return;
    }
    this.toast(msg + '。次の曲へ進みます');
    this.#advance(true);
  }

  #wireAudio(el) {
    el.addEventListener('timeupdate', () => {
      if (this.isYt || this.audio.isSilent) return;
      this.time = el.currentTime;
      this.duration = this.audio.duration ?? this.duration;
      this.emitTime();
      this.#positionState();
      if (Date.now() - this._lastSave > 5000) { this._lastSave = Date.now(); this.save(); }
    });
    el.addEventListener('loadedmetadata', () => {
      if (this.isYt || this.audio.isSilent || !this.current) return;
      this.duration = this.audio.duration;
      this.lib.setDuration(this.current.id, this.duration);
      this.emitTime();
    });
    el.addEventListener('playing', () => { if (!this.isYt && !this.audio.isSilent) this.#setStatus('playing'); });
    el.addEventListener('waiting', () => { if (!this.isYt && this.status === 'playing') this.#setStatus('loading'); });
    el.addEventListener('pause', () => {
      if (this.isYt || this.audio.isSilent || el.ended) return;
      // ロック画面やイヤホンで止めたとき
      if (this.status === 'playing') this.#setStatus('paused');
    });
    el.addEventListener('ended', () => { if (!this.isYt && !this.audio.isSilent) this.#advance(true); });
    el.addEventListener('error', async () => {
      if (this.isYt || this.audio.isSilent || !this.current || !el.src) return;
      const t = this.current;
      // <audio> からは HTTP の状態が見えない。URL の期限切れかもしれないので、取り直して1回だけやり直す
      if (!this._retried) {
        this._retried = true;
        const at = el.currentTime || this.time || 0;
        const wasPlaying = this.status !== 'paused';
        try { await this.api.refreshUrls([t.ref]); } catch (e) { /* 下でやり直して、ダメなら再生不可 */ }
        if (this.current !== t) return;
        this.#start(t.id, { startAt: at, autoplay: wasPlaying, isRetry: true });
        return;
      }
      this.#fail(t, 'この曲を再生できませんでした');
    });
  }

  #onYtState(s) {
    if (!this.isYt) return;
    if (s === YT_STATE.PLAYING) {
      this.duration = this.yt.duration ?? this.duration;
      if (this.duration) this.lib.setDuration(this.current.id, this.duration);
      this.#setStatus('playing');
    } else if (s === YT_STATE.PAUSED) {
      if (this.status !== 'waiting') this.#setStatus('paused');
    } else if (s === YT_STATE.BUFFERING) {
      if (this.status === 'playing') this.#setStatus('loading');
    } else if (s === YT_STATE.ENDED) {
      this.#advance(true);
    }
  }

  #onYtError(code) {
    if (!this.isYt) return;
    const msg = code === 101 || code === 150 ? '埋め込みが許可されていない動画です'
      : code === 100 ? '動画が見つかりません（削除・非公開）' : 'この動画は再生できません';
    this.#fail(this.current, msg);
  }

  #pollYt() {
    if (!this.isYt || this.status !== 'playing') return;
    this.time = this.yt.time;
    this.duration = this.yt.duration ?? this.duration;
    this.emitTime();
    if (Date.now() - this._lastSave > 5000) { this._lastSave = Date.now(); this.save(); }
  }

  // ---------- ロック画面 ----------
  #wireMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* 未対応 */ } };
    set('play', () => this.resume());
    set('pause', () => this.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (d) => { if (d.seekTime != null) this.seek(d.seekTime); });
  }

  #updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = this.current;
    if (!t) { navigator.mediaSession.metadata = null; return; }
    let title = t.title, artist = t.artist || '';
    if (this.status === 'waiting') {
      title = '▶ ' + t.title;
      artist = t.kind === 'youtube' ? '次は YouTube。画面をつけて再開してください' : '画面をつけて再開してください';
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title, artist, album: 'Crate',
        artwork: [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
      });
      navigator.mediaSession.playbackState = this.status === 'playing' ? 'playing' : 'paused';
    } catch { /* 未対応 */ }
  }

  #positionState() {
    const ms = navigator.mediaSession;
    if (!ms || !ms.setPositionState || !this.duration) return;
    try { ms.setPositionState({ duration: this.duration, position: Math.min(this.time, this.duration), playbackRate: 1 }); } catch { /* noop */ }
  }
}
