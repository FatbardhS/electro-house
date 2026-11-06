import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PLAN, TRIAL_DAYS } from '@electro/shared';
import { AuthService } from '../../core/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import type { TKey } from '../../core/i18n/sq';
import { BrandMark } from '../../shared/ui/brand-mark';
import { LangSwitch } from '../../shared/ui/lang-switch';
import { PlanAnimation } from '../../shared/ui/plan-animation';
import { Reveal } from '../../shared/ui/reveal';

interface Feature { icon: string; title: TKey; text: TKey }
interface Shot { file: string; title: TKey; text: TKey }

const STEPS: { title: TKey; text: TKey }[] = [
  { title: 'Upload the plan', text: 'Drop the architect’s PDF. Every page and floor stays sharp at any zoom.' },
  { title: 'Set the scale', text: 'Click two points of a known length, or pick 1:50 / 1:100. Done.' },
  { title: 'Draw the installation', text: 'Place lights, sockets, switches and boards; connect them with wires and circuits.' },
  { title: 'Export and quote', text: 'Get the PDF plan, DXF, cable lengths, material list and the price for your offer.' },
];

const FEATURES: Feature[] = [
  { icon: 'M4 4h16v16H4zM4 9h16M9 9v11', title: 'Works on the real plan', text: 'PDF.js renders the architect’s drawing; your symbols sit exactly on it.' },
  { icon: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6', title: '55+ electrical symbols', text: 'Lighting, sockets, switches, boards, data, smart home and solar – grouped and searchable.' },
  { icon: 'M3 17l6-6 4 4 8-8M15 7h6v6', title: 'Lengths calculated', text: 'Wire routes in metres from the calibrated scale, including drops and reserves.' },
  { icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', title: 'Automatic checks', text: 'Overloaded circuits, missing RCD, voltage drop and unconnected items are flagged.' },
  { icon: 'M4 7h16M4 12h16M4 17h10', title: 'Materials & costs', text: 'Your own price list and rules turn the drawing into a bill of materials and a quote.' },
  { icon: 'M12 3v12M7 10l5 5 5-5M5 21h14', title: 'PDF & DXF export', text: 'A clean, scaled PDF for the client and DXF for CAD – with legend and tables.' },
  { icon: 'M17 20h5v-2a4 4 0 0 0-5-3.9M9 20H2v-2a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v2M12 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0', title: 'Built for teams', text: 'Invite colleagues, give roles, switch between companies.' },
  { icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', title: 'Saved automatically', text: 'Every change is saved; work offline for a moment and nothing is lost.' },
];

const SHOTS: Shot[] = [
  { file: 'editor', title: 'The editor', text: 'Symbols, wires and circuits drawn directly on the floor plan.' },
  { file: 'circuits', title: 'Circuits & boards', text: 'Every circuit with its protection, load and cable – per board.' },
  { file: 'materials', title: 'Materials & costs', text: 'The bill of materials and the price of the job, ready for the offer.' },
  { file: 'checks', title: 'Checks', text: 'Problems are listed with a link that zooms straight to them.' },
  { file: 'export', title: 'Export', text: 'Choose sheets, scale and tables – get a print-ready PDF or DXF.' },
];

const FAQ: { q: TKey; a: TKey }[] = [
  { q: 'Do I need to install anything?', a: 'No. Electro House runs in the browser on any computer; your work is saved online.' },
  { q: 'Which plans can I use?', a: 'Any PDF from the architect – scanned or exported from CAD. You set the scale once per floor.' },
  { q: 'Is my data private?', a: 'Each company has its own separate workspace. Only people you invite can see your projects.' },
  { q: 'Can I cancel any time?', a: 'Yes. After cancelling, your projects stay viewable and exportable.' },
];

@Component({
  selector: 'app-landing-page',
  imports: [RouterLink, BrandMark, LangSwitch, PlanAnimation, Reveal, I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.css',
})
export class LandingPage {
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18n);
  protected readonly steps = STEPS;
  protected readonly features = FEATURES;
  protected readonly shots = SHOTS;
  protected readonly faq = FAQ;
  protected readonly trialDays = TRIAL_DAYS;
  protected readonly monthly = PLAN.pricePerSeat.month;
  protected readonly yearly = PLAN.pricePerSeat.year;
  protected readonly yearlySaving = PLAN.pricePerSeat.month * 12 - PLAN.pricePerSeat.year;

  protected readonly yearlyBilling = signal(false);
  protected readonly shot = signal(0);
  protected readonly openFaq = signal<number | null>(0);
  protected readonly scrolled = signal(false);
  protected readonly menuOpen = signal(false);
  private paused = false;

  protected readonly price = computed(() => (this.yearlyBilling() ? this.yearly : this.monthly));

  constructor() {
    void this.auth.ensureLoaded().catch(() => null);
    const timer = setInterval(() => {
      if (!this.paused) this.shot.update((i) => (i + 1) % SHOTS.length);
    }, 5000);
    const onScroll = () => this.scrolled.set(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      window.removeEventListener('scroll', onScroll);
    });
  }

  protected pickShot(i: number): void {
    this.shot.set(i);
    this.paused = true; // the visitor took control; stop auto-advancing
  }

  protected shotSrc(file: string): string {
    return `/showroom/${file}-${this.i18n.lang()}.webp`;
  }

  protected toggleFaq(i: number): void {
    this.openFaq.update((o) => (o === i ? null : i));
  }

  protected go(id: string): void {
    this.menuOpen.set(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Spotlight that follows the cursor over feature cards. */
  protected spot(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }
}
