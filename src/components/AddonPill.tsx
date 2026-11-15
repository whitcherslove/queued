import { addonOf } from '../lib/logic';

/** "DLC" (or Expansion / Standalone) next to a game's name; nothing for regular games. */
export default function AddonPill({ t }: { t: { data?: unknown } | null | undefined }) {
  const a = addonOf(t);
  return a ? <> <span className="type-pill dlc" title={a.parent ? a.label + ' for ' + a.parent : a.label}>{a.label}</span></> : null;
}
