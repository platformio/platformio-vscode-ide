/**
 * Unit tests for shellTokenize.
 *
 * Run with:  node src/shellTokenize.test.js
 */

'use strict';

const shellTokenize = require('./shellTokenize');

// --- tiny test harness ---

let passed = 0;
let failed = 0;

function assertTokens(label, input, isWindows, expected) {
  const actual = shellTokenize(input, isWindows);
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  input:    ${JSON.stringify(input)}  (isWindows=${isWindows})`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// ─── Windows (IS_WINDOWS = true) ────────────────────────────────────────────

assertTokens('WIN: plain Windows path as single token', 'C:\\path\\to\\inc', true, [
  'C:\\path\\to\\inc',
]);

assertTokens('WIN: -I with Windows path', '-IC:\\SDK\\include', true, [
  '-IC:\\SDK\\include',
]);

assertTokens(
  'WIN: multiple args with Windows paths',
  'gcc -IC:\\SDK\\include -o C:\\out\\a.o -c C:\\src\\main.c',
  true,
  ['gcc', '-IC:\\SDK\\include', '-o', 'C:\\out\\a.o', '-c', 'C:\\src\\main.c'],
);

assertTokens(
  'WIN: -DFOO=\\"bar baz\\" (each \\" is a literal quote, no quoting toggle)',
  '-DFOO=\\"bar baz\\"',
  true,
  // \" (odd count=1) → literal " without toggling quote mode, so the space
  // still splits tokens.  This matches MSVC/LLVM behavior.
  ['-DFOO="bar', 'baz"'],
);

assertTokens(
  'WIN: -DFOO=\\\\"bar baz\\\\" (even \\\\ + " toggles quote mode)',
  '-DFOO=\\\\"bar baz\\\\"',
  true,
  // \\\\" → 2 backslashes (even) + toggle quote: -DFOO=\  then quoted bar baz
  // then \\\\" again closes the quote
  ['-DFOO=\\bar baz\\'],
);

assertTokens(
  'WIN: -DBOARD=\\"Espressif ESP32-S3\\" splits (literal quotes, no quoting)',
  '-DBOARD=\\"Espressif ESP32-S3\\"',
  true,
  ['-DBOARD="Espressif', 'ESP32-S3"'],
);

assertTokens('WIN: whole arg double-quoted with spaces', '"-DFOO=bar baz"', true, [
  '-DFOO=bar baz',
]);

assertTokens(
  'WIN: 2 backslashes + quote → 1 backslash, toggle quote (even rule)',
  'a\\\\"b c"',
  true,
  ['a\\b c'],
);

assertTokens(
  'WIN: 3 backslashes + quote → 1 backslash + literal quote (odd rule)',
  'a\\\\\\"b',
  true,
  ['a\\"b'],
);

assertTokens(
  'WIN: 4 backslashes + quote → 2 backslashes, toggle quote',
  'a\\\\\\\\"b c"',
  true,
  ['a\\\\b c'],
);

assertTokens(
  'WIN: trailing backslash in quoted string "C:\\dir\\"',
  '"C:\\dir\\"',
  true,
  // The \" at end is odd-count (1) → literal quote, no toggle → quote stays open.
  // Everything until end-of-string is inside the quote.
  ['C:\\dir"'],
);

assertTokens('WIN: empty double-quoted token', 'a "" b', true, ['a', '', 'b']);

assertTokens(
  'WIN: single quotes are literal (not quoting characters)',
  "a 'hello world' b",
  true,
  ['a', "'hello", "world'", 'b'],
);

assertTokens('WIN: backslashes before non-quote are literal', 'C:\\a\\b\\c d', true, [
  'C:\\a\\b\\c',
  'd',
]);

assertTokens(
  'WIN: single backslash at end of input (no char follows)',
  'abc\\',
  true,
  // The guard `i + 1 < cmd.length` fails for trailing \, so it falls through
  // to the default branch and is appended literally.
  ['abc\\'],
);

// Intentional deviation from full MSVC semantics: consecutive double-quotes
// ("") inside a quoted region are NOT collapsed into a literal '"'.  PIO's
// compile_commands.json uses backslash-escaping for quotes, never "", so
// this rule is unnecessary.  The current behavior treats each " as toggling
// quote mode, producing an empty token.
assertTokens(
  'WIN: consecutive "" inside quoted region (intentional deviation from MSVC ""→" rule)',
  '"a""b"',
  true,
  // Full MSVC would produce ['a"b'], but our tokenizer toggles on each " →
  // 'a' (close quote) + '' (open+close empty) + 'b' (open quote) all
  // concatenated into the same token because no space separates them.
  ['ab'],
);

// ─── POSIX (IS_WINDOWS = false) ─────────────────────────────────────────────

assertTokens('POSIX: backslash-n escape', 'a\\nb', false, ['anb']);

assertTokens('POSIX: backslash-backslash produces single backslash', 'a\\\\b', false, [
  'a\\b',
]);

assertTokens('POSIX: backslash-quote produces literal quote', 'a\\"b', false, ['a"b']);

assertTokens('POSIX: backslash-space keeps space in token', 'a\\ b c', false, [
  'a b',
  'c',
]);

assertTokens('POSIX: double-quoted string with spaces', '"hello world" foo', false, [
  'hello world',
  'foo',
]);

assertTokens(
  'POSIX: single-quoted string preserves backslash literally',
  "'a\\b'",
  false,
  ['a\\b'],
);

assertTokens('POSIX: empty double-quoted token', 'a "" b', false, ['a', '', 'b']);

assertTokens('POSIX: empty single-quoted token', "a '' b", false, ['a', '', 'b']);

assertTokens(
  'POSIX: mixed quoting styles',
  'gcc -DFOO="hello world" -DBAR=\'baz qux\'',
  false,
  ['gcc', '-DFOO=hello world', '-DBAR=baz qux'],
);

assertTokens('POSIX: trailing backslash (no char follows) preserved', 'abc\\', false, [
  'abc\\',
]);

// ─── Whitespace delimiters (tabs, \r) ───────────────────────────────────────

assertTokens('WIN: tab as delimiter', 'a\tb\tc', true, ['a', 'b', 'c']);

assertTokens('POSIX: tab as delimiter', 'a\tb\tc', false, ['a', 'b', 'c']);

assertTokens(
  'WIN: \\r\\n line ending does not leak \\r into token',
  'gcc -c file.c\r\n',
  true,
  ['gcc', '-c', 'file.c'],
);

assertTokens(
  'POSIX: \\r\\n line ending does not leak \\r into token',
  'gcc -c file.c\r\n',
  false,
  ['gcc', '-c', 'file.c'],
);

assertTokens('WIN: tabs inside double-quoted string are literal', '"a\tb"', true, [
  'a\tb',
]);

assertTokens('POSIX: tabs inside double-quoted string are literal', '"a\tb"', false, [
  'a\tb',
]);

// ─── Summary ────────────────────────────────────────────────────────────────

process.stdout.write(
  `\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`,
);
if (failed > 0) {
  process.exit(1);
}
