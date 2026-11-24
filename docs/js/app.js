// Crate — 画面の組み立てと操作。データは api.js、再生は player.js に任せる。
import { $, esc, fmt, hashHue, norm, parseYouTubeId, store, ytThumb } from './util.js';
import { ICONS, ic, fillIcons } from './ui/icons.js';
import { openSheet, actionSheet, promptSheet, toast, watchKeyboard, sheetIsOpen } from './ui/sheet.js';
import { enableReorder } from './ui/reorder.js';
import { createApi } from './data/api.js';
import { Library } from './data/library.js';
import { Player } from './player/player.js';

const KEY_STORE = 'crate.key';

const api = createApi();
const lib = new Library(api);
const player = new Player({ api, lib, audioEl: $('#audio'), ytMountId: 'yt-mount' });

const ui = {
  tab: 'library',      // library | playlists
  plId: null,          // 開いているプレイリスト
  edit: false,         // プレイリストの編集モード
  query: '',
  filter: 'all',       // all | file | youtube
  fullOpen: false,
  queueOpen: false,
  loaded: false,
  booted: false,
};

const main = $('#main');
const full = $('#full');

// ================= 部品 =================
const isCur = (t) => player.current?.id === t.id;

function thumbHTML(t, big = false) {
  if (t.kind === 'youtube') {
    return `<img src="${ytThumb(t.ref)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'art',style:'--h:0',textContent:'▶'}))">`;
  }
  const ch = [...(t.title || '?')][0];
  return `<div class="art" style="--h:${hashHue(t.title + t.artist)}">${esc(big ? ch : ch)}</div>`;
}

function kindTag(t) {
  return t.kind === 'youtube' ? '<span class="kind yt">YT</span>' : '<span class="kind file">MY</span>';
}

function eqHTML() {
  return `<span class="eq ${player.status === 'playing' ? '' : 'paused'}"><i></i><i></i><i></i></span>`;
}

function playIconHTML() {
  if (player.status === 'loading') return '<span class="spinner"></span>';
  return ic(player.status === 'playing' ? 'pause' : 'play');
}

/** 曲の行。ctx は 'lib' | 'pl'、edit で並べ替え用の見た目 */
function rowHTML(t, i, { ctx, edit = false } = {}) {
  const cur = isCur(t);
  return `<div class="row ${cur ? 'is-current' : ''} ${t.unplayable ? 'is-bad' : ''}" ${edit ? '' : `data-act="play-row" data-ctx="${ctx}"`} data-id="${t.id}" data-index="${i}">
    ${edit ? `<button class="row-minus" data-act="pl-remove" data-index="${i}" aria-label="外す">−</button>` : ''}
    <div class="thumb">${thumbHTML(t)}</div>
    <div class="row-main">
      <div class="row-title">${esc(t.title)}</div>
      <div class="row-sub">${cur ? eqHTML() : ''}${kindTag(t)}${t.unplayable ? '<span class="bad-tag">再生不可</span>' : ''}<span>${esc(t.artist || '')}</span></div>
    </div>
    <div class="row-dur">${fmt(t.duration)}</div>
    ${edit
      ? `<span class="handle" aria-label="並べ替え">${ICONS.handle}</span>`
      : `<button class="icon-btn" data-act="more" data-id="${t.id}" data-index="${i}" data-ctx="${ctx}" aria-label="メニュー">${ic('more')}</button>`}
  </div>`;
}

function coverHTML(tracks) {
  if (!tracks.length) return `<div class="pl-cover one"><div class="art" style="--h:220">${ICONS.note}</div></div>`;
  if (tracks.length < 4) return `<div class="pl-cover one">${thumbHTML(tracks[0])}</div>`;
  return `<div class="pl-cover">${tracks.slice(0, 4).map((t) => thumbHTML(t)).join('')}</div>`;
}

function totalMin(tracks) {
  const s = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  const unknown = tracks.some((t) => !t.duration);
  return (s < 60 ? Math.round(s) + '秒' : Math.round(s / 60) + '分') + (unknown ? '＋α' : '');
}

