import { describe, expect, it } from 'vitest';
import { positionText, readHours } from '../src/lib/formats';

describe('book formats', () => {
  it('reading time: pages at ~1.5 min, audio by its length', () => {
    expect(readHours(400, null, 'paper')).toBe(10);
    expect(readHours(200, 700, 'audio')).toBe(12);
    expect(readHours(120, null, 'ebook')).toBe(3);
  });
  it('position text', () => {
    expect(positionText(30, 412, null, 'paper')).toBe('p. 124 / 412');
    expect(positionText(50, null, 200, 'audio')).toBe('1 h 40 m / 3 h 20 m');
  });
});
