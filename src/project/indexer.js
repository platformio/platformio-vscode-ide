/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { isPIOProject, runCommand, runPIOCommand } from '../utils';

import { AUTO_REBUILD_DELAY } from '../constants';
import { getPythonExecutable } from '../installer/helpers';
import path from 'path';
import vscode from 'vscode';


export default class ProjectIndexer {

  constructor(projectDir) {
    this.projectDir = projectDir;

    this.subscriptions = [];
    this.libDirSubscriptions = new Map();

    this._isActive = false;
    this._rebuildTimeout = null;
    this._updateLibDirWatchersTimeout = null;
  }

  async activate() {
    this._isActive = true;
    this.subscriptions = [];
    await this.setup();
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
    const config = vscode.workspace.getConfiguration('platformio-ide');
    const autoRebuildAutocompleteIndex = config.get('autoRebuildAutocompleteIndex');

    if (this._isActive && !autoRebuildAutocompleteIndex) {
      this.deactivate();
    } else if (!this._isActive && autoRebuildAutocompleteIndex) {
      await this.activate();
    }
  }

  async setup() {
    await this.addProjectConfigWatcher();
    await this.updateLibDirsWatchers();
    this.requestIndexRebuild(); // FIXME: don't do this when user disables the corresponding setting
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

    } catch (err) {
      console.error(err);
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
      console.error(err);
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
    if (!this._isActive) {
      return;
    }
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'PlatformIO C/C++ Index Rebuild',
    }, async (progress) => {
      progress.report({
        message: 'Verifying if the current directory is a PlatformIO project',
      });
      try {
        if (!await isPIOProject(this.projectDir)) {
          return;
        }

        progress.report({
          message: 'Performing index rebuild',
        });
        await new Promise((resolve, reject) => {
          runPIOCommand(['init', '--ide', 'vscode', '--project-dir', this.projectDir], (code, stdout, stderr) => {
            if (code === 0) {
              resolve();
            } else {
              reject(stderr);
            }
          });
        });

        if (verbose) {
          vscode.window.showInformationMessage('PlatformIO: C/C++ Project Index (for Autocomplete, Linter) has been successfully rebuilt.');
        }
      } catch (err) {
        console.error(err);
        vscode.window.showErrorMessage(`PlatformIO: C/C++ Project Index failed: ${err.toString()}`);
      }
    });
  }

  async fetchWatchDirs() {
    if (!await isPIOProject(this.projectDir)) {
      return [];
    }
    const pythonExecutable = await getPythonExecutable();
    const script = [
      'from os.path import join; from platformio import VERSION,util;',
      'print ":".join([',
      '    join(util.get_home_dir(), "lib"),',
      '    util.get_projectlib_dir(),',
      '    util.get_projectlibdeps_dir()',
      ']) if VERSION[0] == 3 else util.get_lib_dir()',
    ].map(s => s.trim()).join(' ');
    return new Promise((resolve, reject) => {
      runCommand(
        pythonExecutable,
        ['-c', script],
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