// ================= 上の帯 =================
function renderTop() {
  const left = $('#top-left'), title = $('#top-title'), right = $('#top-right');
  const saveTxt = lib.saveState === 'saving' ? '<span class="save-dot">保存中…</span>'
    : lib.saveState === 'error' ? '<span class="save-dot" style="color:var(--danger)">保存失敗</span>' : '';
  if (ui.plId) {
    const pl = lib.playlistById(ui.plId);
    left.innerHTML = `<button class="back" data-act="back">${ic('back')}<span>戻る</span></button>`;
    title.textContent = ui.edit ? '編集中' : (pl?.name || '');
    right.innerHTML = `${saveTxt}<button class="text-btn" data-act="pl-edit">${ui.edit ? '完了' : '編集'}</button>`;
  } else {
    left.innerHTML = `${api.isMock ? '<span class="mock-badge">モック</span>' : ''}${saveTxt}`;
    title.textContent = ui.tab === 'library' ? 'ライブラリ' : 'プレイリスト';
    right.innerHTML = `<button class="icon-btn" data-act="yt-add" aria-label="YouTubeを追加">${ic('plus')}</button>
      <button class="icon-btn" data-act="settings" aria-label="設定">${ic('gear')}</button>`;
  }
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === ui.tab));
}

// ================= 本体 =================
function renderMain({ keepSearch = true } = {}) {
  if (!ui.loaded) return;
  if (ui.tab === 'library' && !ui.plId) {
    if (keepSearch && $('#q')) { renderLibList(); return; }
    main.innerHTML = `
      <div class="search-wrap">
        <label class="search">${ic('search')}<input id="q" type="search" placeholder="曲名・アーティストで探す" value="${esc(ui.query)}" autocomplete="off" enterkeyhint="search">
          <button class="clear" data-act="search-clear" aria-label="消す" ${ui.query ? '' : 'hidden'}>${ic('x')}</button></label>
        <div class="chips">
          ${[['all', 'すべて'], ['file', '自分の曲'], ['youtube', 'YouTube']].map(([k, l]) => `<button class="chip ${ui.filter === k ? 'is-on' : ''}" data-act="filter" data-f="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <div id="lib-list"></div>`;
    renderLibList();
    return;
  }
  if (ui.plId) { renderPlaylistDetail(); return; }
  renderPlaylists();
}

function filteredTracks() {
  const q = norm(ui.query.trim());
  return lib.tracks.filter((t) => (ui.filter === 'all' || t.kind === ui.filter)
    && (!q || norm(t.title).includes(q) || norm(t.artist).includes(q)));
}

function renderLibList() {
  const box = $('#lib-list');
  if (!box) return;
  const list = filteredTracks();
  const clear = main.querySelector('[data-act="search-clear"]');
  if (clear) clear.hidden = !ui.query;
  if (!list.length) {
    box.innerHTML = ui.query
      ? `<div class="empty"><b>見つかりません</b>「${esc(ui.query)}」に一致する曲はありません</div>`
      : `<div class="empty"><b>曲がありません</b>${ui.filter === 'youtube' ? '右上の ＋ から YouTube の曲を追加できます' : ''}</div>`;
    return;
  }
  box.innerHTML = `<div class="list-meta">${list.length}曲</div>` + list.map((t, i) => rowHTML(t, i, { ctx: 'lib' })).join('');
}

function renderPlaylists() {
  main.innerHTML = `
    <button class="pl-new" data-act="pl-new"><div class="pl-cover one">${ic('plus')}</div>新しいプレイリスト</button>
    ${lib.playlists.map((pl) => {
      const ts = lib.playlistTracks(pl);
      const my = ts.filter((t) => t.kind === 'file').length;
      return `<button class="pl-row" data-act="open-pl" data-id="${pl.id}">
        ${coverHTML(ts)}
        <div><div class="pl-name">${esc(pl.name)}</div><div class="pl-sub">${ts.length}曲${ts.length ? ` ・ 自分 ${my}／YouTube ${ts.length - my}` : ''}</div></div>
        <span class="chev ic">${ICONS.chev}</span></button>`;
    }).join('')}`;
}

function renderPlaylistDetail() {
  const pl = lib.playlistById(ui.plId);
  if (!pl) { ui.plId = null; ui.edit = false; renderAll(); return; }
  const ts = lib.playlistTracks(pl);
  const head = `<div class="pl-head">
      ${coverHTML(ts)}
      <h2>${esc(pl.name)}</h2>
      <p>${ts.length}曲${ts.length ? ' ・ ' + totalMin(ts) : ''}</p>
      ${ui.edit ? '' : `<div class="pl-actions">
        <button class="btn primary" data-act="pl-play" ${ts.length ? '' : 'disabled'}>${ic('play')}再生</button>
        <button class="btn" data-act="pl-shuffle" ${ts.length ? '' : 'disabled'}>${ic('shuffle')}シャッフル</button></div>`}
    </div>`;
  const body = ts.length
    ? `<div class="${ui.edit ? 'reorder-list' : ''}">${ts.map((t, i) => rowHTML(t, i, { ctx: 'pl', edit: ui.edit })).join('')}</div>`
    : `<div class="empty"><b>まだ曲がありません</b>ライブラリの曲の ⋯ から「プレイリストに追加」で入れられます<br><button class="btn" data-act="tab" data-tab="library">ライブラリへ</button></div>`;
  const tools = ui.edit ? `<div class="pl-edit-tools">
      <button class="btn" data-act="pl-rename">${ic('edit')}名前を変更</button>
      <button class="btn danger" data-act="pl-delete">${ic('trash')}削除</button></div>` : '';
  main.innerHTML = head + body + tools;
}

