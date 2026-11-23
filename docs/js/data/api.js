// データの窓口。画面と再生のコードはここだけを呼ぶ。
// MockApi（ダミー）と WorkerApi（本番）を差し替えられるように、同じメソッドを持たせる。
//
//   checkKey(key)            合言葉が正しいか
//   loadLibrary()            { schemaVersion, tracks, playlists }
//   saveLibrary(lib)         一覧の保存（本番は Worker が GitHub の JSON にコミット）
//   getStreamUrl(track)      <audio> に渡すURL（本番は Worker が出す期限付きURL）
//   fetchYouTubeMeta(id)     { title, author }（本番は Worker が oEmbed を引く）
import { seedLibrary, SCHEMA_VERSION, YT_META } from './mock-data.js';
import { wait, store } from '../util.js';

const LS_LIB = 'crate.mock.library';

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
    return true;
  }

  async getStreamUrl(track) {
    return new URL('media/' + track.ref, location.href).href;
  }

  async fetchYouTubeMeta(videoId) {
    await wait(700);
    const m = YT_META[videoId];
    if (!m) throw new Error('not_found');
    return m;
  }

  resetMock() { store.del(LS_LIB); }
}

class WorkerApi {
  isMock = false;
  constructor(url) { this.url = url; }
  #todo() { throw new Error('本番の Worker はまだ作っていません'); }
  async checkKey() { this.#todo(); }
  async loadLibrary() { this.#todo(); }
  async saveLibrary() { this.#todo(); }
  async getStreamUrl() { this.#todo(); }
  async fetchYouTubeMeta() { this.#todo(); }
}

export function createApi() {
  const cfg = window.CRATE_CONFIG || {};
  const q = new URLSearchParams(location.search);
  if (q.get('mock') === '1' || !cfg.workerUrl) return new MockApi();
  return new WorkerApi(cfg.workerUrl);
}
