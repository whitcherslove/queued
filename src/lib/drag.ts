import { useRef, useState } from 'react';

interface Box { id: string; x: number; y: number; w: number; h: number }
interface DragState { list: string; id: string; start: number; over: number; dx: number; dy: number; boxes: Box[]; grid: boolean }

/** Pointer-based drag reorder. Rows carry data-rowid / data-list; the dragged row follows the finger and neighbours slide out of the way. */
export function useDragReorder(onDrop: (list: string, id: string, overId: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const ref = useRef(drag); ref.current = drag;
  const origin = useRef({ x: 0, y: 0 });

  const handle = (list: string, id: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-list="${list}"]`));
      const boxes = els.map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.rowid!, x: r.left, y: r.top, w: r.width, h: r.height }; });
      const start = boxes.findIndex((b) => b.id === id);
      const grid = boxes.length > 1 && Math.abs(boxes[0].y - boxes[1].y) < 4;
      origin.current = { x: e.clientX, y: e.clientY };
      if (navigator.vibrate) navigator.vibrate(8);
      setDrag({ list, id, start, over: start, dx: 0, dy: 0, boxes, grid });
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = ref.current; if (!d || d.id !== id) return;
      const dx = e.clientX - origin.current.x, dy = e.clientY - origin.current.y;
      const me = d.boxes[d.start];
      const cx = me.x + me.w / 2 + dx, cy = me.y + me.h / 2 + dy;
      let over = d.start;
      if (d.grid) {
        let best = Infinity;
        d.boxes.forEach((b, i) => { const dist = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy); if (dist < best) { best = dist; over = i; } });
      } else {
        over = d.boxes.filter((b, i) => i !== d.start && b.y + b.h / 2 < cy).length;
      }
      setDrag({ ...d, dx, dy, over });
    },
    onPointerUp: () => {
      const d = ref.current; if (!d || d.id !== id) return;
      setDrag(null);
      if (d.over !== d.start) onDrop(d.list, d.id, d.boxes[d.over].id);
    },
    onPointerCancel: () => setDrag(null)
  });

  /** Visual state for any row: transform + flags. */
  const look = (list: string, id: string): { style?: React.CSSProperties; dragging: boolean; target: boolean } => {
    const d = drag;
    if (!d || d.list !== list) return { dragging: false, target: false };
    if (id === d.id) return { dragging: true, target: false, style: { transform: `translate(${d.grid ? d.dx : 0}px, ${d.dy}px) scale(1.03)`, zIndex: 5, transition: 'none' } };
    const i = d.boxes.findIndex((b) => b.id === id);
    if (d.grid) return { dragging: false, target: i === d.over };
    const me = d.boxes[d.start], step = me.h + 8;
    let shift = 0;
    if (d.start < d.over && i > d.start && i <= d.over) shift = -step;
    if (d.over < d.start && i >= d.over && i < d.start) shift = step;
    return { dragging: false, target: false, style: { transform: `translateY(${shift}px)` } };
  };

  return { drag, handle, look };
}
