/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import { isPIOProject, notifyError } from '../utils';

import { AUTO_REBUILD_DELAY } from '../constants';
import path from 'path';
import vscode from 'vscode';


export default class ProjectIndexer {

  static PythonExecutable = undefined;

  constructor(projectDir) {
    this.projectDir = projectDir;

    this.subscriptions = [];
    this.libDirSubscriptions = new Map();

    this._isActive = false;
    this._inProgress = false;
    this._rebuildTimeout = undefined;
    this._updateLibDirWatchersTimeout = undefined;
  }

  async activate() {
    this._isActive = true;
    this.subscriptions = [];
    await this.addProjectConfigWatcher();
    await this.updateLibDirsWatchers();
  }

  deactivate() {
    this._isActive = false;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions = [];
  }

  dispose() {
    this.deactivate();
  }

  async toggle() {
    const autoRebuildAutocompleteIndex = vscode.workspace.getConfiguration('platformio-ide').get('autoRebuildAutocompleteIndex');

    if (this._isActive && !autoRebuildAutocompleteIndex) {
      this.deactivate();
    } else if (!this._isActive && autoRebuildAutocompleteIndex) {
      await this.activate();
    }
  }

  addProjectConfigWatcher() {
    try {
      const watcher = vscode.workspace.createFileSystemWatcher(
        path.join(this.projectDir, 'platformio.ini')
      );
      this.subscriptions.push(watcher);

      this.subscriptions.push(watcher.onDidCreate(() => {
        this.updateLibDirsWatchers();
      }));
      this.subscriptions.push(watcher.onDidChange(() => {
        this.requestIndexRebuild();
        this.requestUpdateLibDirWatchers();
      }));
      this.subscriptions.push(watcher.onDidDelete(() => {
        this.updateLibDirsWatchers();
      }));

      // Current project has been initialized just now or it was just opened.
      // Either way we have to make sure that indexes are up to date.
      if (vscode.workspace.getConfiguration('platformio-ide').get('autoRebuildAutocompleteIndex')) {
        this.requestIndexRebuild();
      }

    } catch (err) {
      notifyError(`Project FileSystemWatcher: ${err.toString()}`, err);
    }
  }

  requestUpdateLibDirWatchers() {
    if (this._updateLibDirWatchersTimeout) {
      clearTimeout(this._updateLibDirWatchersTimeout);
    }
    this._updateLibDirWatchersTimeout = setTimeout(this.updateLibDirsWatchers.bind(this), AUTO_REBUILD_DELAY);
  }

  async updateLibDirsWatchers() {
    const libDirs = await this.fetchWatchDirs();

    for (const newLibDir of libDirs.filter(libDirPath => !this.libDirSubscriptions.has(libDirPath))) {
      await this.addLibDirWatcher(newLibDir);
    }

    for (const removedLibDir of Array.from(this.libDirSubscriptions.keys()).filter(libDirPath => !libDirs.includes(libDirPath))) {
      this.removeLibDirWatcher(removedLibDir);
    }
  }

  async addLibDirWatcher(libDirPath) {
    try {
      const watcher = vscode.workspace.createFileSystemWatcher(
        path.join(libDirPath, '*')
      );
      const subscription = watcher.onDidCreate(() => {
        this.requestIndexRebuild();
      });

      this.libDirSubscriptions.set(libDirPath, [watcher, subscription]);

      this.subscriptions.push(watcher);
      this.subscriptions.push(subscription);
    } catch (err) {
      notifyError(`Project FileSystemWatcher: ${err.toString()}`, err);
    }
  }

  removeLibDirWatcher(libDirPath) {
    const subscriptions = this.libDirSubscriptions.get(libDirPath) || [];
    for (const s of subscriptions) {
      if (s) {
        this._removeSubscription(s);
        s.dispose();
      }
    }
  }

  requestIndexRebuild() {
    if (this._rebuildTimeout) {
      clearTimeout(this._rebuildTimeout);
    }
    this._rebuildTimeout = setTimeout(this.doRebuild.bind(this), AUTO_REBUILD_DELAY);
  }

  doRebuild({ verbose = false } = {}) {
    if (!this._isActive || this._inProgress) {
      return;
    }
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'PlatformIO: IntelliSense Index Rebuild',
    }, async (progress) => {
      progress.report({
        message: 'Verifying if the current directory is a PlatformIO project',
      });
      try {
        if (!isPIOProject(this.projectDir)) {
          return;
        }
        progress.report({
          message: '',
        });
        this._inProgress = true;
        await new Promise((resolve, reject) => {
          pioNodeHelpers.core.runPIOCommand(['init', '--ide', 'vscode', '--project-dir', this.projectDir], (code, stdout, stderr) => {
            if (code === 0) {
              resolve();
            } else {
              reject(stderr);
            }
          });
        });
        if (verbose) {
          vscode.window.showInformationMessage('PlatformIO: IntelliSense Index has been successfully rebuilt.');
        }
      } catch (err) {
        notifyError(`IntelliSense Index: ${err.toString()}`, err);
      }
      this._inProgress = false;
    });
  }

  async fetchWatchDirs() {
    if (!ProjectIndexer.PythonExecutable) {
      ProjectIndexer.PythonExecutable = await pioNodeHelpers.misc.getPythonExecutable(vscode.workspace.getConfiguration('platformio-ide').get('useBuiltinPIOCore'));
    }
    const scriptLines = [
      'from os.path import join',
      'from platformio import util',
      'print(":".join([join(util.get_home_dir(), "lib"), util.get_projectlib_dir(), util.get_projectlibdeps_dir()]))'
    ];
    return new Promise((resolve, reject) => {
      pioNodeHelpers.misc.runCommand(
        ProjectIndexer.PythonExecutable,
        ['-c', scriptLines.join(';')],
        (code, stdout, stderr) => {
          if (code === 0) {
            resolve(stdout.toString().trim().split(':'));
          } else {
            reject(stderr);
          }
        },
        {
          spawnOptions: {
            cwd: this.projectDir,
          },
        }
      );
    });
  }

  _removeSubscription(subscription) {
    return this.subscriptions.splice(this.subscriptions.indexOf(subscription));
  }

}
