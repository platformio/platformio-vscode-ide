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
    'sourceType': 'module',
  },
  'plugins': [
    'sort-imports-es6-autofix',
  ],
  'rules': {
    'brace-style': ['error', '1tbs'],
    'comma-dangle': ['error', {
      'arrays': 'always-multiline',
      'objects': 'always-multiline',
      'functions': 'never',
    }],
    'curly': ['warn', 'all'],
    'indent': [
      'warn',
      2,
      {
        'SwitchCase': 1,
      },
    ],
    'linebreak-style': ['error', 'unix'],
    'no-console': [
      'error',
      {
        'allow': ['log', 'error'],
      },
    ],
    'no-var': 'error',
    'object-curly-spacing': ['warn', 'always'],
    'prefer-const': 'error',
    'quotes': ['error', 'single', 'avoid-escape'],
    'semi': ['error', 'always'],
    'sort-imports-es6-autofix/sort-imports-es6': [2, {
      'ignoreCase': false,
      'ignoreMemberSort': false,
      'memberSyntaxSortOrder': ['none', 'all', 'multiple', 'single'],
    }],
    'space-infix-ops': 'warn',
  },
};
