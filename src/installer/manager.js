/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

// DON'T import pioNodeHelpers here - it causes immediate initialization!
// import * as pioNodeHelpers from 'pioarduino-node-helpers';

import PIOHome from '../home';
import { PIO_CORE_VERSION_SPEC } from '../constants';
import PythonPrompt from './python-prompt';
import { extension } from '../main';
import path from 'path';
import vscode from 'vscode';

export default class InstallationManager {
  LOCK_TIMEOUT = 1 * 60 * 1000; // 1 minute
  LOCK_KEY = 'installer-lock';

  constructor(disableAutoUpdates = false) {
    const config = vscode.workspace.getConfiguration('platformio-ide');
    this.config = config;
    this.disableAutoUpdates = disableAutoUpdates;
    // Create stages lazily - the node-helpers now handle offline checks internally
    this.stages = null;
  }

  onDidStatusChange() {
    // increase lock timeout on each stage update
    if (this.locked()) {
      this.lock();
    }
  }

  lock() {
    return extension.context.globalState.update(this.LOCK_KEY, new Date().getTime());
  }

  unlock() {
    return extension.context.globalState.update(this.LOCK_KEY, undefined);
  }

  locked() {
    const lockTime = extension.context.globalState.get(this.LOCK_KEY);
    if (!lockTime) {
      return false;
    }
    return new Date().getTime() - parseInt(lockTime) <= this.LOCK_TIMEOUT;
  }

  createStages() {
    if (this.stages === null) {
      // Lazy load pioNodeHelpers only when needed
      const pioNodeHelpers = require('pioarduino-node-helpers');
      this.stages = [
        new pioNodeHelpers.installer.pioarduinoCoreStage(
          {
            getValue: (key) => extension.context.globalState.get(key),
            setValue: (key, value) => extension.context.globalState.update(key, value),
          },
          this.onDidStatusChange.bind(this),
          {
            pioCoreVersionSpec: PIO_CORE_VERSION_SPEC,
            useBuiltinPython: this.config.get('useBuiltinPython'),
            useBuiltinPIOCore: this.config.get('useBuiltinPIOCore'),
            useDevelopmentPIOCore: this.config.get('useDevelopmentPIOCore'),
            pythonPrompt: new PythonPrompt(),
            disableAutoUpdates: this.disableAutoUpdates,
            predownloadedPackageDir: path.join(
              extension.context.extensionPath,
              'assets',
              'predownloaded',
            ),
          },
        ),
      ];
    }
  }

  async check() {
    // Create stages if needed
    this.createStages();

    let result = true;
    for (const stage of this.stages) {
      try {
        if (!(await stage.check())) {
          result = false;
        }
      } catch (err) {
        result = false;
        console.warn('Installation stage check failed:', err.message || err);
      }
    }
    return result;
  }

  async install(progress) {
    // Ensure stages are created
    this.createStages();

    const stageIncrementTotal = 100 / this.stages.length;
    // shutdown all PIO Home servers which block python.exe on Windows
    await PIOHome.shutdownAllServers();
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
    if (this.stages) {
      for (const stage of this.stages) {
        try {
          if (stage && typeof stage.destroy === 'function') {
            stage.destroy();
          }
        } catch (err) {}
      }
    }
    this.stages = null;
  }
}
