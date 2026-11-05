import { PLATFORM_ICONS, platformLabel } from '../lib/platforms';

/** The platform's logo (white wordmark; dark in the light theme). Falls back to a short text label. */
export default function PlatformIcon({ k, size = 14 }: { k: string | null | undefined; size?: number }) {
  if (!k) return null;
  const label = platformLabel(k);
  if (!PLATFORM_ICONS.has(k)) return <span className="plat-text" title={label}>{label}</span>;
  return <img className="plat-logo" src={'/plogos/' + k + '.png'} style={{ height: size }} alt={label} title={label} decoding="async" />;
}
