import { describe, expect, it } from 'vitest';
import { platformChoices, sectionOf } from '../src/lib/platforms';

describe('platforms', () => {
  it('maps IGDB platforms and adds Steam Deck / PS VR2', () => {
    const c = platformChoices([{ id: 6, name: 'PC (Microsoft Windows)' }, { id: 167, name: 'PlayStation 5' }, { id: 390, name: 'PlayStation VR2' }]);
    expect(c.map((x) => x.key)).toEqual(['pc', 'steam-deck', 'psvr2-pc', 'psvr2-ps5', 'ps5']);
    expect(c.find((x) => x.key === 'psvr2-pc')!.section).toBe('pc');
    expect(c.find((x) => x.key === 'psvr2-ps5')!.label).toBe('PS VR2 · PS5');
    expect(c.find((x) => x.key === 'psvr2-ps5')!.section).toBe('console');
  });
  it('retro by your list: PS1 retro, PS2 console', () => {
    expect(sectionOf('ps1')).toBe('retro');
    expect(sectionOf('ps2')).toBe('console');
    expect(sectionOf('gamecube')).toBe('console');
    expect(sectionOf('ps2', ['ps2'])).toBe('retro');
    expect(sectionOf('steam-deck')).toBe('pc');
  });
  it('PlayStation (1) is not confused with later ones', () => {
    const c = platformChoices([{ id: 7, name: 'PlayStation' }, { id: 8, name: 'PlayStation 2' }]);
    expect(c.map((x) => x.key)).toEqual(['ps2', 'ps1']);
  });
});

describe('ps vr', () => {
  it('the first PS VR is its own console platform', () => {
    const c = platformChoices([{ id: 165, name: 'PlayStation VR' }]);
    expect(c.map((x) => x.key)).toEqual(['psvr']);
    expect(c[0].section).toBe('console');
  });
});
