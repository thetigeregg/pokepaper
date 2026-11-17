import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/vitest.setup.ts'],
    include: ['src/**/*.spec.ts', 'shared/src/**/*.spec.ts'],
    server: {
      deps: {
        inline: ['@ionic/angular', '@ionic/core'],
      },
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/app',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'shared/src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/environments/**',
        'src/main.ts',
        'src/polyfills.ts',
        'src/zone-flags.ts',
        'src/vitest.setup.ts',
      ],
    },
  },
});
