// Worker の手元テスト。GitHub と YouTube を偽物に差し替えて、本物のトークンなしで動かす。
// 使い方: node test/worker.test.mjs
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = {
  GITHUB_TOKEN: 'fake-token', CRATE_KEY: '合言葉テスト', SIGNING_SECRET: 'sign-secret',
  ALLOWED_ORIGIN: 'https://nagilife5s.github.io', GH_REPO: 'me/lib', GH_BRANCH: 'main', URL_TTL_SEC: '604800',
};
const ORIGIN = 'https://crate-api.example.workers.dev';

// ---- 偽の GitHub ----
const gh = { file: null, sha: null, n: 0, failNextPut: 0, puts: [] };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64').toString('utf8');
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = init.method || 'GET';
  if (url.startsWith('https://api.github.com/repos/me/lib/contents/library.json')) {
    assert.equal(init.headers.Authorization, 'Bearer fake-token');
    if (method === 'GET') {
      if (!gh.file) return new Response('{"message":"Not Found"}', { status: 404 });
      return Response.json({ content: b64(gh.file).replace(/(.{60})/g, '$1\n'), sha: gh.sha });
    }
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      if (gh.failNextPut > 0) { gh.failNextPut--; gh.sha = 'other-' + (++gh.n); return new Response('{"message":"conflict"}', { status: 409 }); }
      if ((body.sha || null) !== gh.sha) return new Response('{"message":"sha mismatch"}', { status: 409 });
      gh.file = unb64(body.content);
      gh.sha = 'sha-' + (++gh.n);
      gh.puts.push(body.message);
      return Response.json({ content: { sha: gh.sha } });
    }
  }
  if (url.startsWith('https://raw.githubusercontent.com/me/lib/main/music/')) {
    const range = init.headers.Range;
    return new Response('ab', { status: range ? 206 : 200, headers: { 'Content-Type': 'text/plain', 'Content-Range': 'bytes 0-1/100', 'Content-Length': '2', ETag: '"x"', 'X-Secret-Header': 'no' } });
  }
  if (url.startsWith('https://www.youtube.com/oembed')) {
    const id = new URL(new URL(url).searchParams.get('url')).searchParams.get('v');
    if (id === 'noEmbed0001') return new Response('Unauthorized', { status: 401 });
    if (id === 'missing0001') return new Response('Not Found', { status: 404 });
    return Response.json({ title: 'テストの曲', author_name: 'テストのチャンネル' });
  }
  throw new Error('想定外の fetch: ' + method + ' ' + url);
};

