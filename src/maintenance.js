/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as constants from './constants';
import * as utils from './utils';

import path from 'path';
import vscode from 'vscode';


export function updateOSEnviron() {
  // Fix for platformio-atom-ide/issues/112
  process.env.LC_ALL = 'en_US.UTF-8';
  process.env.PLATFORMIO_CALLER = 'vscode';
  process.env.PLATFORMIO_DISABLE_PROGRESSBAR = 'true';
  process.env.PLATFORMIO_IDE = utils.getIDEVersion();

  // Fix for https://github.com/atom/atom/issues/11302
  if (process.env.Path) {
    if (process.env.PATH) {
      process.env.PATH += path.delimiter + process.env.Path;
    } else {
      process.env.PATH = process.env.Path;
    }
  }

  const config = vscode.workspace.getConfiguration('platformio-ide');
  if (config.get('useBuiltinPIOCore')) { // Insert bin directory into PATH
    process.env.PATH = constants.ENV_BIN_DIR + path.delimiter + process.env.PATH;
  } else { // Remove bin directory from PATH
    process.env.PATH = process.env.PATH.replace(constants.ENV_BIN_DIR + path.delimiter, '');
    process.env.PATH = process.env.PATH.replace(path.delimiter + constants.ENV_BIN_DIR, '');
  }

  if (config.get('customPATH')) {
    handleCustomPATH(config.get('customPATH'));
  }

  // copy PATH to Path (Windows issue)
  if (process.env.Path) {
    process.env.Path = process.env.PATH;
  }
}

export function handleCustomPATH(newValue, oldValue) {
  if (oldValue) {
    process.env.PATH = process.env.PATH.replace(oldValue + path.delimiter, '');
    process.env.PATH = process.env.PATH.replace(path.delimiter + oldValue, '');
  }
  if (newValue && !process.env.PATH.includes(newValue)) {
    process.env.PATH = newValue + path.delimiter + process.env.PATH;
  }
}
