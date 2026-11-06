import { ChangeDetectionStrategy, Component } from '@angular/core';
import { I18N_PIPES } from '../../core/i18n/t.pipe';

/**
 * Animated illustration of what the app does: a floor plan draws itself, electrical symbols pop in,
 * wires are routed to the board and current "flows". Pure SVG + CSS; respects prefers-reduced-motion.
 */
@Component({
  selector: 'app-plan-animation',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 640 440" role="img" [attr.aria-label]="'Animated floor plan with lights, sockets and wires' | t">
      <defs>
        <pattern id="pa-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="rgba(62,207,142,.07)" stroke-width="1" />
        </pattern>
        <linearGradient id="pa-flow" x1="0" x2="1">
          <stop offset="0" stop-color="#3ecf8e" stop-opacity="0" />
          <stop offset=".5" stop-color="#7dffc4" />
          <stop offset="1" stop-color="#3ecf8e" stop-opacity="0" />
        </linearGradient>
        <filter id="pa-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <rect class="paper" x="20" y="20" width="600" height="400" rx="10" />
      <rect x="20" y="20" width="600" height="400" rx="10" fill="url(#pa-grid)" />

      <!-- walls -->
      <g class="walls">
        <path pathLength="1" d="M60 60H580V380H60Z" />
        <path pathLength="1" d="M300 60V250" />
        <path pathLength="1" d="M300 300V380" />
        <path pathLength="1" d="M300 200H440" />
        <path pathLength="1" d="M490 200H580" />
        <path pathLength="1" d="M60 250H140" />
        <path pathLength="1" d="M190 250H300" />
      </g>
      <!-- doors -->
      <g class="doors">
        <path d="M140 250A50 50 0 0 1 190 250" />
        <path d="M440 200A50 50 0 0 0 490 200" />
        <path d="M300 250A50 50 0 0 1 300 300" />
      </g>

      <!-- room names -->
      <g class="rooms">
        <text x="240" y="88">{{ 'LIVING ROOM' | t }}</text>
        <text x="375" y="185">{{ 'KITCHEN' | t }}</text>
        <text x="375" y="365">{{ 'BEDROOM' | t }}</text>
        <text x="125" y="368">{{ 'BATHROOM' | t }}</text>
      </g>

      <!-- dimension line -->
      <g class="dim">
        <path d="M60 400H300M60 394V406M300 394V406" />
        <text x="180" y="396">{{ 4 | num: 2 }} m</text>
      </g>

      <!-- wires (routed to the board) -->
      <g class="wires">
        <path pathLength="1" d="M555 355V330H180V120" />
        <path pathLength="1" d="M555 330V130H440" />
        <path pathLength="1" d="M440 330V290" />
        <path pathLength="1" d="M180 330V300" />
      </g>
      <!-- current flowing -->
      <g class="flow" filter="url(#pa-glow)">
        <path pathLength="1" d="M555 355V330H180V120" />
        <path pathLength="1" d="M555 330V130H440" />
      </g>

      <!-- board -->
      <g class="sym board" style="--d: 1.6s">
        <rect x="540" y="340" width="30" height="30" rx="3" />
        <path d="M553 344l-5 10h6l-3 10 8-13h-6l3-7z" />
      </g>
      <!-- lights -->
      <g class="sym light" style="--d: 1.9s"><circle cx="180" cy="120" r="13" /><path d="M171 111l18 18M189 111l-18 18" /></g>
      <g class="sym light" style="--d: 2.05s"><circle cx="440" cy="130" r="13" /><path d="M431 121l18 18M449 121l-18 18" /></g>
      <g class="sym light" style="--d: 2.2s"><circle cx="440" cy="290" r="13" /><path d="M431 281l18 18M449 281l-18 18" /></g>
      <g class="sym light" style="--d: 2.35s"><circle cx="180" cy="300" r="13" /><path d="M171 291l18 18M189 291l-18 18" /></g>
      <!-- sockets -->
      <g class="sym socket" style="--d: 2.5s"><path d="M86 160a12 12 0 0 1 24 0" /><path d="M98 160v10M90 172h16" /></g>
      <g class="sym socket" style="--d: 2.6s"><path d="M262 360a12 12 0 0 1 24 0" /><path d="M274 360v10M266 372h16" /></g>
      <g class="sym socket" style="--d: 2.7s"><path d="M520 80a12 12 0 0 1 24 0" /><path d="M532 80v10M524 92h16" /></g>
      <!-- switches -->
      <g class="sym switch" style="--d: 2.8s"><circle cx="205" cy="240" r="5" /><path d="M209 236l12-12" /></g>
      <g class="sym switch" style="--d: 2.9s"><circle cx="455" cy="212" r="5" /><path d="M459 216l12 12" /></g>

      <!-- glowing lights once powered -->
      <g class="halo">
        <circle cx="180" cy="120" r="26" style="--d: 3.4s" />
        <circle cx="440" cy="130" r="26" style="--d: 3.6s" />
        <circle cx="440" cy="290" r="26" style="--d: 3.8s" />
        <circle cx="180" cy="300" r="26" style="--d: 4s" />
      </g>

      <!-- cursor placing a component -->
      <g class="cursor">
        <path d="M0 0l0 18 5-5 4 9 3-1-4-9 7 0z" />
      </g>
    </svg>
  `,
  styles: `
    :host { display: block; }
    svg { width: 100%; height: auto; display: block; overflow: visible; }
    .paper { fill: #0d1114; stroke: rgba(62,207,142,.25); stroke-width: 1.2; }
    .walls path { fill: none; stroke: #e3e8eb; stroke-width: 5; stroke-linecap: square;
                  stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.4s ease-out forwards; }
    .walls path:nth-child(2) { animation-delay: .25s; } .walls path:nth-child(3) { animation-delay: .35s; }
    .walls path:nth-child(4) { animation-delay: .45s; } .walls path:nth-child(5) { animation-delay: .55s; }
    .walls path:nth-child(6) { animation-delay: .6s; } .walls path:nth-child(7) { animation-delay: .65s; }
    .doors path { fill: none; stroke: #96a1a8; stroke-width: 1.4; stroke-dasharray: 3 3; opacity: 0; animation: fade .6s 1.2s forwards; }
    .rooms text { fill: #66727a; font: 600 11px var(--font); letter-spacing: .12em; text-anchor: middle; opacity: 0; animation: fade .8s 1.3s forwards; }
    .dim path { fill: none; stroke: #3ecf8e; stroke-width: 1; }
    .dim text { fill: #3ecf8e; font: 600 11px var(--mono); text-anchor: middle; }
    .dim { opacity: 0; animation: fade .6s 1.5s forwards; }
    .wires path { fill: none; stroke: #3ecf8e; stroke-width: 2; stroke-dasharray: 1; stroke-dashoffset: 1; opacity: .75;
                  animation: draw 1.4s 3s ease-in-out forwards; }
    .wires path:nth-child(2) { animation-delay: 3.2s; } .wires path:nth-child(3), .wires path:nth-child(4) { animation-delay: 3.6s; }
    .flow path { fill: none; stroke: #b6ffe0; stroke-width: 3; stroke-linecap: round;
                 stroke-dasharray: .06 .94; stroke-dashoffset: 1; opacity: 0; animation: flow 2.6s 4.4s linear infinite; }
    .flow path:nth-child(2) { animation-delay: 5s; }
    .sym { opacity: 0; transform-box: fill-box; transform-origin: center; animation: pop .5s var(--d) cubic-bezier(.3,1.6,.5,1) forwards; }
    .sym * { fill: none; stroke-width: 2; }
    .light * { stroke: #f2b84b; }
    .socket * { stroke: #6cb6ff; }
    .switch * { stroke: #c792ea; }
    .board rect { fill: rgba(62,207,142,.15); stroke: #3ecf8e; }
    .board path { fill: #3ecf8e; stroke: none; }
    .halo circle { fill: rgba(242,184,75,.18); stroke: none; opacity: 0; transform-box: fill-box; transform-origin: center;
                   animation: halo 3s var(--d) ease-in-out infinite; }
    .cursor { fill: #fff; stroke: #0f1214; stroke-width: 1; animation: cursor 4s .2s ease-in-out forwards; opacity: 0; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes fade { to { opacity: 1; } }
    @keyframes pop { from { opacity: 0; transform: scale(.2); } to { opacity: 1; transform: scale(1); } }
    @keyframes flow { 0% { opacity: 0; stroke-dashoffset: 1; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { opacity: 0; stroke-dashoffset: 0; } }
    @keyframes halo { 0%, 100% { opacity: 0; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.15); } }
    @keyframes cursor {
      0% { opacity: 0; transform: translate(620px, 420px); }
      15% { opacity: 1; }
      45% { transform: translate(186px, 126px); }
      50% { transform: translate(186px, 126px) scale(.85); }
      55% { transform: translate(186px, 126px); }
      80% { transform: translate(446px, 296px); opacity: 1; }
      100% { transform: translate(470px, 330px); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { animation-duration: 1ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; }
      .flow path, .cursor { display: none; }
    }
  `,
})
export class PlanAnimation {}
