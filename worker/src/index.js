/**
 * Crate — Cloudflare Worker（crate-api）
 *
 * 役割: 非公開リポジトリ（crate-library）の曲を、期限付きURLで <audio> に流す中継。
 *       GitHub のトークンはここ（Secret）にだけ置き、画面には渡さない。
 *
 * 呼び方:
 *   POST /api/<関数名>  body: {"args": [...]}  ヘッダー X-Crate-Key: <合言葉（encodeURIComponent）>
 *        → 200 {"result": ...} | 4xx/5xx {"error": "..."}
 *   GET  /s/<ファイル名>?exp=<秒>&sig=<署名>   ← <audio src> に入れる。Range 対応
 *
 * Secret（npx wrangler secret put …）:
 *   GITHUB_TOKEN    fine-grained token（crate-library だけ・Contents 読み書き）
 *   CRATE_KEY       合言葉
 *   SIGNING_SECRET  期限付きURLの署名用（だれも覚えなくてよい）
 * 変数（wrangler.toml の [vars]）:
 *   ALLOWED_ORIGIN / GH_REPO / GH_BRANCH / URL_TTL_SEC
 *
 * 窓口: checkKey / loadLibrary / saveLibrary / streamUrls / ytMeta ／ GET /s/…（曲の中継）
 * 曲の取り先は raw.githubusercontent.com（api.github.com の raw は Range を無視して丸ごと返すため。Phase 0 で確認）。
 * 一覧（library.json）の読み書きは GitHub Contents API。
 *
 * 保存の決まり（設計メモ｜裏側.md）:
 *   ・使うのは1人なので、別の端末と食い違っても「画面の内容」を正にする（409 で止めない）
 *   ・ただしアプリからは消せない「自分の曲」（kind:file）は、サーバーにあって画面に無ければ足し戻す
 *     （Mac から曲を追加した後に、古い一覧のまま保存されても曲が消えないように）
 *   ・曲が急に半分以下に減る保存や、形の壊れた一覧は弾く
 */

const PUBLIC_FNS = ['checkKey', 'loadLibrary', 'saveLibrary', 'streamUrls', 'ytMeta'];
const SCHEMA_VERSION = 1;
const FILE_RE = /^[\w-]+\.(mp3|m4a)$/;
const TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---- 曲の中継（ヘッダー不要・CORS なし） ----
    const sm = url.pathname.match(/^\/s\/([^/]+)$/);
    if (sm && (request.method === 'GET' || request.method === 'HEAD')) {
      return streamFile_(request, env, decodeURIComponent(sm[1]), url.searchParams);
    }

    const cors = corsHeaders_(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET' && url.pathname === '/') return json_({ ok: true, app: 'crate-api' }, 200, cors);

    const m = url.pathname.match(/^\/api\/([A-Za-z]+)$/);
    if (!m || request.method !== 'POST') return json_({ error: 'not found' }, 404, cors);
    if (!env.CRATE_KEY || !env.GITHUB_TOKEN || !env.SIGNING_SECRET) {
      return json_({ error: 'Worker の設定が未完了です（GITHUB_TOKEN / CRATE_KEY / SIGNING_SECRET）' }, 500, cors);
    }
    let key = request.headers.get('X-Crate-Key') || '';
    try { key = decodeURIComponent(key); } catch (e) { /* そのまま */ }
    if (!safeEqual_(key, env.CRATE_KEY)) return json_({ error: 'unauthorized', code: 'unauthorized' }, 401, cors);

    const fn = m[1];
    if (!PUBLIC_FNS.includes(fn)) return json_({ error: 'unknown function: ' + fn }, 404, cors);
    let args = [];
    try { const b = await request.json(); if (b && Array.isArray(b.args)) args = b.args; } catch (e) { /* 引数なし */ }

    try {
      const result = await API[fn](env, url, ...args);
      return json_({ result: result === undefined ? null : result }, 200, cors);
    } catch (e) {
      console.error('[' + fn + '] ' + String((e && e.message) || e));
      const body = { error: String((e && e.message) || e).slice(0, 500) };
      if (e && e.code) body.code = e.code;
      return json_(body, (e && e.status) || 500, cors);
    }
  },
};

