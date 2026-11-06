// Copies the PDF.js worker and its runtime data (fonts, cmaps, wasm decoders) into public/pdfjs,
// so the editor can load them from the same origin. Runs before `ng serve` / `ng build`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pdfjs');

mkdirSync(target, { recursive: true });
// Legacy build: includes polyfills for very new JavaScript APIs that many browsers do not have yet.
cpSync(join(pdfjsRoot, 'legacy', 'build', 'pdf.worker.min.mjs'), join(target, 'pdf.worker.min.mjs'));
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = join(pdfjsRoot, dir);
  if (existsSync(src)) cpSync(src, join(target, dir), { recursive: true });
}
console.log(`PDF.js assets copied to ${target}`);
