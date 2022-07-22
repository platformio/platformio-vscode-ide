/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import { PIO_CORE_VERSION_SPEC } from '../constants';
import PythonPrompt from './python-prompt';
import StateStorage from '../state-storage';
import { extension } from '../main';
import path from 'path';
import vscode from 'vscode';

export default class InstallationManager {
  LOCK_TIMEOUT = 1 * 60 * 1000; // 1 minute
  LOCK_KEY = 'platformio-ide:installer-lock';
  STORAGE_STATE_KEY = 'platformio-ide:installer-state';

  constructor(globalState, disableAutoUpdates = false) {
    this.globalState = globalState;
    this.stateStorage = new StateStorage(globalState, this.STORAGE_STATE_KEY);

    const config = vscode.workspace.getConfiguration('platformio-ide');
    this.stages = [
      new pioNodeHelpers.installer.PlatformIOCoreStage(
        this.stateStorage,
        this.onDidStatusChange.bind(this),
        {
          pioCoreVersionSpec: PIO_CORE_VERSION_SPEC,
          useBuiltinPython: config.get('useBuiltinPython'),
          useBuiltinPIOCore: config.get('useBuiltinPIOCore'),
          useDevelopmentPIOCore: config.get('useDevelopmentPIOCore'),
          pythonPrompt: new PythonPrompt(),
          disableAutoUpdates: disableAutoUpdates,
          predownloadedPackageDir: path.join(
            extension.context.extensionPath,
            'assets',
            'predownloaded'
          ),
        }
      ),
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
    return new Date().getTime() - parseInt(lockTime) <= this.LOCK_TIMEOUT;
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
        console.warn(err);
      }
    }
    return result;
  }

  async install(progress) {
    const stageIncrementTotal = 100 / this.stages.length;
    for (const stage of this.stages) {
      await stage.install((message, increment) => {
        progress.report({
          message,
          increment: stageIncrementTotal * (increment / 100),
        });
      });
    }
    progress.report({ message: 'Finished! Please restart VSCode.', increment: 100 });
  }

  destroy() {
    return this.stages.map((stage) => stage.destroy());
  }
}
