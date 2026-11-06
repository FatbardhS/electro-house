import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

/**
 * Serves the built Angular app from the API in production, so the app and `/api` share one address
 * (one HTTPS origin: the session cookie and large uploads need no cross-site setup).
 * The folder is `WEB_DIST_DIR`, or `apps/web/dist/web/browser` next to this build. Returns the folder, or null.
 */
export function serveWebApp(app: NestExpressApplication): string | null {
  const here = dirname(fileURLToPath(import.meta.url)); // apps/api/dist
  const dir = resolve(process.env['WEB_DIST_DIR'] ?? join(here, '..', '..', 'web', 'dist', 'web', 'browser'));
  const index = join(dir, 'index.html');
  if (!existsSync(index)) return null;

  app.useStaticAssets(dir, {
    index: false,
    // File names of the JS/CSS bundles contain a content hash: cache them for a year. Everything else: revalidate.
    setHeaders: (res, path) => {
      res.setHeader('Cache-Control', /-[A-Z0-9]{8}\.(js|css)$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  // Client-side routes (/projects/…, /invite/…): answer with index.html. API paths keep their JSON 404s.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  return dir;
}
