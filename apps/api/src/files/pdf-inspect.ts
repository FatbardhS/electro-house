import { createHash } from 'node:crypto';

export class InvalidPdfError extends Error {}

export interface PdfInfo {
  pageCount: number;
  sha256: string;
}

const PDF_MAGIC = Buffer.from('%PDF-');

/** True if the "%PDF-" signature appears in the first 1 KB (the PDF spec allows leading junk before it). */
export function hasPdfSignature(bytes: Buffer): boolean {
  return bytes.subarray(0, 1024).includes(PDF_MAGIC);
}

/**
 * Validates an uploaded file really is a readable PDF and returns its page count.
 * Checks the signature first (cheap), then parses it with PDF.js (proves it opens in the editor too).
 */
export async function inspectPdf(bytes: Buffer): Promise<PdfInfo> {
  if (bytes.length === 0) throw new InvalidPdfError('The file is empty.');
  if (!hasPdfSignature(bytes)) throw new InvalidPdfError('This file is not a PDF.');

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // PDF.js may transfer/detach the buffer it gets, so give it a copy.
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages < 1) throw new InvalidPdfError('The PDF has no pages.');
    return { pageCount: doc.numPages, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (err) {
    if (err instanceof InvalidPdfError) throw err;
    const name = (err as { name?: string }).name;
    if (name === 'PasswordException') {
      throw new InvalidPdfError('The PDF is password-protected. Remove the password and upload it again.');
    }
    throw new InvalidPdfError('The PDF could not be read. It may be damaged.');
  } finally {
    await task.destroy();
  }
}
