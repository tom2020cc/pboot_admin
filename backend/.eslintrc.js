module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    // #每次保存的时候将代码按eslint和tslint格式进行修复
    'editor.codeActionsOnSave': {
      'source.fixAll.eslint': true,
      'eslint.autoFixOnSave': false,
      'source.fixAll.tslint': true,
    },
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    'prettier.trailingComma': 'none',
    'prettier/prettier': [
      'error',
      {
        semi: false,
        wrapAttributes: false,
        printWidth: 150,
        endOfLine: 'auto',
      },
    ],
  },
};
