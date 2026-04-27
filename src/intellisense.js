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
import { execFile } from 'child_process';
import { extension } from './main';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import shellTokenizeImpl from './shellTokenize';
import vscode from 'vscode';

const execFileAsync = promisify(execFile);

function shellTokenize(cmd) {
  return shellTokenizeImpl(cmd, IS_WINDOWS);
}

/** Normalize a filesystem path to forward slashes for use in compiler arguments. */
const toFwd = IS_WINDOWS ? (p) => p.split(path.sep).join('/') : (p) => p;

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
        args[i + 1] = toFwd(path.join(dir, args[i + 1]));
      } else {
        args[i + 1] = toFwd(args[i + 1]);
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
        args[i + 1] = toFwd(resolved ?? path.join(dir, rel));
      } else {
        args[i + 1] = toFwd(args[i + 1]);
      }
      i++;
      continue;
    }

    // Joined directory flag:  -I<path>
    for (const flag of INCLUDE_FLAGS) {
      if (a.startsWith(flag) && a.length > flag.length) {
        const v = a.slice(flag.length);
        if (!path.isAbsolute(v)) {
          args[i] = flag + toFwd(path.join(dir, v));
        } else {
          args[i] = flag + toFwd(v);
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
export async function ensureCompileCommands(projectDir, observer, envDir) {
  if (
    getActiveBackendId() !== 'clangd' ||
    !projectDir ||
    !isBackendExtensionInstalled() ||
    !observer
  ) {
    return;
  }

  // ESP-IDF and Arduino-as-component projects rely on CMake / Ninja to produce
  // compile_commands.json.  Do not trigger `pio run --target compiledb` for
  // these project types — the build system already owns that file.
  if (await isIdfProject(observer, envDir)) {
    const ccPath = envDir ? path.join(envDir, 'compile_commands.json') : null;

    if (!ccPath) {
      return; // envDir unknown — watcher in manager.js will handle it when build completes
    }

    let origStat = null;
    try {
      origStat = await fs.stat(ccPath);
    } catch {
      // File does not exist yet — user must build first.
      vscode.window.showInformationMessage(
        'Build your ESP-IDF project first to generate compile_commands.json for clangd IntelliSense. ' +
          'IntelliSense will activate automatically after the build completes.',
      );
      return;
    }

    // Re-process only when the CMake output is newer than the clangd copy.
    const clangdPath = path.join(
      projectDir,
      '.cache',
      'clangd',
      'compile_commands.json',
    );
    let clangdStat = null;
    try {
      clangdStat = await fs.stat(clangdPath);
    } catch {
      // clangd copy missing — process now
    }

    if (!clangdStat || origStat.mtimeMs > clangdStat.mtimeMs) {
      await fixupCompileCommands(projectDir, envDir, { allowRootFallback: false });
    }
    return;
  }

  // Check the processed clangd copy first – if it exists we are done.
  const clangdPath = path.join(projectDir, '.cache', 'clangd', 'compile_commands.json');
  const origCandidates = [
    ...(envDir ? [path.join(envDir, 'compile_commands.json')] : []),
    path.join(projectDir, 'compile_commands.json'),
  ];

  let clangdStat = null;
  try {
    clangdStat = await fs.stat(clangdPath);
  } catch {
    // processed copy missing
  }

  for (const ccPath of origCandidates) {
    try {
      const origStat = await fs.stat(ccPath);
      if (!clangdStat || origStat.mtimeMs > clangdStat.mtimeMs) {
        await fixupCompileCommands(projectDir, envDir);
      }
      return;
    } catch {
      // not found here
    }
  }
  if (clangdStat) {
    return; // processed copy exists and no source DB was found
  }
  // No compile_commands.json at all – rebuild from scratch.
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
/**
 * For Arduino-as-component projects (framework = arduino, espidf), the
 * CMake build system generates compile_commands.json entries for project
 * source files without the Arduino core include paths.  This means clangd
 * cannot resolve `#include "Arduino.h"` or any other Arduino core header.
 *
 * This function detects the Arduino core directories by scanning the
 * packages directory for `framework-arduinoespressif32`, then injects
 * the missing `-I` flags into every project entry that lacks them.
 */
async function injectArduinoCoreIncludes(entries, projectDir, packagesDir) {
  // Find the Arduino core package (libs/sdkconfig.h injection is handled
  // separately by injectLibsSdkconfigInclude).
  let arduinoCoresDir = null;
  try {
    const dirs = await fs.readdir(packagesDir);
    for (const d of dirs) {
      if (
        d.startsWith('framework-arduinoespressif32') &&
        !d.includes('-libs') &&
        !arduinoCoresDir
      ) {
        const coresCandidate = path.join(packagesDir, d, 'cores', 'esp32');
        try {
          await fs.access(path.join(coresCandidate, 'Arduino.h'));
          arduinoCoresDir = path.join(packagesDir, d);
        } catch {
          // no Arduino.h here
        }
      }
    }
  } catch {
    return; // packagesDir unreadable
  }

  if (!arduinoCoresDir) {
    return; // no Arduino framework installed
  }

  const coresInclude = path.join(arduinoCoresDir, 'cores', 'esp32');

  // Collect all variant directories that appear in any entry's arguments
  // (the correct variant is already used by Arduino library entries).
  const variantsBase = path.join(arduinoCoresDir, 'variants');
  const variantDirs = new Set();
  const isInsideDir = (parent, child) => {
    const rel = path.relative(path.normalize(parent), path.normalize(child));
    return (
      rel === '' ||
      (!!rel &&
        rel !== '..' &&
        !rel.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(rel))
    );
  };
  for (const entry of entries) {
    const args = entry.arguments || [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (
        a === '-I' &&
        typeof args[i + 1] === 'string' &&
        isInsideDir(variantsBase, args[i + 1])
      ) {
        variantDirs.add(path.normalize(args[i + 1]));
        i++;
        continue;
      }
      if (typeof a === 'string' && a.startsWith('-I')) {
        const includePath = a.slice(2);
        if (isInsideDir(variantsBase, includePath)) {
          variantDirs.add(path.normalize(includePath));
        }
      }
    }
  }

  // If no variant was found in existing entries, try to detect from the
  // board variant used in the build directory name.
  if (variantDirs.size === 0) {
    try {
      const variants = await fs.readdir(variantsBase);
      for (const entry of entries) {
        const args = entry.arguments || [];
        for (const v of variants) {
          const define = `-DCONFIG_IDF_TARGET_${v.toUpperCase()}`;
          const match = args.some((a) => a === define || a.startsWith(`${define}=`));
          if (match) {
            const variantPath = path.join(variantsBase, v);
            try {
              await fs.access(variantPath);
              variantDirs.add(variantPath);
            } catch {
              // variant dir doesn't exist
            }
            break;
          }
        }
        if (variantDirs.size > 0) {
          break;
        }
      }
    } catch {
      // variants dir unreadable
    }
  }

  // Build the list of -I flags to inject (libs/sdkconfig.h is handled
  // separately by injectLibsSdkconfigInclude in fixupCompileCommands).
  const injectFlags = [`-I${toFwd(coresInclude)}`];
  for (const v of variantDirs) {
    injectFlags.push(`-I${toFwd(v)}`);
  }

  // Inject the top-level per-chip include directory from
  // framework-arduinoespressif32-libs (e.g. <libs>/esp32s3/include/), which
  // contains pre-compiled Arduino library headers like WiFiClient.h and
  // BLEDevice.h.  The deeper memory-type-specific include path
  // (<libs>/<chip>/<memory_type>/include) is handled separately by
  // injectLibsSdkconfigInclude.
  //
  // The chip family is derived from CONFIG_IDF_TARGET_* defines instead of
  // the variant directory name — board-specific variant folders (e.g.
  // `XIAO_ESP32S3`) do not match libs subdir names (`esp32s3`).
  const libsPkgDir = await findArduinoLibsPkgDir(packagesDir);
  if (libsPkgDir) {
    const chipFamilies = detectChipFamiliesFromEntries(entries);
    for (const chip of chipFamilies) {
      const libsInclude = path.join(libsPkgDir, chip, 'include');
      try {
        await fs.access(libsInclude);
        injectFlags.push(`-I${toFwd(libsInclude)}`);
      } catch {
        // No include dir for this chip — skip
      }
    }
  }

  // Inject into project source entries that are missing the Arduino core path
  for (const entry of entries) {
    if (!entry.file || !entry.arguments) {
      continue;
    }
    // Only patch project source files, not framework/library files
    if (!isInsideDir(projectDir, entry.file)) {
      continue;
    }
    const normalizedArgs = entry.arguments.map((arg) => path.normalize(arg)).join('\0');
    const missingFlags = injectFlags.filter(
      (flag) => !normalizedArgs.includes(path.normalize(flag.slice(2))),
    );
    if (missingFlags.length === 0) {
      continue; // already has all Arduino includes
    }

    // Insert the flags before the source file argument (last -c <file>)
    const cIdx = entry.arguments.lastIndexOf('-c');
    const insertAt = cIdx !== -1 ? cIdx : entry.arguments.length;
    entry.arguments.splice(insertAt, 0, ...missingFlags);
  }
}

/**
 * Query a GCC/Clang compiler for its built-in system include directories.
 *
 * Runs `<compiler> -E -x c -v /dev/null` (or NUL on Windows) and parses the
 * `#include <...> search starts here:` block from stderr.  Results are cached
 * per compiler path.
 */
const _sysIncludeCache = new Map();

async function querySystemIncludes(compilerPath) {
  // Detect language from compiler basename (g++/clang++ → c++, else c)
  const base = path.basename(compilerPath);
  const lang = base.endsWith('g++') || base.endsWith('clang++') ? 'c++' : 'c';
  const cacheKey = `${compilerPath}::${lang}`;

  if (_sysIncludeCache.has(cacheKey)) {
    return _sysIncludeCache.get(cacheKey);
  }
  const dirs = [];
  try {
    const nullDev = IS_WINDOWS ? 'NUL' : '/dev/null';
    const { stderr } = await execFileAsync(
      compilerPath,
      ['-E', '-x', lang, '-v', nullDev],
      { timeout: 10000, env: { ...process.env, LC_ALL: 'C' } },
    );
    // Parse the include search path block from GCC/Clang verbose output
    const lines = stderr.split('\n');
    let inBlock = false;
    for (const line of lines) {
      if (line.includes('#include <...> search starts here:')) {
        inBlock = true;
        continue;
      }
      if (inBlock) {
        if (line.includes('End of search list.')) {
          break;
        }
        const trimmed = line.trim();
        if (trimmed) {
          dirs.push(path.normalize(trimmed));
        }
      }
    }
  } catch {
    // compiler not runnable or timed out
  }
  _sysIncludeCache.set(cacheKey, dirs);
  return dirs;
}

/**
 * Expand GCC/Clang @file (response file) arguments inline.
 *
 * The compiler reads additional flags from the referenced file when it sees
 * an argument starting with `@`.  clangd supports this too, but expanding
 * them here ensures the fixup logic (absolutizeIncludes, system-include
 * injection, etc.) can see every flag.
 */
async function expandResponseFiles(args, dir) {
  const result = [];
  for (const a of args) {
    if (typeof a === 'string' && a.startsWith('@') && a.length > 1) {
      const filePath = a.slice(1);
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(dir, filePath);
      try {
        const content = await fs.readFile(absPath, 'utf-8');
        // Response files may contain quoted or escaped paths – use the shell
        // tokenizer so those are handled correctly.
        const tokens = shellTokenize(content);
        result.push(...tokens);
      } catch {
        // File unreadable – keep the original @file argument
        result.push(a);
      }
    } else {
      result.push(a);
    }
  }
  return result;
}

/**
 * Locate the framework-arduinoespressif32-libs PIO package directory.
 * Returns the absolute path to the package, or null if not installed /
 * packagesDir unreadable.
 *
 * Also checks the alternative path inside framework-arduinoespressif32:
 * <packagesDir>/framework-arduinoespressif32/tools/esp32-arduino-libs
 */
async function findArduinoLibsPkgDir(packagesDir) {
  try {
    const dirs = await fs.readdir(packagesDir);
    // Primary: framework-arduinoespressif32-libs package
    for (const d of dirs) {
      if (d.startsWith('framework-arduinoespressif32-libs')) {
        return path.join(packagesDir, d);
      }
    }
    // Alternative: framework-arduinoespressif32/tools/esp32-arduino-libs
    for (const d of dirs) {
      if (d.startsWith('framework-arduinoespressif32') && !d.includes('-libs')) {
        const altPath = path.join(packagesDir, d, 'tools', 'esp32-arduino-libs');
        try {
          await fs.access(altPath);
          return altPath;
        } catch {
          // Alternative path doesn't exist
        }
      }
    }
  } catch {
    // packagesDir unreadable
  }
  return null;
}

/**
 * Detect ESP chip families from `CONFIG_IDF_TARGET_*` defines present in any
 * entry's arguments.  Returns an array of lowercase chip names (e.g.
 * `["esp32s3"]`) suitable for indexing into `framework-arduinoespressif32-libs`.
 *
 * Using defines (instead of variant directory names) keeps detection correct
 * for board-specific variant folders such as `XIAO_ESP32S3` whose basename
 * does not match a libs subdirectory.
 */
function detectChipFamiliesFromEntries(entries) {
  const chips = new Set();
  const re = /^-D\s*CONFIG_IDF_TARGET_([A-Z0-9]+)(?:=|$)/;
  for (const entry of entries) {
    const args = entry.arguments || [];
    for (const a of args) {
      if (typeof a !== 'string') {
        continue;
      }
      const m = a.match(re);
      if (m) {
        chips.add(m[1].toLowerCase());
      }
    }
  }
  return Array.from(chips);
}

/**
 * Inject the framework-arduinoespressif32-libs SDK include path into entries.
 *
 * PIO's compiledb target does not emit the pre-compiled libs SDK include path
 * (`<libs>/<chip>/<memory_type>/include`) which contains `sdkconfig.h`.
 * Without it clangd cannot resolve `#include "sdkconfig.h"`.
 *
 * The correct memory_type sub-directory (e.g. `qio_qspi`, `dio_qspi`) is
 * determined by querying PIO for `build.arduino.memory_type` /
 * `build.flash_mode`, falling back to `dio_qspi` (the pioarduino default).
 */
async function injectLibsSdkconfigInclude(entries, projectDir, packagesDir, envDir) {
  // 1. Find the libs package
  const libsDir = await findArduinoLibsPkgDir(packagesDir);
  if (!libsDir) {
    return;
  }

  // 2. Detect chip family from CONFIG_IDF_TARGET_* defines (preferred — works
  //    for board-specific variant folders like XIAO_ESP32S3).  Fall back to
  //    the variant-path basename if no defines are found.
  let chip = detectChipFamiliesFromEntries(entries)[0] || null;
  if (!chip) {
    for (const entry of entries) {
      const args = entry.arguments || [];
      for (const a of args) {
        if (typeof a !== 'string') {
          continue;
        }
        const m = a.match(/framework-arduinoespressif32[/\\]variants[/\\]([^/\\]+)/);
        if (m) {
          chip = m[1];
          break;
        }
      }
      if (chip) {
        break;
      }
    }
  }
  if (!chip) {
    return;
  }

  // 3. Determine memory_type sub-directory
  const chipDir = path.join(libsDir, chip);
  let candidates;
  try {
    const subdirs = await fs.readdir(chipDir, { withFileTypes: true });
    candidates = [];
    for (const d of subdirs) {
      if (!d.isDirectory()) {
        continue;
      }
      const candidate = path.join(chipDir, d.name, 'include');
      try {
        await fs.access(path.join(candidate, 'sdkconfig.h'));
        candidates.push({ name: d.name, dir: candidate });
      } catch {
        // no sdkconfig.h here
      }
    }
  } catch {
    return;
  }
  if (candidates.length === 0) {
    return;
  }

  let libsInclude = null;
  if (candidates.length === 1) {
    libsInclude = candidates[0].dir;
  } else {
    // Multiple candidates — query PIO for the board's memory_type
    const envName = envDir ? path.basename(envDir) : null;
    if (envName) {
      try {
        const script = `
import json, sys
from platformio.public import ProjectConfig
env = sys.argv[1]
config = ProjectConfig()
section = "env:" + env
board_id = config.get(section, "board", default="")
memory_type = ""
if board_id:
    try:
        from platformio.platform.factory import PlatformFactory
        pkg = config.get(section, "platform", default="espressif32")
        p = PlatformFactory.new(pkg)
        board = p.board_config(board_id)
        flash_mode = board.get("build.flash_mode", "dio")
        memory_type = board.get("build.arduino.memory_type", flash_mode + "_qspi")
    except Exception:
        pass
print(json.dumps({"memory_type": memory_type}))
`.trim();
        const output = await pioNodeHelpers.core.getCorePythonCommandOutput(
          ['-c', script, envName],
          { projectDir },
        );
        const data = JSON.parse(output.trim());
        if (data.memory_type) {
          const match = candidates.find((c) => c.name === data.memory_type);
          if (match) {
            libsInclude = match.dir;
          }
        }
      } catch {
        // PIO query failed — fall through to default
      }
    }
    // Fallback: pioarduino defaults to flash_mode "dio" → "dio_qspi"
    if (!libsInclude) {
      const fallback = candidates.find((c) => c.name === 'dio_qspi');
      if (fallback) {
        libsInclude = fallback.dir;
      }
    }
  }

  if (!libsInclude) {
    return;
  }

  // 4. Check if any entry already references this path — skip if so
  const normalizedLibs = path.normalize(libsInclude);
  for (const entry of entries) {
    const args = entry.arguments || [];
    const joined = args
      .map((a) => (typeof a === 'string' ? path.normalize(a) : ''))
      .join('\0');
    if (joined.includes(normalizedLibs)) {
      return; // at least one entry already has it
    }
  }

  // 5. Inject into every entry that has arguments
  const libsFlag = `-I${toFwd(libsInclude)}`;
  for (const entry of entries) {
    if (!entry.arguments) {
      continue;
    }
    const cIdx = entry.arguments.lastIndexOf('-c');
    const insertAt = cIdx !== -1 ? cIdx : entry.arguments.length;
    entry.arguments.splice(insertAt, 0, libsFlag);
  }
}

export async function fixupCompileCommands(
  projectDir,
  envDir,
  { allowRootFallback = true } = {},
) {
  if (
    getActiveBackendId() !== 'clangd' ||
    !projectDir ||
    !isBackendExtensionInstalled()
  ) {
    return;
  }
  // Read the original compile_commands.json – try the env build dir first
  // (CMake / ninja output for Arduino-as-component / ESP-IDF projects), then
  // fall back to project root (PIO compiledb output).  The original is never
  // modified.
  const rootPath = path.join(projectDir, 'compile_commands.json');
  const envPath = envDir ? path.join(envDir, 'compile_commands.json') : undefined;

  let raw;
  if (envPath) {
    try {
      raw = await fs.readFile(envPath, 'utf-8');
    } catch {
      // not found in envDir – try root
    }
  }
  if (!raw && !allowRootFallback) {
    return;
  }
  if (!raw) {
    try {
      raw = await fs.readFile(rootPath, 'utf-8');
    } catch {
      return;
    }
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
    entry.directory = toFwd(dir);

    if (entry.file && !path.isAbsolute(entry.file)) {
      entry.file = toFwd(path.join(dir, entry.file));
    } else if (entry.file) {
      entry.file = toFwd(path.normalize(entry.file));
    }
    if (entry.file) {
      existingFiles.add(path.normalize(entry.file));
    }

    if (!entry.command && !entry.arguments) {
      continue;
    }

    let args = entry.arguments || shellTokenize(entry.command);

    // 0. Expand @file response-file arguments inline
    args = await expandResponseFiles(args, dir);

    // 1. Resolve bare compiler name
    const compiler = args[0];
    if (compiler && !compiler.includes('/') && !compiler.includes('\\')) {
      const resolved = await resolveCompiler(compiler);
      if (resolved) {
        args[0] = toFwd(resolved);
      }
    } else if (compiler) {
      args[0] = toFwd(compiler);
    }

    // 2. Convert relative include paths to absolute
    await absolutizeIncludes(args, dir);

    // 3. Inject GCC/Clang built-in system include paths so clangd can resolve
    //    standard library headers like <math.h>, <stdio.h>, <stdint.h>, etc.
    const resolvedCompiler = args[0];
    if (resolvedCompiler && path.isAbsolute(resolvedCompiler)) {
      const sysDirs = await querySystemIncludes(resolvedCompiler);
      if (sysDirs.length > 0) {
        // Collect existing -isystem paths to avoid duplicates
        const existingSys = new Set();
        for (let j = 0; j < args.length; j++) {
          if (args[j] === '-isystem' && j + 1 < args.length) {
            existingSys.add(path.normalize(args[j + 1]));
            j++;
          } else if (
            typeof args[j] === 'string' &&
            args[j].startsWith('-isystem') &&
            args[j].length > '-isystem'.length
          ) {
            existingSys.add(path.normalize(args[j].slice('-isystem'.length)));
          }
        }
        const newFlags = [];
        for (const d of sysDirs) {
          if (!existingSys.has(path.normalize(d))) {
            newFlags.push('-isystem', toFwd(d));
          }
        }
        if (newFlags.length > 0) {
          // Insert before the source file argument (last -c <file>)
          const cIdx = args.lastIndexOf('-c');
          const insertAt = cIdx !== -1 ? cIdx : args.length;
          args.splice(insertAt, 0, ...newFlags);
        }
      }
    }

    // Write back as arguments array (preferred by clangd, avoids quoting issues)
    entry.arguments = args;
    delete entry.command;
  }

  // 4. For Arduino-as-component projects (framework = arduino, espidf), the
  //    CMake-generated compile_commands.json for project src/ files does not
  //    include the Arduino core headers (cores/esp32, variants/<variant>).
  //    Scan all entries for Arduino core include paths and inject them into
  //    project entries that are missing them.
  await injectArduinoCoreIncludes(entries, projectDir, packagesDir);

  // 4b. Inject framework-arduinoespressif32-libs SDK include path
  //     (contains sdkconfig.h) which PIO's compiledb target omits.
  await injectLibsSdkconfigInclude(entries, projectDir, packagesDir, envDir);

  // 5. Add synthetic entries for project header/source files that aren't in
  //    the compilation database. clangd uses directory proximity to match
  //    headers to compile commands; files in directories like usermods/ that
  //    have no .cpp entry nearby get no flags and lose all IntelliSense.
  //    We find a representative project entry and clone its flags for every
  //    missing file.
  const pioBuildDir = `${path.sep}.pio${path.sep}`;
  const pioCoreDir = `${path.sep}.platformio${path.sep}`;
  const normalizedProjectDir = path.normalize(projectDir);
  const projectSrcEntries = entries.filter((e) => {
    if (!e.file || (!e.arguments && !e.command)) {
      return false;
    }
    const normalizedFile = path.normalize(e.file);
    const relativeToProject = path.relative(normalizedProjectDir, normalizedFile);
    const isProjectFile =
      relativeToProject === '' ||
      (!!relativeToProject &&
        relativeToProject !== '..' &&
        !relativeToProject.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativeToProject));
    return (
      isProjectFile &&
      !normalizedFile.includes(path.normalize(pioBuildDir.slice(1))) &&
      !normalizedFile.includes(path.normalize(pioCoreDir.slice(1)))
    );
  });

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

    const templateFileNorm = path.normalize(templateFile);
    for (const file of allProjectFiles) {
      if (existingFiles.has(file)) {
        continue;
      }
      const fwdFile = toFwd(file);
      const syntheticArgs = filteredArgs.map((a) =>
        typeof a === 'string' && path.normalize(a) === templateFileNorm ? fwdFile : a,
      );
      syntheticEntries.push({
        directory: templateDir,
        arguments: syntheticArgs,
        file: fwdFile,
      });
    }

    if (syntheticEntries.length > 0) {
      entries.push(...syntheticEntries);
    }
  }

  // Write the processed database to a dedicated clangd directory so the
  // original compile_commands.json (project root or env build dir) is never
  // modified.  --compile-commands-dir is pointed here by ensureClangdArgs().
  const clangdDir = path.join(projectDir, '.cache', 'clangd');
  await fs.mkdir(clangdDir, { recursive: true });
  const destPath = path.join(clangdDir, 'compile_commands.json');
  const newContent = JSON.stringify(entries, null, 2) + '\n';

  // Skip the write when the content is byte-identical to the existing file.
  // Rewriting the file (even with the same bytes) bumps mtime and forces
  // clangd to discard its preamble and reparse every open TU.
  let unchanged = false;
  try {
    const existing = await fs.readFile(destPath, 'utf-8');
    unchanged = existing === newContent;
  } catch {
    // file does not exist yet — write it
  }

  if (!unchanged) {
    await fs.writeFile(destPath, newContent, 'utf-8');
  }

  vscode.window.showInformationMessage(
    `Processed ${entries.length} entries from compile_commands.json — clangd is ready. `,
  );
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

// Flags that esp-clangd doesn't understand (ESP/GCC-specific machine flags).
const ESP_CLANGD_REMOVE_FLAGS = [
  '-misc-unused-parameters',
  '-mfix-esp32-psram-cache-issue',
  '-mfix-esp32-psram-cache-strategy=*',
  '-fno-shrink-wrap',
  '-fno-tree-switch-conversion',
  '-fstrict-volatile-bitfields',
  '-free',
  '-fipa-pta',
  '-march=*',
  '-mdisable-hardware-atomics',
  '-mlongcalls',
  '-mtext-section-literals',
  '-mtarget-align',
  '-mno-target-align',
  '-isysroot',
];

const ESP_CLANGD_ADD_FLAGS = [
  '-Wall',
  '-Wextra',
  '-Wunused-variable',
  '-Wunused-function',
  '-Wno-unused-parameter',
  '-Wno-reserved-identifier',
];

/**
 * Ensure a .clangd config file exists in the project directory with
 * BuiltinHeaders: QueryDriver and, when esp-clangd is used, the
 * necessary Add/Remove flags for ESP-specific compiler options that
 * upstream clangd does not understand.
 */
/**
 * Detect whether the active environment targets an Espressif platform
 * by inspecting the platform field in platformio.ini via the observer.
 */
async function isEspressifProject(projectDir, observer) {
  if (!observer) {
    return false;
  }
  try {
    const config = await observer.getConfig();
    const env = await observer.revealActiveEnvironment();
    if (!env) {
      return false;
    }
    const platform = config.getEnvPlatform(env);
    return typeof platform === 'string' && /espressif|esp32|esp8266/i.test(platform);
  } catch {
    return false;
  }
}

// ── In-memory cache for isIdfProject results ──
// Keyed by `${projectDir}::${env}`, values are { result: boolean, ts: number }.
const _idfCache = new Map();
const _IDF_CACHE_TTL_MS = 30_000; // 30 seconds
const _idfIniWatchers = new Map(); // projectDir → Disposable

function _idfCacheKey(projectDir, env) {
  return `${path.normalize(projectDir)}::${env}`;
}

function _idfCacheGet(key) {
  const entry = _idfCache.get(key);
  if (entry && Date.now() - entry.ts < _IDF_CACHE_TTL_MS) {
    return entry.result;
  }
  _idfCache.delete(key);
  return undefined;
}

function _idfCacheSet(key, result) {
  _idfCache.set(key, { result, ts: Date.now() });
}

/**
 * Invalidate all cache entries whose key starts with the given projectDir.
 */
export function invalidateIdfCache(projectDir) {
  const normalized = path.normalize(projectDir);
  for (const key of _idfCache.keys()) {
    if (key.startsWith(`${normalized}::`)) {
      _idfCache.delete(key);
    }
  }
  const watcher = _idfIniWatchers.get(normalized);
  if (watcher) {
    watcher.dispose();
    _idfIniWatchers.delete(normalized);
  }
}

export function disposeAllIdfWatchers() {
  for (const watcher of _idfIniWatchers.values()) {
    watcher.dispose();
  }
  _idfIniWatchers.clear();
  disposeAllIdfCcWatchers();
  disposeAllClangdCcWatchers();
}

// ── Watchers for CMake-generated compile_commands.json (IDF projects) ──
const _idfCcWatchers = new Map(); // normalized projectDir → Disposable

export function disposeIdfCcWatcher(projectDir) {
  const key = path.normalize(projectDir);
  const watcher = _idfCcWatchers.get(key);
  if (watcher) {
    watcher.dispose();
    _idfCcWatchers.delete(key);
  }
}

function disposeAllIdfCcWatchers() {
  for (const w of _idfCcWatchers.values()) {
    w.dispose();
  }
  _idfCcWatchers.clear();
}

// ── Watchers for the processed clangd compile_commands.json (non-IDF) ──
// If the user (or some external tool) deletes .cache/clangd/compile_commands.json
// while the project is open, we re-run ensureCompileCommands so clangd gets a
// fresh database (regenerated from the original PIO/CMake output, or rebuilt
// from scratch if no source DB is left).
const _clangdCcWatchers = new Map(); // normalized projectDir → Disposable

export function disposeClangdCcWatcher(projectDir) {
  const key = path.normalize(projectDir);
  const watcher = _clangdCcWatchers.get(key);
  if (watcher) {
    watcher.dispose();
    _clangdCcWatchers.delete(key);
  }
}

function disposeAllClangdCcWatchers() {
  for (const w of _clangdCcWatchers.values()) {
    w.dispose();
  }
  _clangdCcWatchers.clear();
}

/**
 * Watch the processed clangd compile_commands.json in `<projectDir>/.cache/clangd/`.
 * Calls onMissing() when the file OR any of its ancestor cache directories is deleted.
 *
 * Three watchers are needed because VS Code's FileSystemWatcher only fires onDidDelete
 * for the exact path that was removed — deleting a parent directory does NOT propagate
 * a delete event to child paths.
 */
export function watchClangdCompileCommands(projectDir, onMissing) {
  disposeClangdCcWatcher(projectDir);
  if (!projectDir) {
    return;
  }

  const handleMissing = async () => {
    try {
      await onMissing();
    } catch (err) {
      console.warn(
        `Failed to regenerate clangd compile_commands.json: ${err?.message ?? err}`,
      );
    }
  };

  const baseUri = vscode.Uri.file(projectDir);
  const disposables = [];

  // 1. Direct file deletion: .cache/clangd/compile_commands.json
  const fileWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(baseUri, '.cache/clangd/compile_commands.json'),
    true, // ignoreCreateEvents
    true, // ignoreChangeEvents
    false, // listen for delete
  );
  fileWatcher.onDidDelete(handleMissing);
  disposables.push(fileWatcher);

  // 2. Containing directory deletion: .cache/clangd/
  //    VS Code fires onDidDelete when a directory matching the pattern is removed.
  const clangdDirWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(baseUri, '.cache/clangd'),
    true,
    true,
    false,
  );
  clangdDirWatcher.onDidDelete(handleMissing);
  disposables.push(clangdDirWatcher);

  // 3. Parent directory deletion: .cache/
  const cacheDirWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(baseUri, '.cache'),
    true,
    true,
    false,
  );
  cacheDirWatcher.onDidDelete(handleMissing);
  disposables.push(cacheDirWatcher);

  // Store a composite disposable so disposeClangdCcWatcher cleans all three.
  _clangdCcWatchers.set(path.normalize(projectDir), {
    dispose() {
      for (const d of disposables) {
        d.dispose();
      }
    },
  });
}

