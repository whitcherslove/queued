export const C_GOOD = '#39C316';
export const C_MID = '#F6B26B';
export const C_BAD = '#DE3C49';
export const C_TOP = '#5FD6A0';

export function metascoreColor(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v > 60 ? C_GOOD : v < 40 ? C_BAD : C_MID;
}

export function imdbColor(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v > 6 ? C_GOOD : v < 4.1 ? C_BAD : C_MID;
}

/** Score is stored on a 0–5 scale; colors follow the 10-point rules. */
export function myScoreColor(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const x = v * 2;
  return x >= 10 ? C_TOP : x >= 8 ? C_GOOD : x >= 5 ? C_MID : C_BAD;
}

export function displayScore(v: number, scale: 5 | 10): number {
  return scale === 10 ? +(v * 2).toFixed(1) : Math.round(v * 2) / 2;
}

export const TIERS = [
  { id: 'ten', label: '10 out of 10', color: '#5FD6A0' },
  { id: 'awesome', label: 'Awesome', color: '#39C316' },
  { id: 'fine', label: 'This is fine', color: '#F6B26B' },
  { id: 'sobad', label: 'So bad it’s good', color: '#E8D84A' },
  { id: 'filth', label: 'Fucking filth', color: '#DE3C49' },
  { id: 'dropped', label: 'Dropped', color: '#A98BE0' }
] as const;

/** Ratings you can pick. "Dropped" is not a rating anymore — it's a mark on a viewing (movies) or a state (shows). */
export const PICK_TIERS = TIERS.filter((t) => t.id !== 'dropped');
export const DROPPED_COLOR = '#A98BE0';
