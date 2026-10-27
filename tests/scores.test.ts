import { describe, expect, it } from 'vitest';
import { displayScore, imdbColor, metascoreColor, myScoreColor, C_BAD, C_GOOD, C_MID, C_TOP } from '../src/lib/scores';
import { themeVars } from '../src/lib/theme';

describe('score colors', () => {
  it('metascore thresholds', () => {
    expect(metascoreColor(61)).toBe(C_GOOD);
    expect(metascoreColor(60)).toBe(C_MID);
    expect(metascoreColor(40)).toBe(C_MID);
    expect(metascoreColor(39)).toBe(C_BAD);
    expect(metascoreColor(null)).toBeNull();
  });
  it('imdb thresholds', () => {
    expect(imdbColor(6.1)).toBe(C_GOOD);
    expect(imdbColor(6)).toBe(C_MID);
    expect(imdbColor(4.1)).toBe(C_MID);
    expect(imdbColor(4)).toBe(C_BAD);
  });
  it('my score follows the 10-point rules', () => {
    expect(myScoreColor(2)).toBe(C_BAD);
    expect(myScoreColor(2.5)).toBe(C_MID);
    expect(myScoreColor(3.75)).toBe(C_MID);
    expect(myScoreColor(4)).toBe(C_GOOD);
    expect(myScoreColor(5)).toBe(C_TOP);
  });
  it('display scale', () => {
    expect(displayScore(3.75, 10)).toBe(7.5);
    expect(displayScore(3.75, 5)).toBe(4);
  });
});

describe('theme', () => {
  it('builds css vars for accent and theme', () => {
    const v = themeVars({ theme: 'light', accent: 'teal', scale: 5, view: 'list', posterScore: true });
    expect(v['--accent']).toBe('#137A6C');
    expect(v['--on-accent']).toBe('#FFFFFF');
  });
});