// ================= ミニプレーヤー =================
function renderMini() {
  const mini = $('#mini');
  const t = player.current;
  if (!t || !ui.loaded) { mini.hidden = true; return; }
  mini.hidden = false;
  const waiting = player.status === 'waiting';
  const yt = t.kind === 'youtube';
  mini.className = 'mini' + (waiting ? ' waiting' : '');
  mini.innerHTML = `${yt ? '<div id="mini-video" class="mini-video"></div>' : ''}
    <div class="mini-row" data-act="${waiting ? 'resume' : 'full-open'}">
      <div class="thumb sm">${thumbHTML(t)}</div>
      <div class="mini-text">
        <div class="mini-title">${waiting ? '▶ タップで続きを再生' : esc(t.title)}</div>
        <div class="mini-sub">${waiting ? esc(t.title) + (yt ? '（YouTube）' : '') : esc(t.artist || '')}</div>
      </div>
      <button class="icon-btn" data-act="toggle" aria-label="再生・一時停止">${playIconHTML()}</button>
      <button class="icon-btn" data-act="next" aria-label="次の曲">${ic('next')}</button>
    </div>
    <div class="mini-progress"><i id="mini-prog"></i></div>`;
  renderTime();
}

// ================= フル再生画面 =================
function renderFull() {
  const t = player.current;
  full.classList.toggle('open', ui.fullOpen && !!t);
  document.body.classList.toggle('full-open', ui.fullOpen && !!t);
  full.setAttribute('aria-hidden', String(!ui.fullOpen));
  if (!t) return;
  const yt = t.kind === 'youtube';
  $('#full-src').textContent = player.ctx.label || '—';
  const art = $('#full-art');
  art.classList.toggle('is-video', yt);
  const artKey = yt ? 'yt' : t.id;
  if (art.dataset.key !== artKey) { art.dataset.key = artKey; art.innerHTML = yt ? '' : thumbHTML(t, true); }
  const wait = $('#full-wait');
  wait.hidden = player.status !== 'waiting';
  wait.textContent = yt
    ? '自動では再生できませんでした。画面をつけたまま、下の ▶ か動画の ▶ を押してください'
    : '自動では再生できませんでした。▶ を押すと続きから鳴ります';
  $('#full-title').textContent = t.title;
  $('#full-artist').textContent = t.artist || '';
  $('#btn-play').innerHTML = playIconHTML();
  $('#btn-shuffle').classList.toggle('is-on', player.shuffle);
  const rp = $('#btn-repeat');
  rp.classList.toggle('is-on', player.repeat !== 'off');
  rp.classList.toggle('one', player.repeat === 'one');
  $('#kind-label').textContent = yt ? 'YouTube' : '自分の曲';
  const air = $('#btn-airplay');
  air.hidden = yt || typeof $('#audio').webkitShowPlaybackTargetPicker !== 'function';
  $('#pane-player').hidden = ui.queueOpen;
  $('#pane-queue').hidden = !ui.queueOpen;
  $('#queue-toggle').classList.toggle('is-on', ui.queueOpen);
  $('#queue-art').classList.toggle('no-video', !yt);
  if (ui.queueOpen) renderQueue();
  renderTime();
}

function qRow(t, act, i, removable) {
  return `<div class="row ${t.unplayable ? 'is-bad' : ''}" ${act ? `data-act="${act}" data-i="${i}"` : ''}>
    <div class="thumb sm">${thumbHTML(t)}</div>
    <div class="row-main"><div class="row-title">${esc(t.title)}</div>
      <div class="row-sub">${kindTag(t)}<span>${esc(t.artist || '')}</span></div></div>
    ${removable ? `<button class="q-x" data-act="q-up-x" data-i="${i}" aria-label="キューから外す">${ic('x')}</button>` : `<div class="row-dur">${fmt(t.duration)}</div>`}
  </div>`;
}

