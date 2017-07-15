module.exports = {
  'env': {
    'browser': false,
    'es6': true,
    'node': true,
    'jasmine': true,
  },
  'extends': ['eslint:recommended'],
  'parser': 'babel-eslint',
  'parserOptions': {
    'ecmaVersion': 6,
    'sourceType': 'module'
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
      { 'allow': ['warn', 'error', 'info'] },
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
    'no-empty': [2, { 'allowEmptyCatch': true }]
  },
};