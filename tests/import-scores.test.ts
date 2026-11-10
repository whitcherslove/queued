import { describe, expect, it } from 'vitest';
import { normalizeScores } from '../src/lib/importer';
describe('import scores', () => {
  it('a 10-point sheet is halved, a 5-point sheet stays', () => {
    const ten = normalizeScores([{ rows: [{ score: 8 }, { score: 4 }, { score: 6.5 }, { score: null }] }]);
    expect(ten[0].rows.map((r) => r.score)).toEqual([4, 2, 3.25, null]);
    const five = normalizeScores([{ rows: [{ score: 4.5 }, { score: 3 }] }]);
    expect(five[0].rows.map((r) => r.score)).toEqual([4.5, 3]);
  });
});
