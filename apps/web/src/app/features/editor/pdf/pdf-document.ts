/**
 * PDF.js loading. This module knows nothing about electrical drawing: it opens a PDF and hands out pages.
 * PDF.js is imported lazily so it only downloads when the editor opens.
 */
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { Size } from '@electro/shared';

const ASSETS = '/pdfjs/';
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | undefined;

function pdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then((lib) => {
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
    if (name === 'PasswordException') throw new PdfLoadError('This PDF is password-protected.');
    if (name === 'InvalidPDFException') throw new PdfLoadError('This file could not be read as a PDF.');
    throw new PdfLoadError(`The plan PDF could not be loaded (${(err as Error).message ?? 'unknown error'}).`);
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