// ============ 窓口 ============
const API = {
  async checkKey() { return { ok: true }; },

  /** ファイル名の配列 → { ファイル名: 期限付きURL }、ttl（秒） */
  async streamUrls(env, url, files) {
    if (!Array.isArray(files)) throw new Error('files must be an array');
    const ttl = ttlSec_(env);
    const exp = expiry_(ttl);
    const out = {};
    for (const f of files.slice(0, 500)) {
      if (!FILE_RE.test(f)) continue;
      const sig = await sign_(env, f + '.' + exp);
      out[f] = `${url.origin}/s/${encodeURIComponent(f)}?exp=${exp}&sig=${sig}`;
    }
    return { urls: out, ttl, exp };
  },

  /** 一覧を読む。期限付きURLは一覧に混ぜず urls として別に返す（一覧にURLがコミットされないように） */
  async loadLibrary(env, url) {
    const cur = await readLibrary_(env);
    const files = cur.lib.tracks.filter((t) => t.kind === 'file').map((t) => t.ref);
    const s = await API.streamUrls(env, url, files);
    return { lib: cur.lib, sha: cur.sha, urls: s.urls, ttl: s.ttl, exp: s.exp };
  },

  /** 一覧を保存する。戻り値 { sha, lib: 足し戻した曲があれば保存した一覧（無ければ null）, restored: 足し戻した曲数 } */
  async saveLibrary(env, url, lib, baseSha) {
    const next = cleanLibrary_(lib);
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await readLibrary_(env);
      // サーバーにあって画面に無い「自分の曲」を足し戻す
      const have = new Set(next.tracks.map((t) => t.id));
      const missing = cur.lib.tracks.filter((t) => t.kind === 'file' && !have.has(t.id));
      const merged = missing.length ? { ...next, tracks: [...next.tracks, ...missing] } : next;
      // 曲が急に減っていないか
      if (cur.lib.tracks.length >= 6 && merged.tracks.length < cur.lib.tracks.length / 2) {
        throw httpError_(`曲の数が ${cur.lib.tracks.length} → ${merged.tracks.length} に急に減るので、保存を止めました`, 422, 'too_many_removed');
      }
      const res = await gh_(env, 'contents/library.json', {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Crate: 一覧を保存' + (missing.length ? `（自分の曲 ${missing.length} 件を足し戻し）` : ''),
          content: utf8ToB64_(JSON.stringify(merged, null, 2) + '\n'),
          branch: env.GH_BRANCH || 'main',
          ...(cur.sha ? { sha: cur.sha } : {}),
        }),
      });
      if (res.status === 409 || res.status === 422) continue; // 読んでから書くまでに先を越された → 読み直す
      if (!res.ok) throw await ghError_(res, '一覧の保存');
      const j = await res.json();
      return { sha: j.content.sha, lib: missing.length ? merged : null, restored: missing.length, conflict: !!(baseSha && cur.sha && baseSha !== cur.sha) };
    }
    throw httpError_('一覧の保存が3回続けて競合しました。少し待って、もう一度試してください', 409, 'conflict');
  },

  /** YouTube の曲名とチャンネル名（oEmbed） */
  async ytMeta(env, url, videoId) {
    if (!/^[\w-]{11}$/.test(String(videoId || ''))) throw httpError_('動画IDが正しくありません', 400, 'bad_id');
    const watch = 'https://www.youtube.com/watch?v=' + videoId;
    const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(watch), { headers: { 'User-Agent': 'crate-api' } });
    if (res.status === 401 || res.status === 403) throw httpError_('埋め込みが許可されていない動画です', 422, 'not_embeddable');
    if (res.status === 404 || res.status === 400) throw httpError_('動画が見つかりません（削除・非公開）', 404, 'not_found');
    if (!res.ok) throw httpError_('YouTube から曲名を取れませんでした（' + res.status + '）', 502, 'upstream');
    const j = await res.json();
    return { title: String(j.title || ''), author: String(j.author_name || '') };
  },
};

// ============ 一覧（library.json） ============
async function readLibrary_(env) {
  const res = await gh_(env, 'contents/library.json?ref=' + encodeURIComponent(env.GH_BRANCH || 'main'));
  if (res.status === 404) return { lib: { schemaVersion: SCHEMA_VERSION, tracks: [], playlists: [] }, sha: null };
  if (!res.ok) throw await ghError_(res, '一覧の読み込み');
  const j = await res.json();
  let lib;
  try { lib = JSON.parse(b64ToUtf8_(j.content || '')); } catch (e) { throw httpError_('library.json が壊れています（JSON として読めない）', 500, 'broken'); }
  return { lib: cleanLibrary_(lib), sha: j.sha };
}

