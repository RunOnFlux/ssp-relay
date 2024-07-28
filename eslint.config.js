import airbnbConfig from 'eslint-config-airbnb-base';
import esLintPlugin from 'eslint-plugin-import';

export default [
    {
        // plugins are not yet fully supported, needed to wait for some fixes
        plugins: { airbnbConfig, esLintPlugin },
        rules: {
          'max-len': [
            'error',
            {
              code: 300,
              ignoreUrls: true,
              ignoreTrailingComments: true,
            },
          ],
          'no-console': 'off',
          'default-param-last': 'off',
          'no-unused-vars': "error",
          // import extensions is having problem with newer version
          // 'import/extensions': [
          //   'error',
          //   "never",
          // ],
          'linebreak-style': [
            'error',
            'unix',
          ],
        },
        languageOptions: {
            parserOptions: {
                parser: 'babel-eslint',
            },
            globals: {
              mocha: true,
              node: true,
              commonjs: true
            },
        },
        // ignore file is replaced with ignores
        ignores: ['/logs/']
    },
    {
      files: [
        '**/__tests__/*.{j,t}s?(x)',
      ],
      languageOptions: {
          globals: {
              mocha: true,
          },
      },
    }
];

  