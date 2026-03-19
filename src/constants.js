/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

export const IS_WINDOWS = process.platform.startsWith('win');
export const IS_OSX = process.platform == 'darwin';
export const IS_LINUX = !IS_WINDOWS && !IS_OSX;
export const PIO_CORE_VERSION_SPEC = '>=6.1.6';
export const STATUS_BAR_PRIORITY_START = 10;

export const INTELLISENSE_BACKENDS = {
  cpptools: {
    id: 'cpptools',
    label: 'Microsoft C/C++ (cpptools)',
    extensionId: 'ms-vscode.cpptools',
    rescanCommand: 'C_Cpp.RescanWorkspace',
    configDefaults: {
      'C_Cpp.debugShortcut': false,
      'C_Cpp.intelliSenseEngine': 'default',
    },
    indexerIde: 'vscode',
    rebuildArgs: (env) => {
      const args = ['project', 'init', '--ide', 'vscode'];
      if (env) {
        args.push('--environment', env);
      }
      return args;
    },
  },
  clangd: {
    id: 'clangd',
    label: 'clangd (vscode-clangd)',
    extensionId: 'llvm-vs-code-extensions.vscode-clangd',
    rescanCommand: 'clangd.restart',
    configDefaults: {
      'C_Cpp.intelliSenseEngine': 'disabled',
      'clangd.detectExtensionConflicts': false,
    },
    indexerIde: 'vscode',
    rebuildArgs: (env) => {
      const args = ['run', '--target', 'compiledb'];
      if (env) {
        args.push('--environment', env);
      }
      return args;
    },
  },
};

export const ALWAYS_CONFLICTED_EXTENSION_IDS = ['vsciot-vscode.vscode-arduino'];

export function getConflictedExtensionIds(backendId) {
  const allBackendExtIds = Object.values(INTELLISENSE_BACKENDS).map(
    (b) => b.extensionId,
  );
  const activeExtId = INTELLISENSE_BACKENDS[backendId]
    ? INTELLISENSE_BACKENDS[backendId].extensionId
    : undefined;
  return [
    ...ALWAYS_CONFLICTED_EXTENSION_IDS,
    ...allBackendExtIds.filter((id) => id !== activeExtId),
  ];
}
