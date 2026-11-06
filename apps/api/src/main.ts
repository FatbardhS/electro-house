import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

// Local development: load apps/api/.env. In production the platform provides real environment variables.
if (existsSync('.env')) process.loadEnvFile('.env');

const { env } = await import('./config/env.js');
const config = env(); // fail fast on bad configuration
const { AppModule } = await import('./app.module.js');
const { configureApp } = await import('./app.setup.js');

// rawBody: payment provider webhooks are verified against the exact bytes they signed.
const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
configureApp(app);
app.enableShutdownHooks();
await app.listen(config.PORT);
console.log(`Electro House API listening on http://localhost:${config.PORT}/api`);
