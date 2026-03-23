/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'pioarduino-node-helpers';
import {
  INTELLISENSE_BACKENDS,
  IS_WINDOWS,
  getConflictedExtensionIds,
} from './constants';
import { extension } from './main';
import { promises as fs } from 'fs';
import path from 'path';
import vscode from 'vscode';

/**
 * Tokenize a shell command string into an argv array.
 *
 * On POSIX this follows GNU shell rules (backslash escapes, single & double
 * quotes).  On Windows backslashes are NOT treated as escape characters so
 * that paths like C:\SDK\include survive intact – matching the behaviour of
 * LLVM's TokenizeWindowsCommandLine.
 *
 * Empty quoted strings ("" or '') produce an empty-string token.
 */
function shellTokenize(cmd) {
  const tokens = [];
  let current = '';
  let hasContent = false;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (!IS_WINDOWS && ch === '\\' && !inSingle && i + 1 < cmd.length) {
      current += cmd[++i];
      hasContent = true;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasContent = true;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasContent = true;
    } else if (ch === ' ' && !inSingle && !inDouble) {
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

/** Include-path flags that accept a directory argument (longest first). */
const INCLUDE_FLAGS = ['-idirafter', '-isystem', '-iquote', '-I'];

/**
 * Convert relative include-path arguments to absolute.
 * Handles both joined (-Ipath) and separated (-I path) forms for every flag
 * in INCLUDE_FLAGS.
 */
function absolutizeIncludes(args, dir) {
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    // Separated form: flag <path>
    const separatedMatch = INCLUDE_FLAGS.find((f) => a === f);
    if (separatedMatch && i + 1 < args.length) {
      if (!path.isAbsolute(args[i + 1])) {
        args[i + 1] = path.join(dir, args[i + 1]);
      }
      i++;
      continue;
    }
    // Joined form: flag<path> (match longest prefix first)
    for (const flag of INCLUDE_FLAGS) {
      if (a.startsWith(flag) && a.length > flag.length) {
        const v = a.slice(flag.length);
        if (!path.isAbsolute(v)) {
          args[i] = flag + path.join(dir, v);
        }
        break;
      }
    }
  }
}

export function getActiveBackendId() {
  return extension.getConfiguration('intelliSenseEngine') || 'cpptools';
}

export function getActiveBackend() {
  const id = getActiveBackendId();
  return INTELLISENSE_BACKENDS[id] || INTELLISENSE_BACKENDS.cpptools;
}

export function getActiveConflictedExtensionIds() {
  return getConflictedExtensionIds(getActiveBackendId());
}

export function isBackendExtensionInstalled() {
  const backend = getActiveBackend();
  return !!vscode.extensions.getExtension(backend.extensionId);
}

export async function applyBackendConfigDefaults() {
  const backend = getActiveBackend();
  if (!isBackendExtensionInstalled()) {
    return;
  }
  const otherBackendValues = collectOtherBackendValues(backend.id);
  const config = vscode.workspace.getConfiguration();

  for (const [key, value] of Object.entries(backend.configDefaults)) {
    const inspected = config.inspect(key);
    const currentGlobal = inspected ? inspected.globalValue : undefined;
    const currentWorkspace = inspected ? inspected.workspaceValue : undefined;

    const isUnset = currentGlobal === undefined && currentWorkspace === undefined;
    const wasSetByOtherBackend =
      key in otherBackendValues && currentGlobal === otherBackendValues[key];

    if (isUnset || wasSetByOtherBackend) {
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
  }
}

function collectOtherBackendValues(activeId) {
  const values = {};
  for (const [id, backend] of Object.entries(INTELLISENSE_BACKENDS)) {
    if (id === activeId) {
      continue;
    }
    Object.assign(values, backend.configDefaults);
  }
  return values;
}

/**
 * Post-process compile_commands.json so clangd works correctly:
 *  1. Resolve bare compiler names to absolute paths so --query-driver matches.
 *  2. Convert relative -I include paths to absolute so clangd finds headers.
 *  3. Convert relative "file" entries to absolute.
 *  4. Add synthetic entries for header files included from other directories
 *     so clangd can match them (it uses directory proximity heuristics).
 */
export async function fixupCompileCommands(projectDir) {
  if (
    getActiveBackendId() !== 'clangd' ||
    !projectDir ||
    !isBackendExtensionInstalled()
  ) {
    return;
  }
  const ccPath = path.join(projectDir, 'compile_commands.json');
  let raw;
  try {
    raw = await fs.readFile(ccPath, 'utf-8');
  } catch {
    return;
  }

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    return;
  }

  const resolveCache = new Map();
  const packagesDir = path.join(pioNodeHelpers.core.getCoreDir(), 'packages');

  async function resolveCompiler(bare) {
    if (resolveCache.has(bare)) {
      return resolveCache.get(bare);
    }
    try {
      const dirs = await fs.readdir(packagesDir);
      for (const d of dirs) {
        if (!d.startsWith('toolchain-') && !d.startsWith('tool-')) {
          continue;
        }
        const candidate = path.join(packagesDir, d, 'bin', bare);
        try {
          await fs.access(candidate);
          resolveCache.set(bare, candidate);
          return candidate;
        } catch {
          // not here
        }
      }
    } catch {
      // packagesDir unreadable
    }
    resolveCache.set(bare, null);
    return null;
  }

  const SKIP_DIRS = new Set(['node_modules', '.pio', '.git', 'build', '__pycache__']);

  async function walkDir(dir) {
    const result = [];
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return result;
    }
    for (const d of dirents) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (d.name.startsWith('.') || SKIP_DIRS.has(d.name)) {
          continue;
        }
        result.push(...(await walkDir(full)));
      } else if (/\.(h|hpp|c|cpp|cc|cxx|ino)$/i.test(d.name)) {
        result.push(full);
      }
    }
    return result;
  }

  const existingFiles = new Set();
  for (const entry of entries) {
    const dir = entry.directory || projectDir;

    if (entry.file && !path.isAbsolute(entry.file)) {
      entry.file = path.join(dir, entry.file);
    }
    existingFiles.add(entry.file);

    if (!entry.command && !entry.arguments) {
      continue;
    }

    const args = entry.arguments || shellTokenize(entry.command);

    // 1. Resolve bare compiler name
    const compiler = args[0];
    if (compiler && !compiler.includes('/') && !compiler.includes('\\')) {
      const resolved = await resolveCompiler(compiler);
      if (resolved) {
        args[0] = resolved;
      }
    }

    // 2. Convert relative include paths to absolute
    absolutizeIncludes(args, dir);

    // Write back as arguments array (preferred by clangd, avoids quoting issues)
    entry.arguments = args;
    delete entry.command;
  }

  // 3. Add synthetic entries for project header/source files that aren't in
  //    the compilation database. clangd uses directory proximity to match
  //    headers to compile commands; files in directories like usermods/ that
  //    have no .cpp entry nearby get no flags and lose all IntelliSense.
  //    We find a representative project entry and clone its flags for every
  //    missing file.
  const pioBuildDir = `${path.sep}.pio${path.sep}`;
  const pioCoreDir = `${path.sep}.platformio${path.sep}`;
  const projectSrcEntries = entries.filter(
    (e) =>
      e.file &&
      (e.arguments || e.command) &&
      e.file.startsWith(projectDir) &&
      !e.file.includes(pioBuildDir) &&
      !e.file.includes(pioCoreDir),
  );

  // Pick the entry with the richest include set (most -I flags) as template
  let templateEntry = projectSrcEntries[0];
  let maxIncludes = 0;
  for (const e of projectSrcEntries) {
    const args = e.arguments || [];
    const count = args.filter((a) => INCLUDE_FLAGS.some((f) => a.startsWith(f))).length;
    if (count > maxIncludes) {
      maxIncludes = count;
      templateEntry = e;
    }
  }

  if (templateEntry) {
    const templateArgs =
      templateEntry.arguments || shellTokenize(templateEntry.command);
    // Remove -o <output> from template and replace the source file
    const filteredArgs = [];
    for (let i = 0; i < templateArgs.length; i++) {
      if (templateArgs[i] === '-o' && i + 1 < templateArgs.length) {
        filteredArgs.push('-o', IS_WINDOWS ? 'NUL' : '/dev/null');
        i++; // skip original output path
      } else {
        filteredArgs.push(templateArgs[i]);
      }
    }
    const templateDir = templateEntry.directory;
    const templateFile = templateEntry.file;

    const allProjectFiles = await walkDir(projectDir);
    const syntheticEntries = [];

    for (const file of allProjectFiles) {
      if (existingFiles.has(file)) {
        continue;
      }
      const syntheticArgs = filteredArgs.map((a) => (a === templateFile ? file : a));
      syntheticEntries.push({
        directory: templateDir,
        arguments: syntheticArgs,
        file,
      });
    }

    if (syntheticEntries.length > 0) {
      entries.push(...syntheticEntries);
    }
  }

  await fs.writeFile(ccPath, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
}

