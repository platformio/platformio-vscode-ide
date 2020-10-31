/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import fs from 'fs';
import path from 'path';
import vscode from 'vscode';

export default class ProjectManager {
  constructor() {
    this.subscriptions = [];
    this._lastActiveProjectDir = undefined;
    this._selectedProjectEnv = {};
    this._indexObsorver = undefined;
  }

  static isPIOProjectSync(projectDir) {
    try {
      fs.accessSync(path.join(projectDir, 'platformio.ini'));
      return true;
    } catch (err) {}
    return false;
  }

  getSelectedProjectEnv(projectDir) {
    return this._selectedProjectEnv[projectDir];
  }

  setSelectedProjectEnv(projectDir, envName) {
    if (this._selectedProjectEnv[projectDir] && !envName) {
      delete this._selectedProjectEnv[projectDir];
    }
    this._selectedProjectEnv[projectDir] = envName;
    if (this._indexObsorver) {
      const projectIndexer = this._indexObsorver.getProjectIndexer(projectDir);
      projectIndexer.setActiveEnv(envName);
      projectIndexer.rebuild();
    }
  }

  getPIOProjectDirs() {
    return (vscode.workspace.workspaceFolders || [])
      .map((folder) => folder.uri.fsPath)
      .filter((dir) => ProjectManager.isPIOProjectSync(dir));
  }

  getActivePIOProjectDir() {
    const pioProjectDirs = this.getPIOProjectDirs();
    if (pioProjectDirs.length < 1) {
      this._lastActiveProjectDir = undefined;
      return this._lastActiveProjectDir;
    }
    if (
      !this._lastActiveProjectDir ||
      !vscode.workspace.workspaceFolders.find(
        (folder) => folder.uri.fsPath === this._lastActiveProjectDir
      )
    ) {
      this._lastActiveProjectDir = pioProjectDirs[0];
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return this._lastActiveProjectDir;
    }
    const resource = editor.document.uri;
    if (resource.scheme !== 'file') {
      return this._lastActiveProjectDir;
    }
    const folder = vscode.workspace.getWorkspaceFolder(resource);
    if (!folder || !ProjectManager.isPIOProjectSync(folder.uri.fsPath)) {
      // outside workspace
      return this._lastActiveProjectDir;
    }
    this._lastActiveProjectDir = folder.uri.fsPath;
    return this._lastActiveProjectDir;
  }

  initIndexer(options = {}) {
    this._indexObsorver = new pioNodeHelpers.project.ProjectObserver({
      ide: 'vscode',
      createFileSystemWatcher: vscode.workspace.createFileSystemWatcher,
      createDirSystemWatcher: (dir) =>
        vscode.workspace.createFileSystemWatcher(path.join(dir, '*')),
      withProgress: (task) =>
        vscode.window.withProgress(
          {
            location: { viewId: vscode.ProgressLocation.Window },
            title: 'PlatformIO: IntelliSense Index Rebuild',
          },
          task
        ),
    });

    const doUpdate = () => {
      this._indexObsorver.update(
        options.autoRebuild && vscode.workspace.workspaceFolders
          ? vscode.workspace.workspaceFolders.map((folder) => folder.uri.fsPath)
          : []
      );
    };

    this.subscriptions.push(
      this._indexObsorver,
      vscode.workspace.onDidChangeWorkspaceFolders(doUpdate.bind(this)),
      vscode.workspace.onDidChangeConfiguration(doUpdate.bind(this)),
      vscode.commands.registerCommand('platformio-ide.rebuildProjectIndex', () => {
        doUpdate(); // re-scan PIO Projects
        this._indexObsorver.rebuildIndex();
      })
    );
    doUpdate();
  }

  dispose() {
    pioNodeHelpers.misc.disposeSubscriptions(this.subscriptions);
    this._indexObsorver = undefined;
  }
}
