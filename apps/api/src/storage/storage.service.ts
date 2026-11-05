import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { env } from '../config/env.js';

/** Where the browser should read a stored file from. */
export type ReadLocation =
  | { kind: 'url'; url: string; expiresAt: Date } // presigned S3 URL, read directly by the browser
  | { kind: 'local'; absolutePath: string }; // development only: streamed by the API

/**
 * Object storage for original plan PDFs.
 * - `s3` driver: any S3-compatible service (MinIO locally, Cloudflare R2 / AWS S3 in production).
 * - `local` driver: files on disk, for development without Docker. Refused in production by env validation.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver = env().STORAGE_DRIVER;
  private readonly localRoot = resolve(env().LOCAL_STORAGE_DIR);
  private readonly s3?: S3Client;
  private readonly bucket = env().S3_BUCKET ?? '';

  constructor() {
    const e = env();
    if (this.driver === 's3') {
      this.s3 = new S3Client({
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! },
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.driver === 'local') {
      await mkdir(this.localRoot, { recursive: true });
      this.logger.warn(`Using LOCAL file storage at ${this.localRoot} (development only)`);
      return;
    }
    if (env().NODE_ENV === 'production') return; // bucket must be provisioned in production
    try {
      await this.s3!.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3!.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket "${this.bucket}"`);
      } catch (err) {
        this.logger.error(
          `Object storage is not reachable (${(err as Error).message}). Is MinIO running? Try: npm run db:up`,
        );
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.driver === 'local') {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      return;
    }
    await this.s3!.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async delete(key: string): Promise<void> {
    if (this.driver === 'local') {
      await rm(this.localPath(key), { force: true });
      return;
    }
    await this.s3!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async readLocation(key: string, expiresInSeconds = 900): Promise<ReadLocation> {
    if (this.driver === 'local') return { kind: 'local', absolutePath: this.localPath(key) };
    const url = await getSignedUrl(this.s3!, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
    return { kind: 'url', url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }

  /** Maps a storage key to a path inside the storage root, refusing anything that would escape it. */
  private localPath(key: string): string {
    const path = resolve(this.localRoot, key);
    if (!path.startsWith(this.localRoot + sep)) throw new Error(`Invalid storage key: ${key}`);
    return path;
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
