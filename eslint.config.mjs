import js from '@eslint/js';
import yml from 'eslint-plugin-yml';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  {
    files: ['**/*.{js,cjs,mjs,ts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  ...yml.configs['flat/standard'],
  {
    files: ['**/*.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);