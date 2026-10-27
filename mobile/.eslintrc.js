module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: ['*.mjs'],
      parser: 'espree',
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      env: { es2022: true },
    },
  ],
};
