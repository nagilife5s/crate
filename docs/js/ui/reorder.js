// 並べ替え（編集モードのとき、行の右端のつまみ .handle だけで掴む）。
// HTML5 のドラッグ＆ドロップは iPhone のタッチで当てにならないので Pointer Events で自作する。
export function enableReorder(root, onMove) {
  root.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.handle');
    if (!h) return;
    const list = h.closest('.reorder-list');
    if (!list) return;
    e.preventDefault();
    const row = h.closest('.row');
    const rows = [...list.querySelectorAll(':scope > .row')];
    const from = rows.indexOf(row);
    const rects = rows.map((r) => r.getBoundingClientRect());
    const H = rects[from].height;
    const startY = e.clientY;
    let to = from;
    row.classList.add('dragging');
    h.setPointerCapture(e.pointerId);

    const move = (ev) => {
      const dy = ev.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      const center = rects[from].top + H / 2 + dy;
      to = from;
      for (let i = 0; i < rects.length; i++) {
        const mid = rects[i].top + rects[i].height / 2;
        if (i < from && center < mid) to = Math.min(to, i);
        if (i > from && center > mid) to = Math.max(to, i);
      }
      rows.forEach((r, i) => {
        if (r === row) return;
        let s = 0;
        if (from < to && i > from && i <= to) s = -H;
        if (from > to && i >= to && i < from) s = H;
        r.style.transform = s ? `translateY(${s}px)` : '';
      });
    };
    const up = () => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      rows.forEach((r) => (r.style.transform = ''));
      row.classList.remove('dragging');
      if (to !== from) onMove(from, to);
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  });
}
