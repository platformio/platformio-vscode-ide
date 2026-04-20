/**
 * Tokenize a shell command string into an argv array.
 *
 * On POSIX this follows GNU shell rules (backslash escapes, single & double
 * quotes).  On Windows backslashes are NOT treated as escape characters so
 * that paths like C:\SDK\include survive intact – matching the behaviour of
 * LLVM's TokenizeWindowsCommandLine.
 *
 * NOTE: The canonical MSVC rule also treats consecutive double-quotes ("")
 * inside a quoted region as a single literal '"'.  We intentionally omit
 * this because PlatformIO's compile_commands.json never produces that
 * pattern — it uses backslash-escaping instead.
 *
 * Empty quoted strings ("" or '') produce an empty-string token.
 *
 * @param {string} cmd - The command string to tokenize.
 * @param {boolean} isWindows - Use Windows (MSVC) tokenization rules.
 */
function shellTokenize(cmd, isWindows) {
  const tokens = [];
  let current = '';
  let hasContent = false;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === '\\' && !inSingle && i + 1 < cmd.length) {
      if (isWindows) {
        // LLVM/MSVC backslash-quote rule: count consecutive backslashes
        // preceding a double-quote.  2n backslashes + " → n backslashes,
        // toggle quote mode.  2n+1 backslashes + " → n backslashes + literal
        // '"' (no toggle).  Backslashes NOT followed by a double-quote are
        // kept literally (preserving Windows paths like C:\SDK\include).
        let numSlashes = 0;
        while (i < cmd.length && cmd[i] === '\\') {
          numSlashes++;
          i++;
        }
        if (i < cmd.length && cmd[i] === '"') {
          // Backslashes followed by a double-quote
          const literalSlashes = Math.floor(numSlashes / 2);
          current += '\\'.repeat(literalSlashes);
          if (numSlashes % 2 === 1) {
            // Odd run: last backslash escapes the quote → literal '"'
            current += '"';
          } else {
            // Even run: quote is unescaped → toggle quote mode
            inDouble = !inDouble;
          }
        } else {
          // Backslashes not followed by a quote → all literal
          current += '\\'.repeat(numSlashes);
          i--; // re-examine the non-quote character on next iteration
        }
        hasContent = true;
      } else {
        const next = cmd[i + 1];
        if (
          inDouble &&
          next !== '$' &&
          next !== '`' &&
          next !== '"' &&
          next !== '\\' &&
          next !== '\n'
        ) {
          current += '\\' + next;
        } else {
          current += next;
        }
        i++;
        hasContent = true;
      }
    } else if (ch === "'" && !inDouble && !isWindows) {
      // Single quotes toggle quoting on POSIX only; on Windows they are literal.
      inSingle = !inSingle;
      hasContent = true;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasContent = true;
    } else if (
      (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') &&
      !inSingle &&
      !inDouble
    ) {
      if (current.length > 0 || hasContent) {
        tokens.push(current);
        current = '';
        hasContent = false;
      }
    } else {
      current += ch;
      hasContent = true;
    }
  }
  if (current.length > 0 || hasContent) {
    tokens.push(current);
  }
  return tokens;
}

module.exports = shellTokenize;
