import { describe, expect, it } from 'vitest';
import { suggestedCable } from './cable-suggest';

describe('suggestedCable', () => {
  it('uses 1.5 mm² for lights and switches', () => {
    expect(suggestedCable(['board.main', 'light.ceiling'])).toEqual({ conductors: 3, crossSectionMm2: 1.5 });
    expect(suggestedCable(['switch.single', 'light.wall'])).toEqual({ conductors: 3, crossSectionMm2: 1.5 });
  });

  it('uses 2.5 mm² when an outlet is connected', () => {
    expect(suggestedCable(['board.main', 'outlet.double'])).toEqual({ conductors: 3, crossSectionMm2: 2.5 });
    expect(suggestedCable(['dist.junction-box', 'outlet.single'])).toEqual({ conductors: 3, crossSectionMm2: 2.5 });
  });

  it('uses five cores for three-phase loads', () => {
    expect(suggestedCable(['board.main', 'outlet.three-phase'])).toEqual({ conductors: 5, crossSectionMm2: 2.5 });
  });

  it('keeps the light size for free ends and boards only', () => {
    expect(suggestedCable([undefined, 'board.main'])).toEqual({ conductors: 3, crossSectionMm2: 1.5 });
  });
});
