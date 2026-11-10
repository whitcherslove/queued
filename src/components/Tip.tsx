import { useEffect, useState } from 'react';
import { TIPS, markTip, onTips, tipSeen } from '../lib/tips';

/** A small one-time hint above the bottom bar. Tap anywhere on it (or "Got it") to close; it won't come back. */
export default function Tip({ id, delay = 700, text }: { id: keyof typeof TIPS | string; delay?: number; text?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(!tipSeen(id)), delay);
    const off = onTips(() => setShow((v) => v && !tipSeen(id)));
    return () => { clearTimeout(t); off(); };
  }, [id, delay]);
  if (!show) return null;
  return (
    <button className="tip" role="status" onClick={() => { markTip(id); setShow(false); }}>
      <span className="tip-mark" aria-hidden="true">QD</span>
      <span className="grow">{text ?? TIPS[id]}</span>
      <span className="tip-ok">Got it</span>
    </button>
  );
}
