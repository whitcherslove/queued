import { displayScore, myScoreColor } from '../lib/scores';

interface Props { value: number | null; scale: 5 | 10; size: number; fontSize?: number; label?: string }

/** Filled ring for "My score" — tint inside, progress stroke, number in the middle. */
export default function ScoreRing({ value, scale, size, fontSize, label }: Props) {
  const has = value !== null && value !== undefined;
  const color = myScoreColor(value) ?? 'var(--line)';
  const C = 138.23;
  const dash = `${has ? ((value as number) / 5 * C).toFixed(1) : 0} ${C}`;
  const text = has ? String(displayScore(value as number, scale)) : '—';
  return (
    <span className="ring" role="img" aria-label={label ?? (has ? `My score ${text} out of ${scale}` : 'No score')} style={{ width: size, height: size }}>
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="22" fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle cx="26" cy="26" r="19.5" fill={color} fillOpacity="0.28" />
        <circle cx="26" cy="26" r="22" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={dash} transform="rotate(-90 26 26)" />
        <text x="26" y="26.5" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontFamily="Arial, 'Helvetica Neue', sans-serif" fontWeight="800" letterSpacing="-0.5" fontSize={((fontSize ?? size * 0.34) * 52) / size}>{text}</text>
      </svg>
    </span>
  );
}
