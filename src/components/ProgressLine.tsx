/** The progress bar from Playing on Home: a bar with the percent on the right, and the episode / page under it when it says more. */
export default function ProgressLine({ pct, label, stopped }: { pct: number | null; label: string; stopped?: boolean }) {
  const p = pct == null ? null : Math.max(0, Math.min(100, Math.round(pct)));
  const extra = label && label !== p + '%' ? label : '';
  return (
    <span className={'prog-line' + (stopped ? ' stopped' : '')}>
      {p != null && <span className="bar-row"><span className="mini-bar wide"><span style={{ width: Math.max(2, p) + '%' }} /></span><strong className="tiny">{p}%</strong></span>}
      {extra && <span className="muted tiny">{stopped ? 'stopped at ' : ''}{extra}</span>}
    </span>
  );
}
