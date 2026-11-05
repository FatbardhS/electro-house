import { makePdf } from '../../test/pdf-fixture.js';
import { InvalidPdfError, hasPdfSignature, inspectPdf } from './pdf-inspect.js';
import { sanitizeFileName } from './plan-files.service.js';

describe('inspectPdf', () => {
  it('reads the page count of a valid PDF and hashes it', async () => {
    const info = await inspectPdf(makePdf(4));
    expect(info.pageCount).toBe(4);
    expect(info.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects empty files and files without a PDF signature', async () => {
    await expect(inspectPdf(Buffer.alloc(0))).rejects.toThrow(InvalidPdfError);
    await expect(inspectPdf(Buffer.from('PK\x03\x04 zip pretending to be pdf'))).rejects.toThrow('not a PDF');
  });

  it('rejects a damaged PDF that only has the signature', async () => {
    await expect(inspectPdf(Buffer.from('%PDF-1.7\n garbage garbage'))).rejects.toThrow(InvalidPdfError);
  });

  it('accepts a signature preceded by junk bytes, as the PDF spec allows', () => {
    expect(hasPdfSignature(Buffer.concat([Buffer.from('\xEF\xBB\xBF  '), makePdf(1)]))).toBe(true);
  });
});

describe('sanitizeFileName', () => {
  it('keeps UTF-8 names that multer decoded as latin1', () => {
    const latin1 = Buffer.from('Kati përdhes.pdf', 'utf8').toString('latin1');
    expect(sanitizeFileName(latin1)).toBe('Kati përdhes.pdf');
  });

  it('removes path separators and control characters', () => {
    expect(sanitizeFileName('..\\..\\evil/plan\u0000.pdf')).toBe('.._.._evil_plan_.pdf');
    expect(sanitizeFileName('   ')).toBe('plan.pdf');
  });
});
