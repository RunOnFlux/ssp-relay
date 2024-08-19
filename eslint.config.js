import globals from 'globals';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import mochaPlugin from 'eslint-plugin-mocha';

export default [
  mochaPlugin.configs.flat.recommended,
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
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
