import { describe, expect, it } from 'vitest';
import { appIdFromInput, paceLine } from '../src/lib/steam';
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
