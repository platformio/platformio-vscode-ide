module.exports = {
  'env': {
    'es6': true,
    'node': true
  },
  'plugins': [
    'import'
  ],
  'extends': [
    'eslint:recommended',
    'plugin:import/errors',
    'plugin:import/warnings'
  ],
  'parserOptions': {
    'sourceType': 'module',
    'ecmaVersion': 13
  },
  'settings': {
    'import/core-modules': [
      'vscode'
    ]
  },
  'rules': {
    'comma-dangle': [
      'error',
      'only-multiline'
    ],
    'curly': [
      'warn',
      'all'
    ],
    'linebreak-style': [
      'error',
      'unix'
    ],
    'no-console': [
      'error',
      {
        'allow': ['warn', 'error', 'info']
      },
    ],
    'prefer-const': 'error',
    'quotes': [
      'error',
      'single',
      'avoid-escape'
    ],
    'semi': [
      'error',
      'always'
    ],
    'sort-imports': [
      'warn',
      {
        'ignoreCase': false,
        'ignoreMemberSort': false,
        'memberSyntaxSortOrder': ['none', 'all', 'multiple', 'single']
      }
    ],
    'no-useless-escape': [
      'off'
    ],
    'no-empty': [2, {
      'allowEmptyCatch': true
    }]
  },
};