export async function ensureClangdArgs(projectDir) {
  if (
    getActiveBackendId() !== 'clangd' ||
    !projectDir ||
    !isBackendExtensionInstalled()
  ) {
    return;
  }
  const config = vscode.workspace.getConfiguration('clangd');
  const currentArgs = config.get('arguments') || [];
  const newArgs = [...currentArgs];
  let changed = false;

  // --compile-commands-dir: tell clangd where compile_commands.json lives
  const compileCommandsFlag = `--compile-commands-dir=${projectDir}`;
  changed =
    upsertArg(newArgs, '--compile-commands-dir=', compileCommandsFlag) || changed;

  // --query-driver: let clangd query PlatformIO cross-compilers for built-in
  // include paths (C++ stdlib, GCC internals, sysroot). Without this, clangd
  // can't resolve system headers for embedded targets like xtensa, arm, riscv.
  const pioDir = pioNodeHelpers.core.getCoreDir();
  const sep = IS_WINDOWS ? '\\' : '/';
  const glob = IS_WINDOWS ? '*\\bin\\*' : '*/bin/*';
  const queryDriverGlob = [
    `${pioDir}${sep}packages${sep}toolchain-${glob}`,
    `${pioDir}${sep}packages${sep}tool-${glob}`,
  ].join(',');
  const queryDriverFlag = `--query-driver=${queryDriverGlob}`;
  changed = upsertArg(newArgs, '--query-driver=', queryDriverFlag) || changed;

  if (changed) {
    await config.update('arguments', newArgs, vscode.ConfigurationTarget.Workspace);
  }
}

