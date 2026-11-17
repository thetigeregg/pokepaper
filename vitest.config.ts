import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'jsdom',
          setupFiles: ['src/vitest.setup.ts'],
          include: ['src/**/*.spec.ts', 'shared/src/**/*.spec.ts'],
          server: {
            deps: {
              inline: ['@ionic/angular', '@ionic/core'],
            },
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/src/**/*.spec.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/app',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts', 'shared/src/**/*.ts', 'server/src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        'src/environments/**',
        'src/main.ts',
        'src/polyfills.ts',
        'src/zone-flags.ts',
        'src/vitest.setup.ts',
        'server/src/index.ts',
      ],
    },
  },
});