// ---- 呼び出し ----
async function call(fn, args = [], key = env.CRATE_KEY) {
  const res = await worker.fetch(new Request(`${ORIGIN}/api/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Crate-Key': encodeURIComponent(key), Origin: 'https://nagilife5s.github.io' },
    body: JSON.stringify({ args }),
  }), env);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const lib = (tracks, playlists = []) => ({ schemaVersion: 1, tracks, playlists });
const file = (id, title = id) => ({ id, kind: 'file', ref: id + '.mp3', title, artist: 'A', duration: 200 });
const yt = (id, ref) => ({ id, kind: 'youtube', ref, title: 'Y ' + id, artist: '', duration: null });

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok  ' + name); } catch (e) { console.log('NG  ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

await test('合言葉が違うと 401', async () => {
  const r = await call('checkKey', [], 'wrong');
  assert.equal(r.status, 401);
});
await test('CORS は github.io にだけ付く', async () => {
  const r = await call('checkKey');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://nagilife5s.github.io');
});
await test('library.json が無ければ空の一覧と sha=null', async () => {
  const r = await call('loadLibrary');
  assert.deepEqual(r.body.result.lib, lib([], []));
  assert.equal(r.body.result.sha, null);
});
await test('初回の保存（日本語・余計な項目は落とす）', async () => {
  const t = { ...file('t-a', '夜明けのプラットフォーム'), unplayable: true, url: 'https://leak' };
  const r = await call('saveLibrary', [lib([t, yt('y-1', 'jNQXAC9IVRw')], [{ id: 'p1', name: '通勤', trackIds: ['t-a', 'y-1', 't-a', 'nai'] }]), null]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const saved = JSON.parse(gh.file);
  assert.equal(saved.tracks[0].title, '夜明けのプラットフォーム');
  assert.equal(saved.tracks[0].unplayable, undefined);
  assert.equal(saved.tracks[0].url, undefined);
  assert.deepEqual(saved.playlists[0].trackIds, ['t-a', 'y-1'], '重複と存在しない曲は落ちる');
  assert.equal(r.body.result.sha, gh.sha);
});
await test('読み込みで自分の曲にだけ期限付きURLが付く（一覧には混ざらない）', async () => {
  const r = await call('loadLibrary');
  const { lib: l, urls, ttl } = r.body.result;
  assert.equal(ttl, 604800);
  assert.deepEqual(Object.keys(urls), ['t-a.mp3']);
  assert.ok(!JSON.stringify(l).includes('sig='));
});
await test('期限付きURLで曲を中継（Range・Content-Type 上書き・余計なヘッダーは渡さない）', async () => {
  const { urls } = (await call('loadLibrary')).body.result;
  const res = await worker.fetch(new Request(urls['t-a.mp3'], { headers: { Range: 'bytes=0-1' } }), env);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal(res.headers.get('Content-Range'), 'bytes 0-1/100');
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(res.headers.get('X-Secret-Header'), null);
  assert.equal(await res.text(), 'ab');
});
await test('署名を書き換えると 403', async () => {
  const { urls } = (await call('loadLibrary')).body.result;
  const bad = urls['t-a.mp3'].replace('t-a.mp3', 't-b.mp3');
  const res = await worker.fetch(new Request(bad), env);
  assert.equal(res.status, 403);
});
await test('Mac で足した自分の曲が画面に無くても、保存で消えない（足し戻す）', async () => {
  // Mac 側で曲を追加した状態を作る
  const cur = JSON.parse(gh.file);
  cur.tracks.push(file('t-mac', 'Mac で足した曲'));
  gh.file = JSON.stringify(cur); gh.sha = 'sha-mac';
  // 画面は古い一覧のまま、プレイリスト名だけ変えて保存
  const r = await call('saveLibrary', [lib([file('t-a', '夜明けのプラットフォーム'), yt('y-1', 'jNQXAC9IVRw')], [{ id: 'p1', name: '通勤（改）', trackIds: ['y-1', 't-a'] }]), 'sha-old']);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result.restored, 1);
  assert.equal(r.body.result.conflict, true);
  assert.ok(r.body.result.lib.tracks.some((t) => t.id === 't-mac'));
  const saved = JSON.parse(gh.file);
  assert.ok(saved.tracks.some((t) => t.id === 't-mac'));
  assert.equal(saved.playlists[0].name, '通勤（改）');
});
await test('YouTube の曲は画面から消せる（足し戻さない）', async () => {
  const r = await call('saveLibrary', [lib([file('t-a'), file('t-mac')], []), gh.sha]);
  assert.equal(r.status, 200);
  assert.equal(r.body.result.restored, 0);
  assert.ok(!JSON.parse(gh.file).tracks.some((t) => t.id === 'y-1'));
});
await test('読んでから書くまでに先を越されたら読み直して保存（409 を2回まで吸収）', async () => {
  gh.failNextPut = 2;
  const r = await call('saveLibrary', [lib([file('t-a'), file('t-mac'), yt('y-2', 'dQw4w9WgXcQ')]), gh.sha]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(JSON.parse(gh.file).tracks.some((t) => t.id === 'y-2'));
});
await test('409 が3回続いたら 409 で返す', async () => {
  gh.failNextPut = 3;
  const r = await call('saveLibrary', [lib([file('t-a'), file('t-mac')]), gh.sha]);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'conflict');
  gh.failNextPut = 0;
});
await test('曲が急に半分以下に減る保存は止める', async () => {
  const many = Array.from({ length: 8 }, (_, i) => yt('y-m' + i, 'abcdefghij' + i));
  await call('saveLibrary', [lib([file('t-a'), file('t-mac'), ...many]), gh.sha]);
  const r = await call('saveLibrary', [lib([file('t-a'), file('t-mac')]), gh.sha]);
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'too_many_removed');
});
await test('形の壊れた一覧は 422（schemaVersion / 種類 / ファイル名）', async () => {
  for (const bad of [
    { schemaVersion: 2, tracks: [], playlists: [] },
    lib([{ id: 'x', kind: 'video', ref: 'a' }]),
    lib([{ id: 'x', kind: 'file', ref: '../library.json' }]),
    lib([file('t-a'), file('t-a')]),
  ]) {
    const r = await call('saveLibrary', [bad, gh.sha]);
    assert.equal(r.status, 422, JSON.stringify(bad));
  }
});
await test('ytMeta: 取れる／埋め込み禁止／見つからない／IDが変', async () => {
  let r = await call('ytMeta', ['M7lc1UVf-VE']);
  assert.deepEqual(r.body.result, { title: 'テストの曲', author: 'テストのチャンネル' });
  r = await call('ytMeta', ['noEmbed0001']);
  assert.equal(r.body.code, 'not_embeddable');
  r = await call('ytMeta', ['missing0001']);
  assert.equal(r.body.code, 'not_found');
  r = await call('ytMeta', ['x"><script>']);
  assert.equal(r.status, 400);
});

console.log(`\n${passed} 件 ok`);
