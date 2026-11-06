import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The embedded `prisma dev` database occasionally stalls for several seconds; 5 s made runs fail at random.
    testTimeout: 20_000,
  },
});
