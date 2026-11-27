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
describe('steam hints', () => {
  const s = (last: string, w: number) => ({ playtime_2w_min: w, last_played: last }) as never;
  it('backlog + played lately → start; Not now silences until you play again', () => {
    expect(steamHint(s('2026-11-25T10:00:00Z', 60), 'backlog', null, null)).toBe('start');
    expect(steamHint(s('2026-11-25T10:00:00Z', 60), 'backlog', null, '2026-11-26T00:00:00Z')).toBeNull();
    expect(steamHint(s('2026-11-27T10:00:00Z', 60), 'backlog', null, '2026-11-26T00:00:00Z')).toBe('start');
  });
  it('finished + played after finishing → replay', () => {
    expect(steamHint(s('2026-11-25T10:00:00Z', 60), 'done', '2026-11-20T10:00:00Z', null)).toBe('replay');
    expect(steamHint(s('2026-11-19T10:00:00Z', 60), 'done', '2026-11-20T10:00:00Z', null)).toBeNull();
    expect(steamHint(s('2026-11-25T10:00:00Z', 0), 'backlog', null, null)).toBeNull();
  });
});
