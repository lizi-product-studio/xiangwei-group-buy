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
    files: ['prototypes/xiangwei-group-buy-system-20260914/verify.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', location: 'readonly' } },
  },
  {
    files: ['prototypes/xiangwei-group-buy-system-20260914/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
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
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
