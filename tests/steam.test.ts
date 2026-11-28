import { describe, expect, it } from 'vitest';
import { appIdFromInput, paceLine, steamHint } from '../src/lib/steam';
describe('steam helpers', () => {
  it('reads an app id from a Store link or a number', () => {
    expect(appIdFromInput('https://store.steampowered.com/app/1145360/Hades/')).toBe(1145360);
    expect(appIdFromInput('500')).toBe(500);
    expect(appIdFromInput('Hades')).toBeNull();
  });
  it('pace: on pace / taking your time / faster', () => {
    expect(paceLine(5, 10, 50, 'x')).toMatch(/pace|schedule|Steady/);
    expect(paceLine(8, 10, 30, 'x')).toMatch(/time|Exploring|thorough/);
    expect(paceLine(2, 10, 60, 'x')).toMatch(/Faster|Ahead|quick/);
    expect(paceLine(0.5, 10, 10, 'x')).toBeNull();
  });
});
describe('steam hints (last two weeks — the only thing Steam tells about everyone)', () => {
  const now = new Date('2026-11-28T12:00:00Z').getTime();
  const s = (w: number) => ({ playtime_2w_min: w, last_played: null }) as never;
  it('backlog + minutes in the last two weeks → start; Not now silences for two weeks', () => {
    expect(steamHint(s(60), 'backlog', null, null, now)).toBe('start');
    expect(steamHint(s(60), 'backlog', null, '2026-11-25T10:00:00Z', now)).toBeNull();
    expect(steamHint(s(60), 'backlog', null, '2026-11-01T10:00:00Z', now)).toBe('start');
    expect(steamHint(s(0), 'backlog', null, null, now)).toBeNull();
  });
  it('finished more than two weeks ago + playing again → replay; just finished → nothing', () => {
    expect(steamHint(s(60), 'done', '2026-10-20T10:00:00Z', null, now)).toBe('replay');
    expect(steamHint(s(60), 'done', '2026-11-25T10:00:00Z', null, now)).toBeNull();
    expect(steamHint(s(60), 'playing', null, null, now)).toBeNull();
  });
});
