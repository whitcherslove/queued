import { PLATFORM_ICONS, platformLabel } from '../lib/platforms';

/** Small pixel icon of the console / device; falls back to a short text label when there's no icon. */
export default function PlatformIcon({ k, size = 20 }: { k: string | null | undefined; size?: number }) {
  if (!k) return null;
  const label = platformLabel(k);
  if (!PLATFORM_ICONS.has(k)) return <span className="plat-text" title={label}>{label}</span>;
  return <img className="plat-icon" src={'/platforms/' + k + '.png'} width={size} height={size} alt={label} title={label} loading="lazy" />;
}
