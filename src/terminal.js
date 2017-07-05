/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as constants from './constants';

import path from 'path';
import vscode from 'vscode';


export default class PIOTerminal {

  constructor() {
    this._instance = null;
  }

  new() {
    const commands = [];
    if (constants.IS_WINDOWS) {
      let tmpPaths = [];
      let pathIsSplit = false;
      for (const p of process.env.PATH.split(path.delimiter)) {
        if (!p) {
          continue;
        }
        // Workaround for https://support.microsoft.com/en-us/help/830473/command-prompt-cmd.-exe-command-line-string-limitation
        if ((p.length + tmpPaths.join(path.delimiter).length) > 8000) {
          if (pathIsSplit) {
            tmpPaths.unshift('%PATH%');
          }
          commands.push('set PATH=' + tmpPaths.join(path.delimiter));
          tmpPaths = [];
          pathIsSplit = true;
        }
        tmpPaths.push(p);
      }
      // leftover PATHs
      if (pathIsSplit) {
        tmpPaths.unshift('%PATH%');
      }
      commands.push('set PATH=' + tmpPaths.join(path.delimiter));
    } else if (process.env.SHELL && process.env.SHELL.includes('fish')) {
      commands.push('set -gx PATH ' + process.env.PATH.replace(/:/g, ' '));
    } else {
      commands.push('export PATH=' + process.env.PATH);
    }
    commands.push('pio --help');

    this._instance = vscode.window.createTerminal('PlatformIO', constants.IS_WINDOWS ? 'cmd.exe' : null);
    commands.forEach(cmd => this._instance.sendText(cmd));
    return this._instance;
  }

  sendText(text) {
    if (!this._instance) {
      this.new();
    }
    this._instance.sendText(text);
    this._instance.show();
  }

  dispose() {
    if (this._instance) {
      this._instance.dispose();
    }
    this._instance = null;
  }
}