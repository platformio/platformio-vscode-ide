/**
 * Copyright 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { AUTO_REBUILD_DELAY } from '../constants';
import { getCurrentPythonExecutable, isPioProject, runPioCommand, spawnCommand } from '../utils';

import path from 'path';
import vscode from 'vscode';

export default class ProjectIndexer {

  constructor(projectPath) {
    this.projectPath = projectPath;

    this.subscriptions = [];
    this.libDirSubscriptions = new Map();

    this.interval = null;
    this.lastRebuildRequestedAt = null;

    this.isActive = false;
  }

  async activate() {
    this.isActive = true;
    this.subscriptions = [];
    await this.setup();
  }

  deactivate() {
    this.isActive = false;
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

    if (this.isActive && !autoRebuildAutocompleteIndex) {
      this.deactivate();
    } else if (!this.isActive && autoRebuildAutocompleteIndex) {
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
        path.join(this.projectPath, 'platformio.ini')
      );
      this.subscriptions.push(watcher);

      this.subscriptions.push(watcher.onDidCreate(() => {
        this.updateLibDirsWatchers();
      }));
      this.subscriptions.push(watcher.onDidChange(() => {
        this.requestIndexRebuild();
        this.updateLibDirsWatchers();
      }));
      this.subscriptions.push(watcher.onDidDelete(() => {
        this.updateLibDirsWatchers();
      }));

    } catch (error) {
      console.log(error);
    }
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
    } catch (error) {
      console.error(error);
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
    this.lastRebuildRequestedAt = new Date();
    if (this.interval === null) {
      this.interval = setInterval(this.maybeRebuild.bind(this), AUTO_REBUILD_DELAY);
    }
  }

  async maybeRebuild() {
    const now = new Date();
    if (now.getTime() - this.lastRebuildRequestedAt.getTime() > AUTO_REBUILD_DELAY) {
      if (this.interval !== null) {
        clearInterval(this.interval);
      }
      this.interval = null;

      if (this.isActive) {
        await this.doRebuild();
      }
    }
  }

  doRebuild({ verbose = false } = {}) {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'PlatformIO C/C++ Index Rebuild',
    }, async (progress) => {
      progress.report({
        message: 'Verifying if the current directory is a PlatformIO project',
      });
      try {
        if (!await isPioProject(this.projectPath)) {
          return;
        }

        progress.report({
          message: 'Performing index rebuild',
        });
        await new Promise((resolve, reject) => {
          runPioCommand(['init', '--ide', 'vscode', '--project-dir', this.projectPath], (code, stdout, stderr) => {
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
      } catch (error) {
        console.error(error);
        vscode.window.showErrorMessage(`C/C++ project index rebuild failed: ${error.toString}`);
      }
    });
  }

  async fetchWatchDirs() {
    if (!await isPioProject(this.projectPath)) {
      return [];
    }
    const pythonExecutable = await getCurrentPythonExecutable();
    const script = [
      'from os.path import join; from platformio import VERSION,util;',
      'print ":".join([',
      '    join(util.get_home_dir(), "lib"),',
      '    util.get_projectlib_dir(),',
      '    util.get_projectlibdeps_dir()',
      ']) if VERSION[0] == 3 else util.get_lib_dir()',
    ].map(s => s.trim()).join(' ');
    return new Promise((resolve, reject) => {
      spawnCommand(
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
            cwd: this.projectPath,
          },
        }
      );
    });
  }

  _removeSubscription(subscription) {
    return this.subscriptions.splice(this.subscriptions.indexOf(subscription));
  }

}
