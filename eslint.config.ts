import antfu from '@antfu/eslint-config'

export default antfu(
  {
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