function renderQueue() {
  const t = player.current;
  let html = '';
  if (t) html += `<div class="q-head"><h3>再生中</h3></div><div class="row is-current"><div class="thumb sm">${thumbHTML(t)}</div>
    <div class="row-main"><div class="row-title">${esc(t.title)}</div><div class="row-sub">${eqHTML()}${kindTag(t)}<span>${esc(t.artist || '')}</span></div></div></div>`;
  if (player.upNext.length) {
    html += `<div class="q-head"><h3>次に再生</h3><button class="text-btn" data-act="q-clear">クリア</button></div>`;
    html += player.upNext.map((id, i) => { const x = lib.trackById(id); return x ? qRow(x, 'q-up', i, true) : ''; }).join('');
  }
  const { order, index, label } = player.ctx;
  const rest = [];
  for (let i = index + 1; i < order.length && rest.length < 100; i++) rest.push(i);
  if (player.repeat === 'all') for (let i = 0; i <= index && rest.length < 100; i++) rest.push(i);
  html += `<div class="q-head"><h3>続き：<b>${esc(label || '—')}</b>${player.shuffle ? '（シャッフル）' : ''}</h3></div>`;
  html += rest.length
    ? rest.map((i) => { const x = lib.trackById(order[i]); return x ? qRow(x, 'q-ctx', i, false) : ''; }).join('')
    : '<div class="empty" style="padding:24px">このあとに再生する曲はありません</div>';
  $('#queue-list').innerHTML = html;
}

// ================= 時間の表示 =================
const seekEl = $('#seek');
let seekDrag = null;

function renderTime() {
  const d = player.duration, tm = player.status === 'idle' ? 0 : (player.time || 0);
  const pct = d ? Math.min(100, (tm / d) * 100) : 0;
  const mp = $('#mini-prog');
  if (mp) mp.style.width = pct + '%';
  seekEl.classList.toggle('disabled', !d);
  if (!seekDrag) {
    $('#seek-fill').style.width = pct + '%';
    $('#seek-knob').style.left = pct + '%';
    $('#t-cur').textContent = fmt(tm);
  }
  $('#t-dur').textContent = fmt(d);
}

seekEl.addEventListener('pointerdown', (e) => {
  if (!player.duration) return;
  seekDrag = { frac: 0 };
  seekEl.classList.add('active');
  seekEl.setPointerCapture(e.pointerId);
  seekMove(e);
});
function seekMove(e) {
  if (!seekDrag) return;
  const r = seekEl.querySelector('.seek-track').getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  seekDrag.frac = f;
  $('#seek-fill').style.width = f * 100 + '%';
  $('#seek-knob').style.left = f * 100 + '%';
  const b = $('#seek-bubble');
  b.hidden = false;
  b.style.left = f * 100 + '%';
  b.textContent = fmt(f * player.duration);
  $('#t-cur').textContent = fmt(f * player.duration);
}
function seekEnd() {
  if (!seekDrag) return;
  const f = seekDrag.frac;
  seekDrag = null;
  seekEl.classList.remove('active');
  $('#seek-bubble').hidden = true;
  if (player.duration) player.seek(f * player.duration);
}
seekEl.addEventListener('pointermove', seekMove);
seekEl.addEventListener('pointerup', seekEnd);
seekEl.addEventListener('pointercancel', seekEnd);

// ================= YouTube の小窓の位置合わせ =================
const stage = $('#yt-stage');
function positionYT() {
  const t = player.current;
  if (!t || t.kind !== 'youtube') { stage.className = 'yt-stage off'; return; }
  const slot = ui.fullOpen ? (ui.queueOpen ? $('#queue-art') : $('#full-art')) : $('#mini-video');
  if (!slot || slot.offsetParent === null) { stage.className = 'yt-stage off'; return; }
  const r = slot.getBoundingClientRect();
  stage.className = 'yt-stage on ' + (ui.fullOpen ? 'z-full' : 'z-mini');
  stage.style.left = r.left + 'px';
  stage.style.top = r.top + 'px';
  stage.style.width = r.width + 'px';
  stage.style.height = r.height + 'px';
}
let followUntil = 0;
function followYT(ms = 420) {
  const start = !followUntil || followUntil < performance.now();
  followUntil = performance.now() + ms;
  if (!start) return;
  const loop = () => { positionYT(); if (performance.now() < followUntil) requestAnimationFrame(loop); else followUntil = 0; };
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => followYT(100));

