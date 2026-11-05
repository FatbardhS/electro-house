import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.url(),
  DATABASE_URL: z.string().startsWith('postgres', 'DATABASE_URL must be a PostgreSQL connection string'),
  /** `s3` for any S3-compatible service (production, MinIO). `local` stores files on disk — development only. */
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
  LOCAL_STORAGE_DIR: z.string().min(1).default('.storage'),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(3).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
})
  .superRefine((e, ctx) => {
    if (e.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!e[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required when STORAGE_DRIVER=s3' });
      }
    }
    if (e.STORAGE_DRIVER === 'local' && e.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'Local storage is not allowed in production' });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment. Fails fast at start-up with a readable list of what is missing or wrong. */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration (see apps/api/.env.example):\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}
