/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import { PIO_CORE_MIN_VERSION } from '../constants';
import PythonPrompt from './python-prompt';
import StateStorage from './state-storage';
import { extension } from '../main';
import vscode from 'vscode';


export default class InstallationManager {

  LOCK_TIMEOUT = 1 * 60 * 1000; // 1 minute
  LOCK_KEY = 'platformio-ide:installer-lock';
  STORAGE_STATE_KEY = 'platformio-ide:installer-state';

  constructor(globalState) {
    this.globalState = globalState;
    this.stateStorage = new StateStorage(globalState, this.STORAGE_STATE_KEY);

    const config = vscode.workspace.getConfiguration('platformio-ide');
    const defaultParams = {
      pioCoreMinVersion: PIO_CORE_MIN_VERSION,
      useBuiltinPIOCore: config.get('useBuiltinPIOCore'),
      setUseBuiltinPIOCore: (value) => config.update('platformio-ide.useBuiltinPIOCore', value),
      useDevelopmentPIOCore: config.get('useDevelopmentPIOCore'),
      pythonPrompt: new PythonPrompt()
    };
    this.stages = [
      new pioNodeHelpers.installer.PlatformIOCoreStage(
        this.stateStorage,
        this.onDidStatusChange.bind(this),
        new Proxy(defaultParams, {
          get: (obj, prop) => {
            if (prop in obj) {
              return obj[prop];
            }
            // wait a while when enterprise settings will be loaded
            else if (prop === 'autorunPIOCmds') {
              return [
                {
                  args: ['home', '--host', '__do_not_start__'],
                  when: 'post-install',
                  suppressError: true
                }
              ].concat(extension.getEnterpriseSetting('autorunPIOCoreCmds', []));
            }
            return undefined;
          }
        })),
    ];
  }

  onDidStatusChange() {
    // increase lock timeout on each stage update
    if (this.locked()) {
      this.lock();
    }
  }

  lock() {
    return this.globalState.update(this.LOCK_KEY, new Date().getTime());
  }

  unlock() {
    return this.globalState.update(this.LOCK_KEY, undefined);
  }

  locked() {
    const lockTime = this.globalState.get(this.LOCK_KEY);
    if (!lockTime) {
      return false;
    }
    return (new Date().getTime() - parseInt(lockTime)) <= this.LOCK_TIMEOUT;
  }

  async check() {
    let result = true;
    for (const stage of this.stages) {
      try {
        if (!(await stage.check())) {
          result = false;
        }
      } catch (err) {
        result = false;
        console.error(err);
      }
    }
    return result;
  }

  async install() {
    await Promise.all(this.stages.map(stage => stage.install()));

    const result = await vscode.window.showInformationMessage(
      'PlatformIO IDE has been successfully installed! Please reload window',
      'Reload Now'
    );

    if (result === 'Reload Now') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }

  destroy() {
    return this.stages.map(stage => stage.destroy());
  }

}
