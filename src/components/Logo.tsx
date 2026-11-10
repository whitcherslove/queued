const SMILE = 'M5 5 Q50 30 95 5';

/** The Queued mark: "QD" with a smile (the app icon). */
export default function Logo({ size = 56 }: { size?: number; animated?: boolean }) {
  return (
    <span className="qdmark" style={{ width: size, height: size, borderRadius: size * 0.22, fontSize: size * 0.4 }} aria-hidden="true">
      <b>QD</b>
      <svg viewBox="0 0 100 24" preserveAspectRatio="none"><path d={SMILE} fill="none" stroke="#A855F7" strokeWidth="7" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>
    </span>
  );
}

/** The word with its smile under it — the end of the splash. While loading, the smile fills like a progress bar, again and again. */
export function Brand({ size = 96, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <div className={'brand' + (animated ? ' brand-anim' : '')}>
      <Logo size={size * 0.7} />
      <div className="brand-word"><span className="brand-text">QUEUED</span>
        <svg className="brand-smile" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
          <path className="track" d={SMILE} fill="none" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path className="fill" d={SMILE} pathLength={100} fill="none" stroke="#A855F7" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg></div>
    </div>
  );
}
