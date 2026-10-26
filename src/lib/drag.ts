import { useRef, useState } from 'react';

/** Pointer-based drag reorder within one list. Rows carry data-rowid and data-list attributes. */
export function useDragReorder(onDrop: (list: string, id: string, overId: string) => void) {
  const [drag, setDrag] = useState<{ list: string; id: string; over: string } | null>(null);
  const ref = useRef(drag); ref.current = drag;
  const handle = (list: string, id: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag({ list, id, over: id }); },
    onPointerMove: (e: React.PointerEvent) => {
      const d = ref.current; if (!d || d.id !== id) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-rowid]') as HTMLElement | null;
      if (el && el.dataset.list === list && el.dataset.rowid && el.dataset.rowid !== d.over) setDrag({ ...d, over: el.dataset.rowid });
    },
    onPointerUp: () => { const d = ref.current; if (d && d.id === id) { setDrag(null); if (d.over !== d.id) onDrop(list, d.id, d.over); } },
    onPointerCancel: () => setDrag(null)
  });
  return { drag, handle };
}
