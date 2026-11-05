import { ChangeDetectionStrategy, Component } from '@angular/core';
import { COMPONENT_TYPES, type LayerKey, type SymbolPrimitive } from '@electro/shared';

/** Colour per layer, chosen to read well on white paper and be distinguishable from each other. */
export const LAYER_COLORS: Record<LayerKey, string> = {
  wiring: '#111827',
  lighting: '#c2410c',
  outlets: '#1d4ed8',
  switches: '#7e22ce',
  data: '#0e7490',
  smart: '#be185d',
  distribution: '#b91c1c',
  annotations: '#374151',
};

/** Stroke width of symbols in paper millimetres (≈ a 0.25 mm pen). */
export const SYMBOL_STROKE_MM = 0.25;

export function symbolId(typeKey: string): string {
  return `sym-${typeKey.replace(/[^a-z0-9-]/gi, '_')}`;
}

export function fillOf(p: Extract<SymbolPrimitive, { fill?: unknown }>): string {
  return p.fill === 'stroke' ? 'currentColor' : p.fill === 'paper' ? '#ffffff' : 'none';
}

/**
 * One SVG <symbol> per component type, drawn in paper millimetres. Placed components reference them with <use>,
 * so thousands of components stay cheap to render. Put this once in the editor page.
 */
@Component({
  selector: 'app-symbol-defs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg width="0" height="0" aria-hidden="true" style="position: absolute">
      <defs>
        @for (t of types; track t.key) {
          <symbol [attr.id]="id(t.key)" overflow="visible">
            <g fill="none" stroke="currentColor" [attr.stroke-width]="stroke" stroke-linecap="round" stroke-linejoin="round">
              @for (p of t.symbol.primitives; track $index) {
                @switch (p.kind) {
                  @case ('path') { <path [attr.d]="$any(p).d" [attr.fill]="fill($any(p))" /> }
                  @case ('circle') { <circle [attr.cx]="$any(p).cx" [attr.cy]="$any(p).cy" [attr.r]="$any(p).r" [attr.fill]="fill($any(p))" /> }
                  @case ('text') {
                    <text [attr.x]="$any(p).x" [attr.y]="$any(p).y" [attr.font-size]="$any(p).size" stroke="none" fill="currentColor"
                          text-anchor="middle" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-weight="600">{{ $any(p).text }}</text>
                  }
                }
              }
            </g>
          </symbol>
        }
      </defs>
    </svg>
  `,
})
export class SymbolDefs {
  protected readonly types = COMPONENT_TYPES;
  protected readonly stroke = SYMBOL_STROKE_MM;
  protected readonly id = symbolId;
  protected readonly fill = fillOf;
}
