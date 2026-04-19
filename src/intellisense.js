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
import shellTokenizeImpl from './shellTokenize';
import vscode from 'vscode';

function shellTokenize(cmd) {
  return shellTokenizeImpl(cmd, IS_WINDOWS);
}

/** Include-path flags that accept a directory argument (longest first). */
const INCLUDE_FLAGS = ['-idirafter', '-isystem', '-iquote', '-I'];

/**
 * Flags whose argument is a *file* path, always in separated form only
 * (GCC/Clang never accept a joined form like -include<file>).
 */
const INCLUDE_FILE_FLAGS = ['-include-pch', '-include', '-imacros'];

/**
 * Convert relative include-path arguments to absolute.
 *
 * For directory-style flags (-I, -isystem, -iquote, -idirafter):
 *   resolve relative to `dir`.
 *
 * For file-style flags (-include, -include-pch, -imacros):
 *   search the full include-path list (both absolute AND relative entries,
 *   all pre-resolved to absolute) for the file, then fall back to `dir`.
 *   This mirrors the compiler's own resolution order.
 */
async function absolutizeIncludes(args, dir) {
  // ── Pass 1: collect every include directory (absolutize relative ones). ──
  const includeDirs = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];

    // Separated form:  -I <path>
    const sep = INCLUDE_FLAGS.find((f) => a === f);
    if (sep && i + 1 < args.length) {
      const p = args[i + 1];
      // ★ key change: absolutize relative dirs here, not just absolute ones
      includeDirs.push(path.isAbsolute(p) ? p : path.join(dir, p));
      i++;
      continue;
    }

    // Joined form:  -I<path>
    for (const flag of INCLUDE_FLAGS) {
      if (a.startsWith(flag) && a.length > flag.length) {
        const p = a.slice(flag.length);
        includeDirs.push(path.isAbsolute(p) ? p : path.join(dir, p));
        break;
      }
    }
  }

  // ── Pass 2: absolutize every include argument. ──
  for (let i = 1; i < args.length; i++) {
    const a = args[i];

    // Separated directory flag:  -I <path>
    const sepDirMatch = INCLUDE_FLAGS.find((f) => a === f);
    if (sepDirMatch && i + 1 < args.length) {
      if (!path.isAbsolute(args[i + 1])) {
        args[i + 1] = path.join(dir, args[i + 1]);
      }
      i++;
      continue;
    }

    // Separated file flag:  -include <file>
    const sepFileMatch = INCLUDE_FILE_FLAGS.find((f) => a === f);
    if (sepFileMatch && i + 1 < args.length) {
      const rel = args[i + 1];
      if (!path.isAbsolute(rel)) {
        // Walk include dirs in order (same as the compiler would).
        let resolved = null;
        for (const d of includeDirs) {
          const candidate = path.join(d, rel);
          try {
            await fs.access(candidate);
            resolved = candidate;
            break;
          } catch {
            // not in this dir — keep searching
          }
        }
        // Fallback: resolve relative to compilation dir (should be rare).
        args[i + 1] = resolved ?? path.join(dir, rel);
      }
      i++;
      continue;
    }

    // Joined directory flag:  -I<path>
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
 * Ensure compile_commands.json will be generated for clangd.
 *
 * When a project is opened with the clangd backend and no
 * compile_commands.json is present yet (e.g. first open, or after a clean),
 * we trigger a rebuild via the project observer.  The observer's
 * `rebuildIndex` runs `pio run --target compiledb` which waits for PIO's
 * full pre-build process (LDF, dependency resolution, etc.) to complete
 * before writing compile_commands.json.  The `onDidRebuildIndex` callback
 * then post-processes the file.
 *
 * This avoids a race where a separate `pio run` would start in parallel
 * with the observer's own rebuild.
 */
export async function ensureCompileCommands(projectDir, observer) {
  if (
    getActiveBackendId() !== 'clangd' ||
    !projectDir ||
    !isBackendExtensionInstalled() ||
    !observer
  ) {
    return;
  }
  const ccPath = path.join(projectDir, 'compile_commands.json');
  try {
    await fs.access(ccPath);
    return; // already exists
  } catch {
    // file does not exist – trigger a rebuild via the observer
  }
  observer.rebuildIndex({ force: true });
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
        // On Windows, PIO emits bare names without .exe – try both variants.
        const candidates =
          IS_WINDOWS && !bare.endsWith('.exe')
            ? [candidate + '.exe', candidate]
            : [candidate];
        for (const c of candidates) {
          try {
            await fs.access(c);
            resolveCache.set(bare, c);
            return c;
          } catch {
            // not here
          }
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
    await absolutizeIncludes(args, dir);

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

/**
 * Search for Espressif's clangd binary in the PlatformIO packages directory.
 *
 * Espressif ships a patched clangd that understands Xtensa and ESP RISC-V
 * custom extensions (xespv, xesploop, xespdsp, etc.) natively — the upstream
 * clangd does not.  The binary may live in:
 *   1. A dedicated clangd package:  packages/tool-clangd-esp/esp-clangd/bin/clangd
 *   2. The full clang toolchain:    packages/toolchain-clang-esp/esp-clang/bin/clangd
 *
 * Returns the absolute path to the clangd binary, or null if not found.
 */
async function findEspClangd() {
  const packagesDir = path.join(pioNodeHelpers.core.getCoreDir(), 'packages');
  const exe = IS_WINDOWS ? 'clangd.exe' : 'clangd';
  const candidates = [
    path.join(packagesDir, 'tool-clangd-esp', 'bin', exe),
    path.join(packagesDir, 'tool-clangd-esp', 'esp-clangd', 'bin', exe),
    path.join(packagesDir, 'toolchain-clang-esp', 'esp-clang', 'bin', exe),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // not installed here
    }
  }
  return null;
}

/**
 * Ensure a .clangd config file exists in the project directory with
 * BuiltinHeaders: QueryDriver.
 *
 * By default clangd replaces the cross-compiler's built-in headers
 * (stddef.h, stdbool.h, etc.) with its own, which are built for the
 * host rather than the embedded target.  This causes false errors such
 * as "'stdbool.h' file not found" or libc++ vs libstdc++ mismatches.
 *
 * Setting BuiltinHeaders to QueryDriver tells clangd (≥ 21) to keep
 * the headers reported by --query-driver instead of substituting its own.
 */
export async function ensureClangdConfig(projectDir) {
  if (
    getActiveBackendId() !== 'clangd' ||
    !projectDir ||
    !isBackendExtensionInstalled()
  ) {
    return;
  }
  const configPath = path.join(projectDir, '.clangd');

  let existing = '';
  try {
    existing = await fs.readFile(configPath, 'utf-8');
  } catch {
    // file does not exist yet
  }

  const hasBuiltinHeaders = existing.includes('BuiltinHeaders');
  const hasSuppressDiag = existing.includes('pp_expects_filename');

  // Already contains both directives – nothing to do
  if (hasBuiltinHeaders && hasSuppressDiag) {
    return;
  }

  // Build only the missing parts
  const parts = [];
  if (!hasBuiltinHeaders) {
    parts.push('CompileFlags:\n  BuiltinHeaders: QueryDriver');
  }
  if (!hasSuppressDiag) {
    parts.push('Diagnostics:\n  Suppress: [pp_expects_filename]');
  }
  const block = parts.join('\n') + '\n';

  // Prepend the block (separated by ---) so we don't clobber user settings
  const content = existing ? block + '---\n' + existing : block;

  await fs.writeFile(configPath, content, 'utf-8');
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

  // Use Espressif's clangd when available — it has native Xtensa / ESP RISC-V
  // support which the stock clangd lacks.
  const espClangd = await findEspClangd();
  if (espClangd) {
    const inspected = config.inspect('path');
    const currentPath = inspected
      ? (inspected.workspaceValue ?? inspected.globalValue)
      : undefined;
    if (currentPath !== espClangd) {
      await config.update('path', espClangd, vscode.ConfigurationTarget.Workspace);
    }
  }

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