/**
 * Watch the CMake-generated compile_commands.json in envDir.
 * Calls onReady() whenever the file is created or changed (e.g. after a build).
 */
export function watchIdfCompileCommands(projectDir, envDir, onReady) {
  disposeIdfCcWatcher(projectDir);
  if (!envDir) {
    return;
  }
  const pattern = new vscode.RelativePattern(envDir, 'compile_commands.json');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const handler = async () => {
    try {
      await fs.access(path.join(envDir, 'compile_commands.json'));
      await onReady();
    } catch (err) {
      // file not yet accessible (will fire again when ready), or onReady threw
      if (err && err.code !== 'ENOENT') {
        console.warn(`IDF compile_commands.json watcher: ${err.message || err}`);
      }
    }
  };
  watcher.onDidCreate(handler);
  watcher.onDidChange(handler);
  _idfCcWatchers.set(path.normalize(projectDir), watcher);
}

function _ensureIniWatcher(projectDir) {
  const normalized = path.normalize(projectDir);
  if (_idfIniWatchers.has(normalized)) {
    return;
  }
  const pattern = new vscode.RelativePattern(normalized, 'platformio.ini');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const handler = () => invalidateIdfCache(normalized);
  watcher.onDidChange(handler);
  watcher.onDidCreate(handler);
  watcher.onDidDelete(handler);
  _idfIniWatchers.set(normalized, watcher);
}

