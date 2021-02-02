/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import ProjectTaskManager from './tasks';
import { extension } from '../main';
import fs from 'fs';
import path from 'path';
import vscode from 'vscode';

export default class ProjectObservable {
  constructor() {
    this._lastActiveProjectDir = undefined;
    this._taskManager = undefined;
    this._pool = new pioNodeHelpers.project.ProjectPool({
      ide: 'vscode',
      api: {
        createFileSystemWatcher: vscode.workspace.createFileSystemWatcher,
        createDirSystemWatcher: (dir) =>
          vscode.workspace.createFileSystemWatcher(path.join(dir, '*')),
        withWindowProgress: (task, title) =>
          vscode.window.withProgress(
            {
              location: { viewId: vscode.ProgressLocation.Window },
              title,
            },
            task
          ),
        withTasksLoadingProgress: (task) =>
          vscode.window.withProgress(
            {
              location: { viewId: ProjectTaskManager.TASKS_VIEW_ID },
            },
            task
          ),
        onDidChangeProjectConfig: (projectDir) => {
          if (this._taskManager && this._taskManager.projectDir === projectDir) {
            this._taskManager.requestRefresh();
          }
        },
      },
      settings: {
        autoPreloadEnvTasks: extension.getSetting('autoPreloadEnvTasks'),
        autoRebuild: extension.getSetting('autoRebuildAutocompleteIndex'),
      },
    });

    this.subscriptions = [
      this._pool,
      vscode.window.onDidChangeActiveTextEditor(() => this.switchToActiveProject()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.switchToActiveProject()),
      vscode.commands.registerCommand('platformio-ide.rebuildProjectIndex', () =>
        this._pool.rebuildIndex(this.getActivePIOProjectDir())
      ),
      vscode.commands.registerCommand('platformio-ide.refreshProjectTasks', () =>
        this._taskManager.refresh({ force: true })
      ),
      vscode.commands.registerCommand('platformio-ide.privateRunTask', (task) =>
        this._taskManager.runTask(task)
      ),
    ];

    // switch to the first project in a workspace on start-up
    this.switchToActiveProject();
  }

  dispose() {
    pioNodeHelpers.misc.disposeSubscriptions(this.subscriptions);
  }

  static isPIOProjectSync(projectDir) {
    try {
      fs.accessSync(path.join(projectDir, 'platformio.ini'));
      return true;
    } catch (err) {}
    return false;
  }

  static getPIOProjectDirs() {
    return (vscode.workspace.workspaceFolders || [])
      .map((folder) => folder.uri.fsPath)
      .filter((projectDir) => ProjectObservable.isPIOProjectSync(projectDir));
  }

  getActivePIOProjectDir() {
    const pioProjectDirs = ProjectObservable.getPIOProjectDirs();
    if (pioProjectDirs.length < 1) {
      this._lastActiveProjectDir = undefined;
      return undefined;
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
    if (!folder || !ProjectObservable.isPIOProjectSync(folder.uri.fsPath)) {
      // outside workspace
      return this._lastActiveProjectDir;
    }
    this._lastActiveProjectDir = folder.uri.fsPath;
    return this._lastActiveProjectDir;
  }

  switchToActiveProject() {
    const projectDir = this.getActivePIOProjectDir();
    if (this._pool.getActiveProjectDir() === projectDir) {
      return;
    }
    this._pool.switch(projectDir);
    if (this._taskManager) {
      this._taskManager.dispose();
      this._taskManager = undefined;
    }
    this._taskManager = new ProjectTaskManager(
      projectDir,
      this._pool.getObserver(projectDir)
    );
  }
}
