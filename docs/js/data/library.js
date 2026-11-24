// 曲とプレイリストの一覧（メモリ上の正）。変更したら少し待ってまとめて保存する。
import { uid } from '../util.js';
import { SCHEMA_VERSION } from './mock-data.js';

export class Library extends EventTarget {
  constructor(api) {
    super();
    this.api = api;
    this.tracks = [];
    this.playlists = [];
    this.byId = new Map();
    this.saveState = 'saved'; // saved | saving | error
    this.dirty = false;
    this.saving = false;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.dirty) this.flush({ keepalive: true });
    });
  }

  async load() {
    const d = await this.api.loadLibrary();
    this.tracks = d.tracks || [];
    this.playlists = d.playlists || [];
    this.#index();
  }

  #index() { this.byId = new Map(this.tracks.map((t) => [t.id, t])); }

  trackById(id) { return this.byId.get(id); }
  playlistById(id) { return this.playlists.find((p) => p.id === id); }
  playlistTracks(pl) { return pl.trackIds.map((id) => this.byId.get(id)).filter(Boolean); }
  hasVideo(videoId) { return this.tracks.some((t) => t.kind === 'youtube' && t.ref === videoId); }

  // 元に戻す用
  snapshot() { return JSON.stringify({ tracks: this.tracks, playlists: this.playlists }); }
  restore(snap) {
    const d = JSON.parse(snap);
    this.tracks = d.tracks;
    this.playlists = d.playlists;
    this.changed();
  }

  changed({ save = true } = {}) {
    this.#index();
    this.dispatchEvent(new Event('change'));
    if (save) this.#queueSave();
  }

  // ---- 保存 ----
  // ・変更から2秒待ってまとめて保存（並べ替えのたびにコミットが増えすぎないように）
  // ・同時に送るのは1件だけ。送っている間に変わったら、終わってから最新の状態でもう1回
  // ・画面が裏に回ったら待たずに送る（iPhone は裏のページをすぐ止めるため）
  #queueSave() {
    this.dirty = true;
    this.#setState('saving');
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.flush(), 2000);
  }

  get hasPending() { return this.dirty || this.saving; }

  async flush({ keepalive = false } = {}) {
    clearTimeout(this._saveT);
    if (!this.dirty) return;
    if (this.saving) { this._again = true; return; }
    this.saving = true;
    this.dirty = false;
    this._again = false;
    try {
      const tracks = this.tracks.map(({ unplayable, ...t }) => t); // 実行時だけの印は保存しない
      const r = await this.api.saveLibrary({ schemaVersion: SCHEMA_VERSION, tracks, playlists: this.playlists }, { keepalive });
      if (r && r.lib && !this.dirty) {
        // Mac で足した曲を Worker が足し戻した → その一覧に合わせる
        const bad = new Set(this.tracks.filter((t) => t.unplayable).map((t) => t.id));
        this.tracks = r.lib.tracks.map((t) => (bad.has(t.id) ? { ...t, unplayable: true } : t));
        this.playlists = r.lib.playlists;
        this.changed({ save: false });
        if (r.restored) this.#toast(`Mac で追加された曲を ${r.restored} 曲取り込みました`);
      }
      this.#setState(this.dirty ? 'saving' : 'saved');
    } catch (e) {
      this.dirty = true; // 次の変更か「再試行」でもう一度
      this.#setState('error');
      const msg = e.code === 'github_auth' ? 'GitHub のトークンが期限切れです。保存できません'
        : e.code === 'network' ? '通信できず保存できませんでした'
        : e.code === 'too_many_removed' ? e.message
        : '保存できませんでした（' + e.message + '）';
      if (e.code !== 'unauthorized') this.#toast(msg, { action: '再試行', onAction: () => this.flush() });
    } finally {
      this.saving = false;
      if (this._again || (this.dirty && this.saveState !== 'error')) {
        clearTimeout(this._saveT);
        this._saveT = setTimeout(() => this.flush(), 300);
      }
    }
  }

  #setState(s) {
    this.saveState = s;
    this.dispatchEvent(new Event('savestate'));
  }
  #toast(msg, opts) { this.dispatchEvent(new CustomEvent('toast', { detail: { msg, ...opts } })); }

  // ---- 曲 ----
  addYouTube({ videoId, title, artist }) {
    const t = { id: uid('yt'), kind: 'youtube', ref: videoId, title: title.trim(), artist: (artist || '').trim(), duration: null };
    this.tracks.push(t);
    this.changed();
    return t;
  }
  updateTrack(id, patch) {
    const t = this.byId.get(id);
    if (!t) return;
    Object.assign(t, patch);
    this.changed();
  }
  /** 長さが分かったら記録。これだけでは保存しない（次の保存に一緒に乗る） */
  setDuration(id, sec) {
    const t = this.byId.get(id);
    if (!t || !sec || t.duration === Math.round(sec)) return;
    t.duration = Math.round(sec);
    this.changed({ save: false });
  }
  removeTrack(id) {
    this.tracks = this.tracks.filter((t) => t.id !== id);
    this.playlists.forEach((p) => { p.trackIds = p.trackIds.filter((x) => x !== id); });
    this.changed();
  }

  // ---- プレイリスト ----
  createPlaylist(name) {
    const pl = { id: uid('pl'), name: name.trim() || '新しいプレイリスト', trackIds: [] };
    this.playlists.push(pl);
    this.changed();
    return pl;
  }
  renamePlaylist(id, name) {
    const pl = this.playlistById(id);
    if (pl && name.trim()) { pl.name = name.trim(); this.changed(); }
  }
  deletePlaylist(id) {
    this.playlists = this.playlists.filter((p) => p.id !== id);
    this.changed();
  }
  /** 重複は入れない。入れたら true */
  addToPlaylist(plId, trackId) {
    const pl = this.playlistById(plId);
    if (!pl || pl.trackIds.includes(trackId)) return false;
    pl.trackIds.push(trackId);
    this.changed();
    return true;
  }
  removeFromPlaylist(plId, index) {
    const pl = this.playlistById(plId);
    if (!pl) return;
    pl.trackIds.splice(index, 1);
    this.changed();
  }
  movePlaylistItem(plId, from, to) {
    const pl = this.playlistById(plId);
    if (!pl || from === to) return;
    const [x] = pl.trackIds.splice(from, 1);
    pl.trackIds.splice(to, 0, x);
    this.changed();
  }
}
