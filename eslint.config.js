// ESLint flat config (ESLint 9+/10). The file exports an array of config
// objects that are applied in order; later entries override earlier ones.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Build output, browser reports and local-only (copyrighted/downloaded) files.
    ignores: [
      'node_modules/',
      'dist/',
      'test-results/',
      'playwright-report/',
      'roms/',
      'discs/',
      'test-fixtures/',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        // Lint each file with type information from tsconfig.json.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Project rules from CLAUDE.md. Already in strictTypeChecked, but spelled
      // out so they are visible here and survive preset changes.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // "Exported functions have explicit return types."
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
  {
    // "The core is DOM-free": browser globals only in src/web/ and the entry
    // point. tsconfig includes the DOM lib for the web layer, so without this
    // rule typecheck would happily accept `document` in the CPU.
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    ignores: ['src/web/**', 'src/main.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['document', 'window', 'navigator', 'requestAnimationFrame', 'HTMLElement'].map((name) => ({
          name,
          message: 'The emulator core is DOM-free. Browser code belongs in src/web/.',
        })),
      ],
    },
  },
);
