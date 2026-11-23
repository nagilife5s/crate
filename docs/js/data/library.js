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

  #queueSave() {
    clearTimeout(this._saveT);
    this.saveState = 'saving';
    this.dispatchEvent(new Event('savestate'));
    this._saveT = setTimeout(async () => {
      try {
        const tracks = this.tracks.map(({ unplayable, ...t }) => t); // 実行時だけの印は保存しない
        await this.api.saveLibrary({ schemaVersion: SCHEMA_VERSION, tracks, playlists: this.playlists });
        this.saveState = 'saved';
      } catch (e) {
        this.saveState = 'error';
        this.dispatchEvent(new CustomEvent('toast', { detail: '保存できませんでした（' + e.message + '）' }));
      }
      this.dispatchEvent(new Event('savestate'));
    }, 400);
  }

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
  /** 長さが分かったときだけ記録（保存はする） */
  setDuration(id, sec) {
    const t = this.byId.get(id);
    if (!t || !sec || t.duration === Math.round(sec)) return;
    t.duration = Math.round(sec);
    this.changed();
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