// ================= フル画面の開け閉め =================
function openFull() { if (!player.current) return; ui.fullOpen = true; renderFull(); followYT(); }
function closeFull() { ui.fullOpen = false; ui.queueOpen = false; renderFull(); followYT(); }

(() => {
  const top = $('#full-top');
  let sy = null, dy = 0;
  top.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    sy = e.clientY; dy = 0;
    full.classList.add('dragging');
    top.setPointerCapture(e.pointerId);
  });
  top.addEventListener('pointermove', (e) => {
    if (sy == null) return;
    dy = Math.max(0, e.clientY - sy);
    full.style.transform = `translateY(${dy}px)`;
    positionYT();
  });
  const end = () => {
    if (sy == null) return;
    sy = null;
    full.classList.remove('dragging');
    full.style.transform = '';
    if (dy > 100) closeFull(); else followYT(350);
  };
  top.addEventListener('pointerup', end);
  top.addEventListener('pointercancel', end);
})();

// ================= メニュー・シート =================
function trackMenu(t, { ctx, index }) {
  const yt = t.kind === 'youtube';
  const inPl = ctx === 'pl' && ui.plId;
  const items = [
    { icon: 'next_up', label: '次に再生', onClick: () => { player.addNext(t.id); toast('次に再生します'); } },
    { icon: 'add_end', label: 'キューの最後に追加', onClick: () => { player.addToEnd(t.id); toast('キューの最後に追加しました'); } },
    { icon: 'add_pl', label: 'プレイリストに追加…', onClick: () => addToPlaylistSheet(t) },
  ];
  if (yt) {
    items.push({ icon: 'edit', label: '曲名・アーティストを直す', onClick: () => editYtSheet(t) });
    items.push({ icon: 'open', label: 'YouTube で開く', onClick: () => window.open('https://www.youtube.com/watch?v=' + encodeURIComponent(t.ref), '_blank', 'noopener') });
  }
  if (inPl) {
    const plId = ui.plId;
    items.push({ icon: 'remove', label: 'このリストから外す', danger: true, onClick: () => {
      const snap = lib.snapshot();
      lib.removeFromPlaylist(plId, index);
      toast('リストから外しました', { action: '元に戻す', onAction: () => lib.restore(snap) });
    } });
  } else if (yt) {
    items.push({ icon: 'trash', label: 'ライブラリから削除', danger: true, onClick: () => {
      const snap = lib.snapshot();
      player.forget(t.id);
      lib.removeTrack(t.id);
      toast('ライブラリから削除しました', { action: '元に戻す', onAction: () => lib.restore(snap) });
    } });
  }
  actionSheet({ title: t.title, sub: t.artist, items });
}

function addToPlaylistSheet(t) {
  const items = [{ icon: 'plus', label: '新しいプレイリスト…', onClick: () => promptSheet({
    title: '新しいプレイリスト', label: '名前', okLabel: '作って追加',
    onOk: (name) => { const pl = lib.createPlaylist(name); lib.addToPlaylist(pl.id, t.id); toast(`「${pl.name}」を作って追加しました`); },
  }) }];
  lib.playlists.forEach((pl) => {
    const has = pl.trackIds.includes(t.id);
    items.push({
      icon: 'playlist', label: pl.name, right: has ? '追加済み' : '',
      onClick: () => {
        if (has) { toast('すでに入っています'); return; }
        lib.addToPlaylist(pl.id, t.id);
        toast(`「${pl.name}」に追加しました`);
      },
    });
  });
  actionSheet({ title: 'プレイリストに追加', sub: t.title, items });
}

function editYtSheet(t) {
  openSheet({
    title: '曲名・アーティストを直す',
    html: `<form><div class="field"><label>曲名</label><input name="title" value="${esc(t.title)}" maxlength="120" autocomplete="off"></div>
      <div class="field"><label>アーティスト</label><input name="artist" value="${esc(t.artist || '')}" maxlength="80" autocomplete="off"></div>
      <button class="btn primary wide" type="submit">保存</button></form>`,
    onMount(el, close) {
      el.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target;
        if (!f.title.value.trim()) { f.title.focus(); return; }
        lib.updateTrack(t.id, { title: f.title.value.trim(), artist: f.artist.value.trim() });
        close();
        toast('直しました');
      });
    },
  });
}

