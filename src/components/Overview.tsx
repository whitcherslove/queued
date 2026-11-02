import { useLayoutEffect, useRef, useState } from 'react';

/** Description clamped to 3 lines; "More / Less" appears only when the text really doesn't fit. */
export default function Overview({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const check = () => { if (!open) setOverflows(el.scrollHeight > el.clientHeight + 1); };
    check();
    const ro = new ResizeObserver(check); ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <div className="stack-sm">
      <p ref={ref} className={'overview' + (open ? ' open' : '')}>{text}</p>
      {(overflows || open) && <button className="link left" onClick={() => setOpen(!open)}>{open ? 'Less' : 'More'}</button>}
    </div>
  );
}
