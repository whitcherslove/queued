import { describe, expect, it } from 'vitest';
import { newer, unseen, CHANGELOG } from '../src/lib/changelog';
describe('what\'s new', () => {
  it('compares versions', () => { expect(newer('4.10', '4.6')).toBe(true); expect(newer('4.6', '4.6')).toBe(false); expect(newer('4.5', '4.6')).toBe(false); });
  it('shows only unseen entries', () => { expect(unseen(undefined).length).toBe(CHANGELOG.length); expect(unseen(CHANGELOG[0].version).length).toBe(0); });
});
