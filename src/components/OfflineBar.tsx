import { useEffect, useState } from 'react';

/** A red bar on top while there's no connection: changes can't be saved until it's back. */
export default function OfflineBar() {
  const [off, setOff] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOff(false), off_ = () => setOff(true);
    window.addEventListener('online', on); window.addEventListener('offline', off_);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off_); };
  }, []);
  return off ? <div className="offline-bar" role="status">Offline — changes won’t save until you’re back online</div> : null;
}
