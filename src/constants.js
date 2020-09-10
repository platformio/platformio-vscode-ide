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
export const PIO_CORE_VERSION_SPEC = '>=5';
export const STATUS_BAR_PRIORITY_START = 10;
export const CONFLICTED_EXTENSION_IDS = [
  'llvm-vs-code-extensions.vscode-clangd',
  'vsciot-vscode.vscode-arduino',
];
