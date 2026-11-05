import { BadRequestException, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MAX_PLAN_FILE_BYTES } from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { StoredFile } from '../generated/prisma/client.js';
import { InvalidPdfError, inspectPdf } from './pdf-inspect.js';

export interface UploadedPdf {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Stores original floor-plan PDFs. Drawings are never stored as images; only the source PDF lives here. */
@Injectable()
export class PlanFilesService {
  private readonly logger = new Logger(PlanFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async store(organizationId: string, file: UploadedPdf | undefined): Promise<StoredFile> {
    if (!file) throw new BadRequestException('Choose a PDF file to upload.');
    if (file.size > MAX_PLAN_FILE_BYTES) {
      throw new PayloadTooLargeException(`The file is larger than ${MAX_PLAN_FILE_BYTES / 1024 / 1024} MB.`);
    }

    let info;
    try {
      info = await inspectPdf(file.buffer);
    } catch (err) {
      if (err instanceof InvalidPdfError) throw new BadRequestException(err.message);
      throw err;
    }

    const id = randomUUID();
    const storageKey = `org/${organizationId}/plans/${id}.pdf`;
    await this.storage.put(storageKey, file.buffer, 'application/pdf');
    try {
      return await this.prisma.storedFile.create({
        data: {
          id,
          organizationId,
          storageKey,
          originalName: sanitizeFileName(file.originalname),
          mimeType: 'application/pdf',
          sizeBytes: file.size,
          pageCount: info.pageCount,
          sha256: info.sha256,
        },
      });
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
  }

  /** Removes stored files that no floor references any more (after replace or delete). */
  async deleteIfUnreferenced(fileIds: readonly (string | null | undefined)[]): Promise<void> {
    for (const id of new Set(fileIds.filter((x): x is string => !!x))) {
      const file = await this.prisma.storedFile.findUnique({
        where: { id },
        include: { _count: { select: { floors: true } } },
      });
      if (!file || file._count.floors > 0) continue;
      await this.prisma.storedFile.delete({ where: { id } });
      await this.storage.delete(file.storageKey).catch((err: Error) => {
        // The DB row is gone; an orphaned object costs storage but never breaks a project. Log it for cleanup.
        this.logger.warn(`Could not delete object ${file.storageKey}: ${err.message}`);
      });
    }
  }
}

export function sanitizeFileName(name: string): string {
  // Multer decodes multipart filenames as latin1; recover UTF-8 names (e.g. "Kati përdhes.pdf").
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  const clean = (decoded.includes('�') ? name : decoded).replace(/[\\/\u0000-\u001f]/g, '_').trim();
  return clean.slice(0, 200) || 'plan.pdf';
}