function upsertArg(args, prefix, value) {
  const idx = args.findIndex((a) => a.startsWith(prefix));
  if (idx !== -1) {
    if (args[idx] === value) {
      return false;
    }
    args[idx] = value;
    return true;
  }
  args.push(value);
  return true;
}

/**
 * Ensure .vscode/launch.json exists for debugging.
 *
 * When the cpptools backend is active, `pio project init --ide vscode` creates
 * this file automatically. The clangd backend uses `pio run --target compiledb`
 * instead, which only produces compile_commands.json. Without launch.json the
 * debugger has no configuration to start from, so we run
 * `pio project init --ide vscode` to generate the full debug configuration
 * (executable, toolchainBinDir, svdPath, preLaunchTask, etc.).
 */
export async function ensureLaunchJson(projectDir) {
  if (!projectDir) {
    return;
  }
  const launchPath = path.join(projectDir, '.vscode', 'launch.json');
  try {
    await fs.access(launchPath);
    return; // already exists
  } catch {
    // file does not exist – generate it via CLI
  }
  try {
    await pioNodeHelpers.core.getPIOCommandOutput(
      ['project', 'init', '--ide', 'vscode'],
      { projectDir },
    );
  } catch (err) {
    console.warn(`Failed to generate launch.json: ${err.message}`);
  }
}

export async function notifyRescanBackend() {
  const backend = getActiveBackend();
  if (!backend.rescanCommand || !isBackendExtensionInstalled()) {
    return;
  }
  try {
    await vscode.commands.executeCommand(backend.rescanCommand);
  } catch (err) {
    console.warn(
      `Failed to execute rescan command "${backend.rescanCommand}": ${err.message}`,
    );
  }
}

export function warnIfBackendMissing() {
  if (isBackendExtensionInstalled()) {
    return;
  }
  const backend = getActiveBackend();
  const appName = (vscode.env.appName || '').toLowerCase();
  const isVSCodeHost = appName.includes('visual studio code') || appName === 'code';
  const clangdInstalled = !!vscode.extensions.getExtension(
    INTELLISENSE_BACKENDS.clangd.extensionId,
  );

  // Friendly fallback path for non-VS Code hosts: if cpptools is missing,
  // help users switch to clangd or discover alternative C++ extensions.
  if (backend.id === 'cpptools' && !isVSCodeHost) {
    const switchTitle = clangdInstalled
      ? 'Switch to clangd'
      : 'Find clangd / Anysphere C++';
    vscode.window
      .showWarningMessage(
        'PlatformIO: cpptools is selected for IntelliSense, but it is not installed. ' +
          'You can switch PlatformIO IntelliSense to clangd instead.',
        { title: switchTitle, isCloseAffordance: false },
        { title: 'Install cpptools', isCloseAffordance: false },
        { title: 'Dismiss', isCloseAffordance: true },
      )
      .then(async (selected) => {
        if (!selected) {
          return;
        }

        if (selected.title === 'Install cpptools') {
          vscode.commands.executeCommand(
            'workbench.extensions.search',
            backend.extensionId,
          );
          return;
        }

        if (selected.title === 'Switch to clangd') {
          await vscode.workspace
            .getConfiguration('platformio-ide')
            .update('intelliSenseEngine', 'clangd', vscode.ConfigurationTarget.Global);
          await applyBackendConfigDefaults();
          const reload = await vscode.window.showInformationMessage(
            'PlatformIO IntelliSense engine was switched to clangd. Reload window to apply fully.',
            'Reload Window',
          );
          if (reload === 'Reload Window') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
          return;
        }

        if (selected.title === 'Find clangd / Anysphere C++') {
          vscode.commands.executeCommand(
            'workbench.extensions.search',
            'clangd anysphere c++',
          );
        }
      });
    return;
  }

  vscode.window
    .showWarningMessage(
      `PlatformIO: The selected IntelliSense engine "${backend.label}" ` +
        `requires the "${backend.extensionId}" extension, but it is not installed.`,
      { title: 'Install Extension', isCloseAffordance: false },
      { title: 'Dismiss', isCloseAffordance: true },
    )
    .then((selected) => {
      if (selected && selected.title === 'Install Extension') {
        vscode.commands.executeCommand(
          'workbench.extensions.search',
          backend.extensionId,
        );
      }
    });
}
