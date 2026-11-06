import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/** HTTP setup shared by main.ts and the e2e tests, so tests exercise the real configuration. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  // Price list CSV imports and company logos are sent as JSON; the default 100 kB limit is too small for them.
  app.useBodyParser('json', { limit: '2mb' });
  app.use(cookieParser());
  app.set('trust proxy', 1);
}
