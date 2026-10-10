import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/miniprogram_npm/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['prototypes/**/verify.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', location: 'readonly' } },
  },
  {
    files: ['prototypes/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        Blob: 'readonly', URL: 'readonly', FormData: 'readonly', FileReader: 'readonly', structuredClone: 'readonly',
        document: 'readonly', window: 'readonly', location: 'readonly',
        URLSearchParams: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        HTMLElement: 'readonly', HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly', HTMLSelectElement: 'readonly',
        HTMLTextAreaElement: 'readonly', Event: 'readonly', CSS: 'readonly',
        console: 'readonly', alert: 'readonly', confirm: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly',
      },
    },
  },
  {
    files: ['prototypes/**/*.js'],
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],
      'no-useless-escape': ['error', { allowRegexCharacters: ['-'] }],
    },
  },
  {
    files: ['prototypes/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', process: 'readonly', console: 'readonly', __dirname: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
