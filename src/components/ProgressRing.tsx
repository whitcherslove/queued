/** Progress ring (shows / games): a thin ring that fills up, text in the middle. */
export default function ProgressRing({ pct, text, size = 48 }: { pct: number; text: string; size?: number }) {
  const C = 138.23;
  return (
    <span className="ring" role="img" aria-label={'Progress ' + text} style={{ width: size, height: size }}>
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="22" fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle cx="26" cy="26" r="22" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * C} ${C}`} transform="rotate(-90 26 26)" />
        <text x="26" y="26.5" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontFamily="Arial, sans-serif" fontWeight="800" fontSize="13">{pct}%</text>
      </svg>
    </span>
  );
}