function ytAddSheet() {
  openSheet({
    title: 'YouTube の曲を追加',
    html: `
      <div class="field"><label>YouTube の URL</label>
        <div class="row-in"><input id="yt-url" inputmode="url" placeholder="https://youtu.be/…" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="btn" type="button" id="yt-paste">貼り付け</button></div></div>
      <p class="hint" id="yt-hint">YouTube アプリの「共有 → コピー」で取れる URL を貼ってください。</p>
      <div id="yt-result"></div>
      <button class="btn primary wide" id="yt-ok" disabled>追加</button>
      ${api.isMock ? '<p class="info">モックでは決まった動画だけ曲名を取得できます（例: youtu.be/M7lc1UVf-VE）。ほかの動画は「手で入力」の流れを試せます。</p>' : ''}`,
    onMount(el, close) {
      const input = el.querySelector('#yt-url'), hint = el.querySelector('#yt-hint');
      const result = el.querySelector('#yt-result'), ok = el.querySelector('#yt-ok');
      let videoId = null, timer = null, token = 0;
      const setHint = (msg, cls = '') => { hint.textContent = msg; hint.className = 'hint ' + cls; };
      const fields = (title = '', artist = '') => {
        result.innerHTML = `<div class="yt-preview"><img src="${ytThumb(videoId)}" alt=""><div style="min-width:0;font-size:13px;color:var(--muted)">動画ID ${esc(videoId)}</div></div>
          <div class="field"><label>曲名</label><input id="yt-title" value="${esc(title)}" maxlength="120" autocomplete="off"></div>
          <div class="field"><label>アーティスト</label><input id="yt-artist" value="${esc(artist)}" maxlength="80" autocomplete="off"></div>`;
        const ti = result.querySelector('#yt-title');
        const sync = () => { ok.disabled = !ti.value.trim(); };
        ti.addEventListener('input', sync);
        sync();
      };
      const check = async () => {
        const v = input.value.trim();
        videoId = null; result.innerHTML = ''; ok.disabled = true;
        const my = ++token;
        if (!v) { setHint('YouTube アプリの「共有 → コピー」で取れる URL を貼ってください。'); return; }
        const id = parseYouTubeId(v);
        if (!id) { setHint('YouTube の URL ではないようです', 'err'); return; }
        if (lib.hasVideo(id)) { setHint('この動画はすでにライブラリにあります', 'err'); return; }
        videoId = id;
        setHint('曲名を取得しています…');
        result.innerHTML = '<div class="yt-preview"><span class="spinner"></span></div>';
        try {
          const m = await api.fetchYouTubeMeta(id);
          if (my !== token) return;
          setHint('取得しました。必要なら直してください', 'ok');
          fields(m.title, m.author);
        } catch {
          if (my !== token) return;
          setHint('曲名を取得できませんでした。手で入力してください', 'err');
          fields();
        }
      };
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 350); });
      el.querySelector('#yt-paste').addEventListener('click', async () => {
        try { input.value = await navigator.clipboard.readText(); check(); }
        catch { toast('貼り付けできませんでした。入力欄を長押しして貼り付けてください'); input.focus(); }
      });
      ok.addEventListener('click', () => {
        const title = el.querySelector('#yt-title')?.value.trim();
        if (!videoId || !title) return;
        const t = lib.addYouTube({ videoId, title, artist: el.querySelector('#yt-artist')?.value || '' });
        close();
        toast('ライブラリに追加しました', { action: 'プレイリストへ', onAction: () => addToPlaylistSheet(t) });
      });
      setTimeout(() => input.focus(), 280);
    },
  });
}

function settingsSheet() {
  openSheet({
    title: '設定',
    html: `
      <div class="switch-row"><div>画面オフ中は YouTube を飛ばす<small>オフなら、YouTube の番で止まって待ちます</small></div>
        <button class="switch ${player.settings.skipYtWhenHidden ? 'on' : ''}" id="sw-skip" role="switch" aria-checked="${player.settings.skipYtWhenHidden}"></button></div>
      <div class="act-list">
        <button class="act" id="st-key">${ic('key')}<span>合言葉を入れ直す</span></button>
        <button class="act" id="st-reload">${ic('reset')}<span>一覧を読み込み直す（Mac で足した曲を反映）</span></button>
        ${api.isMock ? `<button class="act danger" id="st-reset">${ic('trash')}<span>モックのデータを最初に戻す</span></button>` : ''}
      </div>
      <p class="info">Crate ${api.isMock ? 'モック' : ''} v0.2 ・ ${lib.tracks.length}曲 ・ プレイリスト ${lib.playlists.length}${api.isMock ? '' : '<br>本番の画面です。モックは URL の末尾に ?mock=1'}</p>`,
    onMount(el, close) {
      const sw = el.querySelector('#sw-skip');
      sw.addEventListener('click', () => {
        const v = !player.settings.skipYtWhenHidden;
        player.setSetting('skipYtWhenHidden', v);
        sw.classList.toggle('on', v);
        sw.setAttribute('aria-checked', String(v));
      });
      el.querySelector('#st-key').addEventListener('click', () => { store.del(KEY_STORE); close(); showGate(); });
      el.querySelector('#st-reload').addEventListener('click', async () => {
        close();
        await lib.flush();
        try { await lib.load(); lib.changed({ save: false }); toast('読み込み直しました'); }
        catch (e) { toast('読み込めませんでした（' + e.message + '）'); }
      });
      el.querySelector('#st-reset')?.addEventListener('click', () => {
        api.resetMock();
        store.del('crate.resume');
        location.reload();
      });
    },
  });
}

