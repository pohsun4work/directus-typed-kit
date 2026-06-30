import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: [
      // 設計稿屬歷史記錄，非產品程式碼
      'design/**',
    ],
    rules: {
      'antfu/if-newline': 'off',
      'antfu/top-level-function': 'off',
      'jsdoc/multiline-blocks': ['warn', { noZeroLineText: false }],
      'no-console': 'warn',
      'perfectionist/sort-imports': ['error', {
        groups: [
          'side-effect-style',
          'side-effect',
          'style',
          { newlinesBetween: 1 },
          'builtin',
          'external',
          { newlinesBetween: 1 },
          'internal',
          'tsconfig-path',
          'parent',
          'sibling',
          'index',
          'unknown',
          { newlinesBetween: 1 },
          'type',
        ],
        newlinesBetween: 0,
        type: 'alphabetical',
        order: 'asc',
      }],
      'style/arrow-parens': ['error', 'always'],
      // stroustrup 已是 antfu 預設，這條只為開 allowSingleLine 單行例外
      'style/brace-style': ['error', 'stroustrup', { allowSingleLine: true }],
      'style/comma-dangle': ['error', {
        objects: 'always-multiline',
        arrays: 'always-multiline',
        imports: 'always-multiline',
        exports: 'always-multiline',
        functions: 'always-multiline',
      }],
      'style/linebreak-style': ['error', 'unix'],
      'style/max-statements-per-line': ['warn', { max: 2 }],
      'style/member-delimiter-style': ['error', {
        multiline: { delimiter: 'semi', requireLast: true },
        singleline: { delimiter: 'semi', requireLast: false },
        multilineDetection: 'brackets',
      }],
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': 'warn',
    },
  },
  {
    files: ['**/*.json'],
    rules: {
      'style/eol-last': 'off',
    },
  },
)
  // kit 已脫離 monorepo，自管所有依賴版本、無 catalog
  // 關掉 enforce-catalog（而非設 warn）：否則 eslint --fix 會主動為 deps 生成 catalog，
  // 把本套件硬拉回 catalog 模式；off 才能維持「無 catalog、各自 pin 版本」
  .override('antfu/pnpm/package-json', {
    rules: {
      'pnpm/json-enforce-catalog': 'off',
    },
  })
