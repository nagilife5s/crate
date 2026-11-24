// データの窓口。画面と再生のコードはここだけを呼ぶ。
// MockApi（ダミー）と WorkerApi（本番）を差し替えられるように、同じメソッドを持たせる。
//
//   checkKey(key)              合言葉が正しいか
//   loadLibrary()              { schemaVersion, tracks, playlists }
//   saveLibrary(lib, opts)     一覧の保存 → { lib? }（Worker が Mac で足した曲を足し戻したら、その一覧）
//   getStreamUrl(track)        <audio> に渡すURL（本番は Worker が出す期限付きURL。期限が近ければ取り直す）
//   needsFreshUrl(track)       今の URL の期限が近いか（再開・シークの前に見る）
//   refreshUrls()              URL をまとめて取り直す
//   fetchYouTubeMeta(id)       { title, author }
//
// エラーは Error に code（unauthorized / network / github_auth / …）を付けて投げる。
// 合言葉が通らなかったら window に 'crate:unauthorized' を出す（app.js が合言葉画面に戻す）。
import { seedLibrary, SCHEMA_VERSION, YT_META } from './mock-data.js';
import { wait, store } from '../util.js';

const LS_LIB = 'crate.mock.library';
export const KEY_STORE = 'crate.key';
const REFRESH_MARGIN_SEC = 3600; // 期限の1時間前から取り直す

class MockApi {
  isMock = true;

  async checkKey(key) {
    await wait(350);
    return String(key || '').trim().length > 0;
  }

  async loadLibrary() {
    await wait(250);
    const saved = store.get(LS_LIB, null);
    if (saved && saved.schemaVersion === SCHEMA_VERSION) return saved;
    return seedLibrary();
  }

  async saveLibrary(lib) {
    await wait(200);
    store.set(LS_LIB, lib);
    return {};
  }

  async getStreamUrl(track) { return new URL('media/' + track.ref, location.href).href; }
  needsFreshUrl() { return false; }
  async refreshUrls() {}

  async fetchYouTubeMeta(videoId) {
    await wait(700);
    const m = YT_META[videoId];
    if (!m) throw Object.assign(new Error('not_found'), { code: 'not_found' });
    return m;
  }

  resetMock() { store.del(LS_LIB); }
}

class WorkerApi {
  isMock = false;

  constructor(url) {
    this.url = url.replace(/\/$/, '');
    this.urls = {};      // ファイル名 → 期限付きURL
    this.urlsAt = 0;     // 受け取った時刻（端末の時計。期限の判定は「受け取ってからの経過」で行う）
    this.ttl = 0;
  }

  async #call(fn, args = [], { key, keepalive = false } = {}) {
    let res;
    try {
      res = await fetch(this.url + '/api/' + fn, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Crate-Key': encodeURIComponent(key ?? store.get(KEY_STORE, '')) },
        body: JSON.stringify({ args }),
        keepalive,
      });
    } catch (e) {
      throw Object.assign(new Error('通信できませんでした（電波を確認してください）'), { code: 'network' });
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = j.code || (res.status === 401 ? 'unauthorized' : 'http_' + res.status);
      if (code === 'unauthorized' && key == null) window.dispatchEvent(new Event('crate:unauthorized'));
      throw Object.assign(new Error(j.error || 'HTTP ' + res.status), { code, status: res.status });
    }
    return j.result;
  }

  #setUrls(urls, ttl) {
    this.urls = { ...this.urls, ...urls };
    this.ttl = ttl;
    this.urlsAt = Date.now();
  }
  #ageSec() { return (Date.now() - this.urlsAt) / 1000; }

  async checkKey(key) {
    try { await this.#call('checkKey', [], { key }); return true; } catch (e) {
      if (e.code === 'unauthorized') return false;
      throw e;
    }
  }

  async loadLibrary() {
    const r = await this.#call('loadLibrary');
    this.#setUrls(r.urls, r.ttl);
    return r.lib;
  }

  async saveLibrary(lib, { keepalive = false } = {}) {
    const r = await this.#call('saveLibrary', [lib, null], { keepalive });
    return { lib: r.lib || null, restored: r.restored || 0 };
  }

  needsFreshUrl(track) {
    if (!track || track.kind !== 'file') return false;
    return !this.urls[track.ref] || this.#ageSec() > this.ttl - REFRESH_MARGIN_SEC;
  }

  async refreshUrls(extra = []) {
    const files = [...new Set([...Object.keys(this.urls), ...extra])];
    if (!files.length) return;
    const r = await this.#call('streamUrls', [files]);
    this.#setUrls(r.urls, r.ttl);
  }

  async getStreamUrl(track) {
    if (this.needsFreshUrl(track)) await this.refreshUrls([track.ref]);
    const u = this.urls[track.ref];
    if (!u) throw Object.assign(new Error('曲のURLを出せませんでした'), { code: 'no_url' });
    return u;
  }

  async fetchYouTubeMeta(videoId) { return this.#call('ytMeta', [videoId]); }
}

export function createApi() {
  const cfg = window.CRATE_CONFIG || {};
  const q = new URLSearchParams(location.search);
  if (q.get('mock') === '1' || !cfg.workerUrl) return new MockApi();
  return new WorkerApi(cfg.workerUrl);
}
