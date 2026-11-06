/**
 * PDF.js loading. This module knows nothing about electrical drawing: it opens a PDF and hands out pages.
 * PDF.js is imported lazily so it only downloads when the editor opens.
 */
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { Size } from '@electro/shared';
import { t } from '../../../core/i18n/i18n.service';

const ASSETS = '/pdfjs/';
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | undefined;

/**
 * The legacy build is used on purpose: the modern build calls very new JavaScript APIs
 * (e.g. Map.prototype.getOrInsertComputed) that current stable Chrome/Edge/Firefox/Safari do not all have,
 * and the plan then silently never draws. The legacy build ships polyfills for them. Same API and types.
 */
function pdfjs() {
  pdfjsPromise ??= (import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<typeof import('pdfjs-dist')>).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`;
    return lib;
  });
  return pdfjsPromise;
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  close(): Promise<void>;
}

export class PdfLoadError extends Error {}

/** Opens a PDF by URL. PDF.js parses it in its Web Worker and uses range requests when the server supports them. */
export async function openPdf(url: string, onProgress?: (fraction: number) => void): Promise<OpenedPdf> {
  const lib = await pdfjs();
  const task: PDFDocumentLoadingTask = lib.getDocument({
    url,
    withCredentials: url.startsWith('/'),
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
  });
  if (onProgress) {
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (total > 0) onProgress(Math.min(1, loaded / total));
    };
  }
  try {
    const doc = await task.promise;
    return { doc, close: () => task.destroy() };
  } catch (err) {
    await task.destroy().catch(() => undefined);
    const name = (err as { name?: string }).name;
    if (name === 'PasswordException') throw new PdfLoadError(t('This PDF is password-protected.'));
    if (name === 'InvalidPDFException') throw new PdfLoadError(t('This file could not be read as a PDF.'));
    throw new PdfLoadError(t('The plan PDF could not be loaded ({reason}).', { reason: (err as Error).message ?? t('unknown error') }));
  }
}

/**
 * Plan-space size of a page: PDF points at scale 1, with the page's own /Rotate applied.
 * All stored coordinates for a floor are relative to this box (origin top-left, y down).
 */
export function planPageSize(page: PDFPageProxy): Size {
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}
