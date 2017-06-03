/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as constants from './constants';

import vscode from 'vscode';


export default class PIOTerminal {

  constructor() {
    this._instance = null;
  }

  new() {
    const commands = [];
    if (constants.IS_WINDOWS) {
      commands.push('set PATH=' + process.env.PATH);
    } else if (process.env.SHELL && process.env.SHELL.includes('fish')) {
      commands.push('set -gx PATH ' + process.env.PATH.replace(/\:/g, ' '));
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
      this._instance = null;
    }
  }
}