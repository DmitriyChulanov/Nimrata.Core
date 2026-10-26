import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      prettier,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Платформа не знает о расширениях: импорт из extensions/, @tasks и @notes запрещён.
    files: ['src/platform/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tasks', '@tasks/*', '@notes', '@notes/*', '**/extensions/**', '@/extensions/**'],
              message: 'platform/ не должна импортировать из extensions/.',
            },
          ],
        },
      ],
    },
  },
  {
    // Расширения независимы: «Трекер задач» не импортирует «Трекер заметок» и наоборот.
    files: ['src/extensions/tasks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@notes', '@notes/*', '**/extensions/notes/**', '@/extensions/notes/**', '../notes/**'],
              message: 'Расширения не импортируют друг друга: общий код выносится в platform/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/extensions/notes/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tasks', '@tasks/*', '**/extensions/tasks/**', '@/extensions/tasks/**', '../tasks/**'],
              message: 'Расширения не импортируют друг друга: общий код выносится в platform/.',
            },
          ],
        },
      ],
    },
  },
])
