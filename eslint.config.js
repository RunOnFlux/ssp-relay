import globals from 'globals';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import mochaPlugin from 'eslint-plugin-mocha';

export default [
  eslint.configs.recommended,
  // ...tseslint.configs.recommendedTypeChecked, // TODO switch to this
  ...tseslint.configs.recommended,
  mochaPlugin.configs.flat.recommended,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      // parserOptions: {
      //   projectService: {
      //     allowDefaultProject: ['./*.js'],
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
  },
  { files: ['**/*.{js,mjs,cjs,ts}'] },
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
