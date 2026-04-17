import globals from 'globals';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  {
    // Submodules (ssp-relay-dashboard, ssp-relay-enterprise) have their own
    // lint/format tooling and separate node_modules with plugins the parent
    // doesn't install (e.g. prettier-plugin-tailwindcss in the dashboard).
    ignores: [
      'ssp-relay-dashboard/**',
      'ssp-relay-enterprise/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended, // TBD recommendedTypeChecked
  eslintPluginPrettierRecommended,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      // parserOptions: {
      //   projectService: {
      //     allowDefaultProject: ['*.js', '*.ts'],
      //     defaultProject: './tsconfig.json',
      //   },
      //   tsconfigRootDir: import.meta.dirname,
      // },
      globals: {
        ...globals.es2020,
        ...globals.node,
        ...globals.mocha,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
