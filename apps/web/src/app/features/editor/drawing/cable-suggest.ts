import { componentType, type CableDto } from '@electro/shared';

/**
 * Cable size for a new wire from the types it connects (guided mode).
 * Lighting circuits: 3×1.5 mm². Outlets and big appliances: 3×2.5 mm². Three-phase: 5×2.5 mm².
 * Boards and junction boxes do not decide: the item at the other end does.
 */
export function suggestedCable(typeKeys: readonly (string | undefined)[]): Partial<CableDto> {
  const loads = typeKeys.filter((k): k is string => !!k && !k.startsWith('board.') && k !== 'dist.junction-box');
  if (loads.some((k) => k === 'outlet.three-phase' || k === 'outlet.industrial' || k === 'energy.ev-charger')) {
    return { conductors: 5, crossSectionMm2: 2.5 };
  }
  if (loads.some((k) => componentType(k)?.category === 'outlets')) return { conductors: 3, crossSectionMm2: 2.5 };
  return { conductors: 3, crossSectionMm2: 1.5 };
}
