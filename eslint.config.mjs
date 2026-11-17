import { defineConfig, globalIgnores } from 'eslint/config';
import { configs as angularConfigs, processInlineTemplates } from 'angular-eslint';
import { importX } from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import { configs as tseslintConfigs } from 'typescript-eslint';

const jsTsFiles = ['**/*.{js,mjs,cjs,jsx,mjsx,ts,tsx,mtsx}'];
const tsFiles = ['**/*.{ts,tsx,mts,cts}'];

export default defineConfig([
  globalIgnores([
    'dist/**/*',
    'coverage/**/*',
    '.angular/**/*',
    'www/**/*',
    'ios/App/App/public/**/*',
    'ios/App/App/capacitor.config.json',
  ]),

  {
    ...importX.flatConfigs.recommended,
    files: jsTsFiles,
  },
  {
    ...importX.flatConfigs.typescript,
    files: jsTsFiles,
  },
  ...tseslintConfigs.strictTypeChecked.map((config) => ({
    ...config,
    files: tsFiles,
  })),
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],

    extends: [...angularConfigs.tsRecommended],
    processor: processInlineTemplates,

    plugins: {
      'import-x': importX,
      'unused-imports': unusedImports,
    },

    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',

      parserOptions: {
        // First match wins: server/tsconfig.json must precede the root
        // tsconfig.json, which has no `include` and would otherwise claim
        // server files without the server's vitest/node types.
        project: [
          'tsconfig.app.json',
          'tsconfig.spec.json',
          'server/tsconfig.json',
          'tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      '@angular-eslint/prefer-standalone': 'off',

      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],

      '@angular-eslint/component-class-suffix': [
        'error',
        {
          suffixes: ['Page', 'Component'],
        },
      ],

      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],

      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],

      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'Capacitor',
          message:
            'Do not use window.Capacitor directly. Import Capacitor plugins from their @capacitor/* packages.',
        },
        {
          object: 'Capacitor',
          property: 'Plugins',
          message:
            'Do not use Capacitor.Plugins directly. Import Capacitor plugins from their @capacitor/* packages.',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angularConfigs.templateRecommended],
    rules: {},
  },
]);
