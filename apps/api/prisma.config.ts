import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Load apps/api/.env for Prisma CLI commands (Node's built-in loader, no dotenv dependency).
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
    // Only needed for `prisma dev` (its server holds a single database; the shadow database runs on the next port).
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'] || undefined,
  },
});
