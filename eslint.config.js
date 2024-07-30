const globals = require('globals');
const pluginJs = require('@eslint/js');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');
const mochaPlugin = require('eslint-plugin-mocha');

module.exports = [
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  mochaPlugin.configs.flat.recommended,
  eslintPluginPrettierRecommended,
  { files: ['**/*.{js,mjs,cjs,ts}'] },
  { files: ['**/*.js'], languageOptions: { sourceType: 'commonjs' } },
  pluginJs.configs.recommended,
];