// After a first build, CMakeCache.txt in envDir is IDF-specific (CMake build system).
// .ninja_log in envDir is also IDF-specific.
async function isIdfProjectByFilesystem(projectDir, envDir) {
  const checks = [
    projectDir ? path.join(projectDir, 'sdkconfig') : null,
    envDir ? path.join(envDir, 'CMakeCache.txt') : null,
    envDir ? path.join(envDir, '.ninja_log') : null,
  ].filter(Boolean);

  for (const p of checks) {
    try {
      await fs.access(p);
      return true; // file exists → IDF
    } catch {
      // not found, try next
    }
  }
  return false;
}

/**
 * Detect whether the active environment uses ESP-IDF — either as a standalone
 * framework or as the base for Arduino-as-a-component.
 *
 * For these project types the build system (CMake / Ninja) already generates
 * compile_commands.json natively, so pioarduino-vscode-ide must not trigger
 * `pio run --target compiledb`.  Post-processing (fixupCompileCommands) must
 * still run to copy/rewrite the CMake-generated file into .cache/clangd/.
 */
export async function isIdfProject(observer, envDir) {
  if (!observer) {
    return false;
  }
  try {
    const env = await observer.revealActiveEnvironment();
    if (!env) {
      return false;
    }

    const projectDir = observer.projectDir;

    // ── Cache lookup ──
    const cacheKey = _idfCacheKey(projectDir, env);
    const cached = _idfCacheGet(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Watch platformio.ini for changes so we can invalidate
    _ensureIniWatcher(projectDir);

    const sectionKey = `env:${env}`;
    const script = `
import json
import sys
from platformio.public import ProjectConfig
section_key = sys.argv[1]
config = ProjectConfig()
try:
    framework = config.get(section_key, 'framework', default='') or ''
    print(json.dumps({'framework': framework, 'resolverOk': True}))
except Exception:
    print(json.dumps({'framework': '', 'resolverOk': False}))
`.trim();

    const output = await pioNodeHelpers.core.getCorePythonCommandOutput(
      ['-c', script, sectionKey],
      { projectDir },
    );
    const data = JSON.parse(output.trim());
    const framework = String(data.framework || '');
    if (/\bespidf\b/i.test(framework)) {
      _idfCacheSet(cacheKey, true);
      return true;
    }
    if (data.resolverOk) {
      _idfCacheSet(cacheKey, false);
      return false;
    }
    // Fallback: check build artifacts (reliable post-first-build, no subprocess)
    const fsResult = await isIdfProjectByFilesystem(projectDir, envDir);
    _idfCacheSet(cacheKey, fsResult);
    return fsResult;
  } catch {
    // Python subprocess failed — still try filesystem
    try {
      const projectDir = observer.projectDir;
      const env = await observer.revealActiveEnvironment().catch(() => null);
      const fsResult = await isIdfProjectByFilesystem(projectDir, envDir);
      if (env) {
        _idfCacheSet(_idfCacheKey(projectDir, env), fsResult);
      }
      return fsResult;
    } catch {
      return false;
    }
  }
}

export async function ensureClangdConfig(projectDir, observer) {
  if (
    getActiveBackendId() !== 'clangd' ||
    !projectDir ||
    !isBackendExtensionInstalled()
  ) {
    return;
  }
  const configPath = path.join(projectDir, '.clangd');
  const espClangd = await findEspClangd();
  const useEspFlags = !!espClangd && (await isEspressifProject(projectDir, observer));

  let existing = '';
  try {
    existing = await fs.readFile(configPath, 'utf-8');
  } catch {
    // file does not exist yet
  }

  const hasBuiltinHeaders = existing.includes('BuiltinHeaders');
  const hasSuppressDiag =
    existing.includes('pp_expects_filename') && existing.includes('unused-includes');
  const hasRemoveFlags = ESP_CLANGD_REMOVE_FLAGS.every((f) => existing.includes(f));
  const hasAddFlags = ESP_CLANGD_ADD_FLAGS.every((f) => existing.includes(f));
  // Respect any existing Index.Background entry (user may have set Skip, etc.)
  const hasIndexBackground = /^Index:\s*\n(?:.*\n)*?\s+Background:/m.test(existing);
  // .ino files are not in compile_commands.json (PIO converts them to .cpp at
  // build time).  Without an explicit language hint clangd cannot give them
  // IntelliSense.  Detect any user-supplied PathMatch for .ino so we don't
  // override it.  .clangd is a multi-document YAML file (separated by `---`),
  // so check each document independently and accept both the inline form
  //   PathMatch: .*\.ino
  // and the list form
  //   PathMatch:
  //     - .*\.ino
  const hasInoPathMatch = existing.split(/^---\s*$/m).some((doc) => {
    if (!/^\s*If\s*:/m.test(doc)) {
      return false;
    }
    // Inline value:   PathMatch: <anything containing \.ino>
    if (/PathMatch\s*:\s*[^\n]*\\\.ino/.test(doc)) {
      return true;
    }
    // List form:  PathMatch:\n    - <item containing \.ino>\n ...
    const listMatch = doc.match(/PathMatch\s*:\s*\n((?:\s*-\s*[^\n]*\n?)+)/);
    return !!(listMatch && /\\\.ino/.test(listMatch[1]));
  });

  const needsEsp =
    useEspFlags && (!hasRemoveFlags || !hasAddFlags || !hasIndexBackground);

  // Already contains all required directives – nothing to do
  if (hasBuiltinHeaders && hasSuppressDiag && !needsEsp && hasInoPathMatch) {
    return;
  }

  // Build only the missing parts
  const parts = [];

  // CompileFlags block — collect all sub-keys into one block
  const cfParts = [];
  if (!hasBuiltinHeaders) {
    cfParts.push('  BuiltinHeaders: QueryDriver');
  }
  if (useEspFlags && !hasAddFlags) {
    cfParts.push('  Add:', ...ESP_CLANGD_ADD_FLAGS.map((f) => `    - "${f}"`));
  }
  if (useEspFlags && !hasRemoveFlags) {
    cfParts.push('  Remove:', ...ESP_CLANGD_REMOVE_FLAGS.map((f) => `    - "${f}"`));
  }
  if (cfParts.length > 0) {
    parts.push('CompileFlags:\n' + cfParts.join('\n'));
  }

  if (!hasSuppressDiag) {
    parts.push('Diagnostics:\n  Suppress: [pp_expects_filename, unused-includes]');
  }

  if (useEspFlags && !hasIndexBackground) {
    parts.push('Index:\n  Background: Build\n  StandardLibrary: true');
  }

  let block = parts.join('\n') + (parts.length ? '\n' : '');

  // Treat .ino files as C++ and auto-include Arduino.h.  PIO preprocesses
  // .ino → .cpp at build time, so .ino files never appear in
  // compile_commands.json.  This conditional block lets clangd give them
  // IntelliSense by inheriting include/define flags from neighbouring .cpp
  // entries while supplying the language and the implicit Arduino.h include.
  // It must live in its own YAML document (separated by `---`) because it
  // uses an `If:` selector.
  if (!hasInoPathMatch) {
    const inoBlock =
      [
        'If:',
        '  PathMatch: .*\\.ino',
        'CompileFlags:',
        '  Add:',
        '    - "-x"',
        '    - "c++"',
        '    - "-include"',
        '    - "Arduino.h"',
      ].join('\n') + '\n';
    block = block ? block + '---\n' + inoBlock : inoBlock;
  }

  // Prepend the block (separated by ---) so we don't clobber user settings
  const content = existing ? block + '---\n' + existing : block;

  await fs.writeFile(configPath, content, 'utf-8');
}

export async function ensureClangdArgs(projectDir) {
  if (!projectDir) {
    return;
  }
  // When cpptools is active, strip only the flags this extension manages
  if (getActiveBackendId() !== 'clangd') {
    const config = vscode.workspace.getConfiguration('clangd');

    // Remove clangd.path only when it points to an extension-managed binary
    const inspectedPath = config.inspect('path');
    const workspacePath = inspectedPath?.workspaceValue;
    if (typeof workspacePath === 'string') {
      const packagesDir = path.join(pioNodeHelpers.core.getCoreDir(), 'packages');
      const relativePath = path.relative(packagesDir, workspacePath);
      const isInsidePackages =
        relativePath &&
        relativePath !== '..' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath);
      if (isInsidePackages) {
        await config.update('path', undefined, vscode.ConfigurationTarget.Workspace);
      }
    }

    // Strip only --compile-commands-dir and --query-driver from arguments
    const inspectedArgs = config.inspect('arguments');
    const workspaceArgs = inspectedArgs?.workspaceValue;
    if (Array.isArray(workspaceArgs)) {
      const managed = ['--compile-commands-dir=', '--query-driver='];
      const filtered = workspaceArgs.filter(
        (a) => typeof a !== 'string' || !managed.some((prefix) => a.startsWith(prefix)),
      );
      if (filtered.length !== workspaceArgs.length) {
        await config.update(
          'arguments',
          filtered.length ? filtered : undefined,
          vscode.ConfigurationTarget.Workspace,
        );
      }
    }
    return;
  }
  if (!isBackendExtensionInstalled()) {
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

  // --compile-commands-dir: point clangd to the processed compile_commands.json
  // in .cache/clangd/ (written by fixupCompileCommands) so the original database
  // generated by the build system is never consumed directly.
  const ccDir = path.join(projectDir, '.cache', 'clangd');
  const compileCommandsFlag = `--compile-commands-dir=${toFwd(ccDir)}`;
  changed =
    upsertArg(newArgs, '--compile-commands-dir=', compileCommandsFlag) || changed;

  // --query-driver: let clangd query PlatformIO cross-compilers for built-in
  // include paths (C++ stdlib, GCC internals, sysroot). Without this, clangd
  // can't resolve system headers for embedded targets like xtensa, arm, riscv.
  const pioDir = toFwd(pioNodeHelpers.core.getCoreDir());
  const queryDriverGlob = [
    `${pioDir}/packages/toolchain-*/bin/*`,
    `${pioDir}/packages/tool-*/bin/*`,
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