// ================= 操作（クリックをまとめて受ける） =================
const actions = {
  tab: (b) => { ui.tab = b.dataset.tab; ui.plId = null; ui.edit = false; renderAll({ fresh: true }); main.scrollTop = 0; },
  filter: (b) => { ui.filter = b.dataset.f; document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c === b)); renderLibList(); },
  'search-clear': () => { ui.query = ''; const q = $('#q'); if (q) { q.value = ''; q.focus(); } renderLibList(); },
  'play-row': (b) => {
    const id = b.dataset.id;
    if (b.dataset.ctx === 'pl') {
      const pl = lib.playlistById(ui.plId);
      if (!pl) return;
      player.playList(lib.playlistTracks(pl).map((t) => t.id), id, pl.name, 'pl:' + pl.id);
    } else {
      const label = ui.query ? `検索「${ui.query}」` : { all: 'ライブラリ', file: '自分の曲', youtube: 'YouTube' }[ui.filter];
      player.playList(filteredTracks().map((t) => t.id), id, label, 'library');
    }
  },
  more: (b) => { const t = lib.trackById(b.dataset.id); if (t) trackMenu(t, { ctx: b.dataset.ctx, index: +b.dataset.index }); },
  'open-pl': (b) => { ui.plId = b.dataset.id; ui.edit = false; renderAll({ fresh: true }); main.scrollTop = 0; },
  back: () => { ui.plId = null; ui.edit = false; renderAll({ fresh: true }); },
  'pl-new': () => promptSheet({ title: '新しいプレイリスト', label: '名前', okLabel: '作る', onOk: (n) => { lib.createPlaylist(n); toast('作りました'); } }),
  'pl-play': () => { const pl = lib.playlistById(ui.plId); pl && player.playAll(lib.playlistTracks(pl).map((t) => t.id), pl.name, 'pl:' + pl.id, { shuffle: false }); },
  'pl-shuffle': () => { const pl = lib.playlistById(ui.plId); pl && player.playAll(lib.playlistTracks(pl).map((t) => t.id), pl.name, 'pl:' + pl.id, { shuffle: true }); },
  'pl-edit': () => { ui.edit = !ui.edit; renderAll({ fresh: true }); },
  'pl-remove': (b) => {
    const snap = lib.snapshot();
    lib.removeFromPlaylist(ui.plId, +b.dataset.index);
    toast('リストから外しました', { action: '元に戻す', onAction: () => lib.restore(snap) });
  },
  'pl-rename': () => { const pl = lib.playlistById(ui.plId); pl && promptSheet({ title: '名前を変更', label: '名前', value: pl.name, okLabel: '変更', onOk: (n) => lib.renamePlaylist(pl.id, n) }); },
  'pl-delete': () => {
    const pl = lib.playlistById(ui.plId);
    if (!pl) return;
    const snap = lib.snapshot();
    ui.plId = null; ui.edit = false;
    lib.deletePlaylist(pl.id);
    renderAll({ fresh: true });
    toast(`「${pl.name}」を削除しました`, { action: '元に戻す', onAction: () => lib.restore(snap) });
  },
  'yt-add': () => ytAddSheet(),
  settings: () => settingsSheet(),
  'full-open': () => openFull(),
  'full-close': () => closeFull(),
  toggle: () => player.toggle(),
  resume: () => player.resume(),
  next: () => player.next(),
  prev: () => player.prev(),
  shuffle: () => player.toggleShuffle(),
  repeat: () => { player.cycleRepeat(); toast({ off: 'リピート：オフ', all: 'リピート：全体', one: 'リピート：1曲' }[player.repeat], { duration: 1500 }); },
  'queue-toggle': () => { ui.queueOpen = !ui.queueOpen; renderFull(); followYT(100); },
  airplay: () => $('#audio').webkitShowPlaybackTargetPicker?.(),
  'q-up': (b) => player.jumpUpNext(+b.dataset.i),
  'q-up-x': (b) => player.removeUpNext(+b.dataset.i),
  'q-ctx': (b) => player.jumpCtx(+b.dataset.i),
  'q-clear': () => player.clearUpNext(),
  retry: () => boot(),
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const fn = actions[b.dataset.act];
  if (fn) { e.preventDefault(); fn(b); }
});

