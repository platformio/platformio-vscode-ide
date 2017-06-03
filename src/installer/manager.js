/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import PlatformIOCoreStage from './stages/platformio-core';
import VscodeGlobalStateStorage from './vscode-global-state-storage';
import VscodePythonInstallConfirm from './python-install-confirm';
import vscode from 'vscode';


export default class InstallationManager {

  LOCK_TIMEOUT =1 * 60 * 1000; // 1 minute
  LOCK_KEY = 'platformio-ide:installer-lock';
  STORAGE_STATE_KEY = 'platformio-ide:installer-state';

  constructor(globalState) {
    this.globalState = globalState;
    this.stateStorage = new VscodeGlobalStateStorage(globalState, this.STORAGE_STATE_KEY);

    const config = vscode.workspace.getConfiguration('platformio-ide');
    this.stages = [
      new PlatformIOCoreStage(this.onDidStatusChange.bind(this), this.stateStorage, {
        useBuiltinPIOCore: config.get('useBuiltinPIOCore'),
        setUseBuiltinPIOCore: (value) => config.update('platformio-ide.useBuiltinPIOCore', value),
        useDevelopmentPIOCore: config.get('useDevelopmentPIOCore') || true, // @FIXME: remove "|| true" when released
        installConfirm: new VscodePythonInstallConfirm()
      }),
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
    await  Promise.all(this.stages.map(stage => stage.install()));

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