/** 形を確かめ、決めた項目だけを残す（実行時の印や URL が混ざってもコミットしない） */
function cleanLibrary_(lib) {
  if (!lib || lib.schemaVersion !== SCHEMA_VERSION || !Array.isArray(lib.tracks) || !Array.isArray(lib.playlists)) {
    throw httpError_('一覧の形が正しくありません（schemaVersion / tracks / playlists）', 422, 'bad_library');
  }
  if (lib.tracks.length > 2000 || lib.playlists.length > 500) throw httpError_('一覧が大きすぎます', 422, 'too_large');
  const str = (v, max) => String(v ?? '').slice(0, max);
  const ids = new Set();
  const tracks = lib.tracks.map((t) => {
    if (!t || !t.id || ids.has(t.id)) throw httpError_('曲のIDが無いか重複しています: ' + (t && t.id), 422, 'bad_library');
    if (t.kind !== 'file' && t.kind !== 'youtube') throw httpError_('曲の種類が正しくありません: ' + t.id, 422, 'bad_library');
    if (t.kind === 'file' && !FILE_RE.test(t.ref)) throw httpError_('曲のファイル名が正しくありません: ' + t.id, 422, 'bad_library');
    if (t.kind === 'youtube' && !/^[\w-]{11}$/.test(t.ref)) throw httpError_('動画IDが正しくありません: ' + t.id, 422, 'bad_library');
    ids.add(t.id);
    const d = Number(t.duration);
    return { id: str(t.id, 64), kind: t.kind, ref: t.ref, title: str(t.title, 200), artist: str(t.artist, 120), duration: d > 0 ? Math.round(d) : null };
  });
  const playlists = lib.playlists.map((p) => {
    if (!p || !p.id || !Array.isArray(p.trackIds)) throw httpError_('プレイリストの形が正しくありません', 422, 'bad_library');
    return { id: str(p.id, 64), name: str(p.name, 100) || '名前なし', trackIds: [...new Set(p.trackIds.map(String))].filter((id) => ids.has(id)) };
  });
  return { schemaVersion: SCHEMA_VERSION, tracks, playlists };
}

// ============ GitHub ============
function gh_(env, path, init = {}) {
  const repo = env.GH_REPO || 'nagilife5s/crate-library';
  return fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'crate-api',
      'Cache-Control': 'no-cache',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}
async function ghError_(res, what) {
  const t = await res.text().catch(() => '');
  if (res.status === 401) return httpError_('GitHub のトークンが無効か期限切れです（作り直して GITHUB_TOKEN を登録し直す）', 502, 'github_auth');
  if (res.status === 403) return httpError_('GitHub に断られました（権限か回数制限）: ' + t.slice(0, 200), 502, 'github_forbidden');
  return httpError_(`${what}に失敗しました（GitHub ${res.status}）: ${t.slice(0, 200)}`, 502, 'github');
}
function httpError_(msg, status, code) { return Object.assign(new Error(msg), { status, code }); }
function b64ToUtf8_(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function utf8ToB64_(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ============ 曲の中継 ============
async function streamFile_(request, env, file, params) {
  if (!FILE_RE.test(file)) return text_('bad name', 400);
  if (!env.SIGNING_SECRET || !env.GITHUB_TOKEN) return text_('not configured', 500);
  const exp = Number(params.get('exp'));
  const sig = params.get('sig') || '';
  if (!exp || exp * 1000 < Date.now()) return text_('expired', 403);
  if (!safeEqual_(sig, await sign_(env, file + '.' + exp))) return text_('bad signature', 403);

  const repo = env.GH_REPO || 'nagilife5s/crate-library';
  const branch = env.GH_BRANCH || 'main';
  const headers = { Authorization: 'Bearer ' + env.GITHUB_TOKEN, 'User-Agent': 'crate-api' };
  const range = request.headers.get('Range');
  if (range) headers.Range = range;

  const up = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/music/${encodeURIComponent(file)}`, {
    method: request.method, headers,
  });
  if (up.status === 404) return text_('not found', 404);
  if (up.status === 401 || up.status === 403) return text_('github auth failed（トークンの期限切れ？）', 502);
  if (up.status === 416) return new Response(null, { status: 416, headers: { 'Content-Range': up.headers.get('Content-Range') || '' } });
  if (up.status !== 200 && up.status !== 206) return text_('upstream ' + up.status, 502);

  const ext = file.split('.').pop();
  const h = new Headers({
    'Content-Type': TYPES[ext] || 'application/octet-stream', // GitHub は text/plain などで返すので必ず上書き
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
  });
  for (const k of ['Content-Range', 'Content-Length', 'ETag', 'Last-Modified']) {
    const v = up.headers.get(k);
    if (v) h.set(k, v);
  }
  // 本文は加工せずそのまま流す（無料プランの CPU 10ms に触れない）
  return new Response(request.method === 'HEAD' ? null : up.body, { status: up.status, headers: h });
}

// ============ 署名 ============
function ttlSec_(env) {
  const n = Number(env.URL_TTL_SEC);
  return n > 0 ? n : 7 * 86400;
}
/** 1日以上の期限は日単位に丸める（同じ日なら URL が変わらない） */
function expiry_(ttl) {
  const now = Math.floor(Date.now() / 1000);
  if (ttl < 86400) return now + ttl;
  return Math.ceil((now + ttl) / 86400) * 86400;
}
let keyCache = null;
async function sign_(env, msg) {
  if (!keyCache || keyCache.secret !== env.SIGNING_SECRET) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache = { secret: env.SIGNING_SECRET, k };
  }
  const buf = await crypto.subtle.sign('HMAC', keyCache.k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ============ 小物 ============
function corsHeaders_(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Crate-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (ok) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json_(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...(headers || {}) } });
}
function text_(s, status) {
  return new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
