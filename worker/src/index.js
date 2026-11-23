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
 * 2026-11-24 Phase 0: checkKey / streamUrls / 曲の中継 だけ。
 * 取り先は raw.githubusercontent.com（api.github.com の raw は Range を無視して丸ごと返すため。Phase 0 で確認）。
 */

const PUBLIC_FNS = ['checkKey', 'streamUrls'];
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
      return json_({ error: String((e && e.message) || e).slice(0, 500) }, 500, cors);
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
};

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
