import { Injectable, signal } from '@angular/core';
import type { Category, CheckCode } from '@electro/shared';
import type { TKey } from '../../../core/i18n/sq';

export type GuideMode = 'guided' | 'expert';
export type StepId = 'plan' | 'lights' | 'outlets' | 'wires' | 'check';

export interface GuideStep {
  id: StepId;
  /** Short name in the step bar. */
  title: TKey;
  /** One sentence telling the user what this step is about. */
  intro: TKey;
  /** Library categories offered under "More" in this step. */
  categories: readonly Category[];
  /** The most used components of this step, shown as big tiles (catalog keys). */
  quick: readonly { key: string; name: TKey }[];
  /** A practical tip shown under the tiles. */
  tip: TKey | null;
  /** Check codes worth showing while working on this step. */
  checks: readonly CheckCode[];
}

/** The five steps of the guided editor, in order. */
export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: 'plan',
    title: 'Plan and scale',
    intro: 'Tell the app how big the plan is: click two points whose real distance you know, then type that distance.',
    categories: [],
    quick: [],
    tip: 'Use a long wall or a dimension line printed on the plan. The longer the line, the more exact every length will be.',
    checks: ['D5'],
  },
  {
    id: 'lights',
    title: 'Lights',
    intro: 'Put a light wherever one is needed. Click a light below, then click on the plan.',
    categories: ['lighting'],
    quick: [
      { key: 'light.ceiling', name: 'Ceiling light' },
      { key: 'light.wall', name: 'Wall light' },
      { key: 'light.spot', name: 'LED spotlight' },
      { key: 'light.led-strip', name: 'LED strip' },
    ],
    tip: 'Most rooms need one ceiling light in the middle. Bathrooms and outdoor spots need waterproof lights.',
    checks: ['D3', 'D4'],
  },
  {
    id: 'outlets',
    title: 'Outlets and switches',
    intro: 'Add outlets and the switches for the lights. They stick to the nearest wall by themselves.',
    categories: ['outlets', 'switches', 'communication'],
    quick: [
      { key: 'outlet.single', name: 'Outlet' },
      { key: 'outlet.double', name: 'Double outlet' },
      { key: 'switch.single', name: 'Switch' },
      { key: 'switch.double', name: 'Double switch' },
      { key: 'outlet.appliance', name: 'Oven, washer…' },
      { key: 'switch.two-way', name: 'Two-way switch' },
    ],
    tip: 'Put switches next to the door, on the side where it opens. Kitchens need several outlets along the counter.',
    checks: ['D3', 'D4'],
  },
  {
    id: 'wires',
    title: 'Wires',
    intro: 'Connect everything to the electrical board. Click one item, then the next item: the wire is drawn for you.',
    categories: ['distribution'],
    quick: [
      { key: 'board.main', name: 'Main board' },
      { key: 'dist.junction-box', name: 'Junction box' },
    ],
    tip: 'Start at the board. Go from item to item: after each connection the app continues from the last item.',
    checks: ['D1', 'D2'],
  },
  {
    id: 'check',
    title: 'Check and print',
    intro: 'The app checks the drawing for you. Fix what is red, then open the materials and print the plan.',
    categories: [],
    quick: [],
    tip: null,
    checks: [],
  },
];

const MODE_KEY = 'eh.editorMode';
const TOUR_KEY = 'eh.editorTour';

/** Guided-editor state: simple or full mode, the current step and the help tour. Per editor. */
@Injectable()
export class GuideStore {
  readonly mode = signal<GuideMode>(readPref(MODE_KEY) === 'expert' ? 'expert' : 'guided');
  readonly step = signal<StepId>('plan');
  /** Index of the open tour bubble, or null when the tour is closed. */
  readonly tour = signal<number | null>(null);
  /** The step was chosen for this floor (by the user or automatically on load). */
  stepChosenFor: string | null = null;

  guided(): boolean {
    return this.mode() === 'guided';
  }

  setMode(mode: GuideMode): void {
    this.mode.set(mode);
    writePref(MODE_KEY, mode);
  }

  /** Opens the tour once for new users. */
  maybeStartTour(): void {
    if (readPref(TOUR_KEY) !== 'done') this.tour.set(0);
  }

  closeTour(): void {
    this.tour.set(null);
    writePref(TOUR_KEY, 'done');
  }
}

export function stepIndex(id: StepId): number {
  return GUIDE_STEPS.findIndex((s) => s.id === id);
}

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preference only */
  }
}
