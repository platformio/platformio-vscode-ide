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
    this._instance = undefined;
  }

  new() {
    return vscode.window.createTerminal({
      name: 'PlatformIO',
      env: process.env
    });
  }

  sendText(text) {
    if (!this._instance) {
      this._instance = this.new();
    }
    this._instance.sendText(text);
    this._instance.show();
  }

  dispose() {
    if (this._instance) {
      this._instance.dispose();
    }
    this._instance = undefined;
  }

  updateEnvConfiguration() {
    const config = vscode.workspace.getConfiguration();
    const sysType = constants.IS_WINDOWS ? 'windows' : constants.IS_OSX ? 'osx' : 'linux';
    const section = `terminal.integrated.env.${sysType}`;
    const current = config.get(section);
    if (current && current.PATH === process.env.PATH) {
      return;
    }
    config.update(section, {
      PATH: process.env.PATH,
      PLATFORMIO_CALLER: 'vscode'
    }, vscode.ConfigurationTarget.Workspace);
  }
}