main.addEventListener('input', (e) => {
  if (e.target.id === 'q') { ui.query = e.target.value; renderLibList(); }
});
main.addEventListener('keydown', (e) => { if (e.target.id === 'q' && e.key === 'Enter') e.target.blur(); });

enableReorder(main, (from, to) => lib.movePlaylistItem(ui.plId, from, to));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.fullOpen && !sheetIsOpen()) closeFull();
  if (e.key === ' ' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '') && player.current) { e.preventDefault(); player.toggle(); }
});
document.addEventListener('touchstart', () => {}, { passive: true }); // iOS で :active を効かせる

// ================= 全体の描き直し =================
function renderAll({ fresh = false } = {}) {
  renderTop();
  renderMain({ keepSearch: !fresh });
  renderMini();
  renderFull();
  followYT(60);
}

lib.addEventListener('change', () => { renderMain(); renderFull(); renderMini(); renderTop(); });
lib.addEventListener('savestate', renderTop);
lib.addEventListener('toast', (e) => {
  const d = e.detail;
  if (typeof d === 'string') toast(d); else toast(d.msg, d);
});
// 合言葉が通らなくなった（変えた・消えた）→ 合言葉画面へ
window.addEventListener('crate:unauthorized', () => {
  store.del(KEY_STORE);
  showGate('合言葉が違うか、変わりました。もう一度入れてください');
});
player.addEventListener('change', () => {
  if (!ui.loaded) return;
  if (!player.current && ui.fullOpen) ui.fullOpen = false;
  renderMini(); renderFull();
  if (ui.tab === 'library' && !ui.plId) renderLibList(); else if (ui.plId && !ui.edit) renderPlaylistDetail();
  followYT(60);
});
player.addEventListener('time', renderTime);
player.addEventListener('toast', (e) => toast(e.detail));

new ResizeObserver(() => {
  document.documentElement.style.setProperty('--bottom-h', $('#bottom').offsetHeight + 'px');
  followYT(60);
}).observe($('#bottom'));

// ================= 起動 =================
function showGate(msg) {
  const gate = $('#gate');
  gate.hidden = false;
  const err = $('#gate-err');
  err.hidden = !msg;
  if (msg) err.textContent = msg;
  gate.querySelectorAll('.mock-only').forEach((x) => (x.hidden = !api.isMock));
  setTimeout(() => $('#gate-key').focus(), 50);
}
$('#gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('#gate-key').value;
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  let ok = false, why = '合言葉が違います';
  try { ok = await api.checkKey(key); } catch (err) { ok = false; why = err.message || '確かめられませんでした'; }
  btn.disabled = false;
  if (!ok) { $('#gate-err').textContent = why; $('#gate-err').hidden = false; return; }
  store.set(KEY_STORE, key);
  $('#gate-err').hidden = true;
  $('#gate-key').value = '';
  $('#gate').hidden = true;
  if (!ui.loaded) boot();
});

async function boot() {
  ui.booted = true;
  renderTop();
  main.innerHTML = '<div class="loading"><span class="spinner"></span>読み込み中…</div>';
  try {
    await lib.load();
    ui.loaded = true;
    renderAll({ fresh: true });
    player.restore();
  } catch (e) {
    if (e.code === 'unauthorized') { main.innerHTML = ''; return; } // 合言葉画面が出ている
    const why = e.code === 'github_auth' ? 'GitHub のトークンが期限切れです。Mac で作り直して登録してください'
      : e.code === 'network' ? '通信できませんでした。電波を確かめてください' : e.message;
    main.innerHTML = `<div class="empty"><b>読み込めませんでした</b>${esc(why)}<br><button class="btn" data-act="retry">もう一度</button></div>`;
  }
}

fillIcons();
watchKeyboard();
if (store.get(KEY_STORE, null)) boot(); else showGate();
