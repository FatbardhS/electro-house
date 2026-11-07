import { componentType, type ComponentDto, type Issue, type WireDto } from '@electro/shared';
import type { StepId } from './guide.store';

export interface StepProgress {
  id: StepId;
  done: boolean;
  /** Plain counts shown under the step ("3 lights"). */
  counts: { label: 'lights' | 'outlets' | 'switches' | 'wires' | 'not connected' | 'problems'; n: number }[];
}

export interface GuideProgress {
  steps: Record<StepId, StepProgress>;
  /** Components (not notes) that have no wire yet. */
  unconnected: ComponentDto[];
}

/** How far the floor is in each guided step, from the live drawing. Pure, so it is cheap to test. */
export function guideProgress(
  components: readonly ComponentDto[],
  wires: readonly WireDto[],
  calibrated: boolean,
  issues: readonly Issue[],
): GuideProgress {
  const cat = (c: ComponentDto) => componentType(c.typeKey)?.category;
  const lights = components.filter((c) => cat(c) === 'lighting').length;
  const outlets = components.filter((c) => cat(c) === 'outlets').length;
  const switches = components.filter((c) => cat(c) === 'switches').length;

  const wired = new Set<string>();
  for (const w of wires) {
    if (w.from.componentId) wired.add(w.from.componentId);
    if (w.to.componentId) wired.add(w.to.componentId);
  }
  const unconnected = components.filter((c) => cat(c) !== 'annotation' && !wired.has(c.id));
  const errors = issues.filter((i) => i.severity === 'error').length;

  const plan = calibrated;
  const lightsDone = lights > 0;
  const outletsDone = outlets > 0 && (lights === 0 || switches > 0);
  const wiresDone = wires.length > 0 && unconnected.length === 0;

  return {
    unconnected,
    steps: {
      plan: { id: 'plan', done: plan, counts: [] },
      lights: { id: 'lights', done: lightsDone, counts: [{ label: 'lights', n: lights }] },
      outlets: {
        id: 'outlets',
        done: outletsDone,
        counts: [
          { label: 'outlets', n: outlets },
          { label: 'switches', n: switches },
        ],
      },
      wires: {
        id: 'wires',
        done: wiresDone,
        counts: [
          { label: 'wires', n: wires.length },
          { label: 'not connected', n: unconnected.length },
        ],
      },
      check: {
        id: 'check',
        done: plan && lightsDone && outletsDone && wiresDone && errors === 0,
        counts: [{ label: 'problems', n: errors }],
      },
    },
  };
}

/** The step to open on a floor: the first one that is not done yet. */
export function firstOpenStep(p: GuideProgress): StepId {
  const order: StepId[] = ['plan', 'lights', 'outlets', 'wires', 'check'];
  return order.find((id) => !p.steps[id].done) ?? 'check';
}
