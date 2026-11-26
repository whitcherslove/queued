import { useEffect, useRef, useState } from 'react';
import { onDialog, type DialogReq } from '../lib/dialog';

/** Shows the in-app confirm / text dialogs and the toast (see lib/dialog). Mounted once, in the shell. */
export default function DialogHost() {
  const [d, setD] = useState<DialogReq | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => onDialog((x, t) => { setD(x); setToast(t); if (x?.kind === 'text') setText(x.value ?? ''); }), []);
  useEffect(() => { if (d?.kind === 'text') setTimeout(() => input.current?.focus(), 60); }, [d]);
  return <>
    {d && <div className="sheet-wrap dialog-wrap">
      <button className="sheet-scrim" aria-label="Cancel" onClick={() => (d.kind === 'confirm' ? d.resolve(false) : d.resolve(null))} />
      <div className="sheet dialog" role="dialog" aria-modal="true">
        {d.kind === 'confirm' ? <>
          <span className="dialog-text">{d.text}</span>
          <div className="row nowrap"><button className="btn grow" onClick={() => d.resolve(false)}>Cancel</button>
            <button className={'btn grow ' + (d.danger ? 'danger' : 'primary')} onClick={() => d.resolve(true)}>{d.ok ?? 'OK'}</button></div>
        </> : <form onSubmit={(e) => { e.preventDefault(); d.resolve(text.trim() ? text : null); }} className="stack-sm">
          <strong>{d.title}</strong>
          <input ref={input} className="text-input" value={text} placeholder={d.placeholder} onChange={(e) => setText(e.target.value)} />
          <div className="row nowrap"><button type="button" className="btn grow" onClick={() => d.resolve(null)}>Cancel</button><button type="submit" className="btn primary grow">Save</button></div>
        </form>}
      </div>
    </div>}
    {toast && <div className="toast app-toast" role="status">{toast}</div>}
  </>;
}
