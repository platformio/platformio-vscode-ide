/**
 * Copyright 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import fs from 'fs-plus';
import path from 'path';

export const DEFAULT_PIO_ARGS = ['-f'];
export const AUTO_REBUILD_DELAY = 3000;
export const IS_WINDOWS = process.platform.startsWith('win');
export const PIO_HOME_DIR = _getPioHomeDir(process.env.PLATFORMIO_HOME_DIR || path.join(fs.getHomeDirectory(), '.platformio'));
export const ENV_DIR = path.join(PIO_HOME_DIR, 'penv');
export const ENV_BIN_DIR = path.join(ENV_DIR, IS_WINDOWS ? 'Scripts' : 'bin');
export const PIO_CORE_MIN_VERSION = '3.4.0-b.1';

function _getPioHomeDir(pioHomeDir) {
  if (IS_WINDOWS) {
    // Make sure that all path characters have valid ASCII codes.
    for (const char of pioHomeDir) {
      if (char.charCodeAt(0) > 127) {
        // If they don't, put the pio home directory into the root of the disk.
        const homeDirPathFormat = path.parse(pioHomeDir);
        return path.format({
          dir: homeDirPathFormat.root,
          base: '.platformio',
        });
      }
    }
  }
  return pioHomeDir;
}
