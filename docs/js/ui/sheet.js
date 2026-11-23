// 下から出るシート・メニュー・トースト
import { $, esc } from '../util.js';
import { ic } from './icons.js';

let openCount = 0;
export const sheetIsOpen = () => openCount > 0;

/** 汎用のシート。html を中に入れ、onMount(el, close) で中身を動かす */
export function openSheet({ title = '', sub = '', html = '', onMount, onClose } = {}) {
  const host = $('#sheets');
  const back = document.createElement('div');
  back.className = 'backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.innerHTML = `<div class="grabber"></div>${title ? `<h2>${esc(title)}</h2>` : ''}${sub ? `<p class="sheet-sub">${esc(sub)}</p>` : ''}${html}`;
  host.append(back, sheet);
  openCount++;
  requestAnimationFrame(() => { back.classList.add('show'); sheet.classList.add('show'); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openCount--;
    back.classList.remove('show');
    sheet.classList.remove('show');
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    setTimeout(() => { back.remove(); sheet.remove(); }, 280);
    onClose && onClose();
  };
  back.addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  onMount && onMount(sheet, close);
  return { el: sheet, close };
}

/** ⋯ メニュー。items: [{ icon, label, danger, disabled, right, onClick }] */
export function actionSheet({ title, sub, items }) {
  const html = `<div class="act-list">${items.map((it, i) => `
      <button class="act ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
        ${it.icon ? ic(it.icon) : ''}<span>${esc(it.label)}</span>${it.right ? `<span class="right">${it.right}</span>` : ''}
      </button>`).join('')}</div>
    <button class="btn wide cancel" data-close>キャンセル</button>`;
  return openSheet({
    title, sub, html,
    onMount(el, close) {
      el.querySelectorAll('.act').forEach((b) => b.addEventListener('click', () => {
        const it = items[+b.dataset.i];
        if (it.keepOpen) { it.onClick && it.onClick(close); return; }
        close();
        it.onClick && setTimeout(() => it.onClick(), 0);
      }));
    },
  });
}

/** 一言の入力（プレイリスト名など） */
export function promptSheet({ title, label, value = '', okLabel = '決定', onOk }) {
  return openSheet({
    title,
    html: `<form class="p-form"><div class="field"><label>${esc(label)}</label><input name="v" value="${esc(value)}" maxlength="60" autocomplete="off"></div>
      <button class="btn primary wide" type="submit">${esc(okLabel)}</button></form>`,
    onMount(el, close) {
      const input = el.querySelector('input');
      setTimeout(() => { input.focus(); input.select(); }, 280);
      el.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) { input.focus(); return; }
        close();
        onOk(v);
      });
    },
  });
}

/** トースト。action を渡すと「元に戻す」などのボタンが付く */
export function toast(msg, { action, onAction, duration = 4000 } = {}) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  host.append(el);
  while (host.children.length > 2) host.firstElementChild.remove();
  const kill = () => el.remove();
  const t = setTimeout(kill, duration);
  if (action) el.querySelector('button').addEventListener('click', () => { clearTimeout(t); kill(); onAction && onAction(); });
}

/** キーボードが出たとき、シートを上に逃がす */
export function watchKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const upd = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
  };
  vv.addEventListener('resize', upd);
  vv.addEventListener('scroll', upd);
}
