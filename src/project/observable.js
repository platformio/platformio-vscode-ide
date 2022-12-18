/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';
import * as projectHelpers from './helpers';

import ProjectTaskManager from './tasks';
import ProjectTestManager from './tests';
import { STATUS_BAR_PRIORITY_START } from '../constants';
import { extension } from '../main';
import { notifyError } from '../utils';
import path from 'path';
import vscode from 'vscode';

export default class ProjectObservable {
  constructor() {
    this._taskManager = undefined;
    this._testManager = undefined;
    this._sbEnvSwitcher = undefined;
    this._logOutputChannel = vscode.window.createOutputChannel(
      'PlatformIO: Project Configuration'
    );

    this._pool = new pioNodeHelpers.project.ProjectPool({
      ide: 'vscode',
      api: {
        logOutputChannel: this._logOutputChannel,
        createFileSystemWatcher: vscode.workspace.createFileSystemWatcher,
        createDirSystemWatcher: (dir) =>
          vscode.workspace.createFileSystemWatcher(path.join(dir, '*')),
        withIndexRebuildingProgress: (task) =>
          vscode.window.withProgress(
            {
              location: { viewId: vscode.ProgressLocation.Notification },
              title: 'PlatformIO: Configuring project',
              cancellable: true,
            },
            async (progress, token) =>
              await task(
                (message, increment = undefined) =>
                  progress.report({
                    message,
                    increment: increment,
                  }),
                token
              )
          ),
        withTasksLoadingProgress: (task) =>
          vscode.window.withProgress(
            {
              location: { viewId: ProjectTaskManager.TASKS_VIEW_ID },
            },
            async () =>
              await vscode.window.withProgress(
                {
                  location: { viewId: vscode.ProgressLocation.Window },
                  title: 'PlatformIO: Loading tasks...',
                },
                task
              )
          ),
        onDidChangeProjectConfig: (projectDir) => {
          if (this._taskManager && this._taskManager.projectDir === projectDir) {
            this._taskManager.requestRefresh();
          }
          this.saveActiveProjectState();
        },
        onDidNotifyError: notifyError.bind(this),
      },
      settings: {
        autoPreloadEnvTasks: extension.getConfiguration('autoPreloadEnvTasks'),
        autoRebuild: extension.getConfiguration('autoRebuildAutocompleteIndex'),
      },
    });

    this.subscriptions = [
      this._pool,
      this._logOutputChannel,
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (!extension.getConfiguration('activateProjectOnTextEditorChange')) {
          return;
        }
        const projectDir = projectHelpers.getActiveEditorProjectDir();
        if (projectDir) {
          this.switchToProject(projectDir);
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() =>
        this.switchToProject(this.findActiveProjectDir())
      ),
      vscode.commands.registerCommand('platformio-ide.rebuildProjectIndex', () =>
        this._pool.getActiveObserver().rebuildIndex({ force: true })
      ),
      vscode.commands.registerCommand('platformio-ide.refreshProjectTasks', () =>
        this._taskManager.refresh({ force: true })
      ),
      vscode.commands.registerCommand('platformio-ide.privateRunTask', (task) =>
        this._taskManager.runTask(task)
      ),
    ];

    this.registerEnvSwitcher();
    // switch to the first project in a workspace on start-up
    this.switchToProject(this.findActiveProjectDir());
  }

  dispose() {
    for (const manager of [this._taskManager, this._testManager]) {
      if (manager) {
        this.subscriptions.push(manager);
      }
    }
    pioNodeHelpers.misc.disposeSubscriptions(this.subscriptions);
  }

  findActiveProjectDir() {
    let projectDir = undefined;
    if (extension.getConfiguration('activateProjectOnTextEditorChange')) {
      projectDir = projectHelpers.getActiveEditorProjectDir();
    }
    return projectDir || this.getSelectedProjectDir();
  }

  getSelectedProjectDir() {
    const pioProjectDirs = projectHelpers.getPIOProjectDirs();
    const currentActiveDir = this._pool.getActiveProjectDir();
    if (pioProjectDirs.length < 1) {
      return undefined;
    }
    if (
      currentActiveDir &&
      pioProjectDirs.find((projectDir) => projectDir === currentActiveDir)
    ) {
      return currentActiveDir;
    }
    const lastActiveDir = projectHelpers.getLastProjectDir();
    if (
      lastActiveDir &&
      pioProjectDirs.find((projectDir) => projectDir === lastActiveDir)
    ) {
      return lastActiveDir;
    }
    return pioProjectDirs[0];
  }

  saveActiveProjectState() {
    const observer = this._pool.getActiveObserver();
    if (!observer) {
      return;
    }
    projectHelpers.updateProjectItemState(
      observer.projectDir,
      'activeEnv',
      observer.getActiveEnvName()
    );
  }

  async switchToProject(projectDir, options = {}) {
    if (!projectDir) {
      console.error('switchProject => Please provide project folder');
      return;
    }
    this._sbEnvSwitcher.text = '$(root-folder) Loading...';

    let currentProjectDir = undefined;
    let currentEnvName = undefined;
    if (this._pool.getActiveObserver()) {
      currentProjectDir = this._pool.getActiveObserver().projectDir;
      currentEnvName = this._pool.getActiveObserver().getActiveEnvName();
    }
    const observer = this._pool.getObserver(projectDir);
    if ('envName' in options) {
      await observer.switchProjectEnv(options.envName);
    } else if (!observer.getActiveEnvName()) {
      await observer.switchProjectEnv(
        projectHelpers.getProjectItemState(projectDir, 'activeEnv')
      );
    }

    // ignore active project and & env
    if (
      !currentProjectDir ||
      currentProjectDir !== projectDir ||
      currentEnvName !== observer.getActiveEnvName()
    ) {
      this._pool.switch(projectDir);

      [this._taskManager, this._testManager].forEach((manager) =>
        manager ? manager.dispose() : undefined
      );
      this._taskManager = new ProjectTaskManager(projectDir, observer);
      this._testManager = new ProjectTestManager(projectDir);

      // open "platformio.ini" if no visible editors
      if (
        vscode.window.visibleTextEditors.length === 0 &&
        extension.getConfiguration('autoOpenPlatformIOIniFile')
      ) {
        vscode.window.showTextDocument(
          vscode.Uri.file(path.join(projectDir, 'platformio.ini'))
        );
      }
    }

    this.showSelectedEnv();
    this.saveActiveProjectState();
  }

  registerEnvSwitcher() {
    this._sbEnvSwitcher = vscode.window.createStatusBarItem(
      'pio-env-switcher',
      vscode.StatusBarAlignment.Left,
      STATUS_BAR_PRIORITY_START
    );
    this._sbEnvSwitcher.name = 'PlatformIO: Project Environment Switcher';
    this._sbEnvSwitcher.tooltip = 'Switch PlatformIO Project Environment';
    this._sbEnvSwitcher.command = 'platformio-ide.switchProjectEnv';
    this._sbEnvSwitcher.text = '$(root-folder) Loading...';
    this._sbEnvSwitcher.show();

    this.subscriptions.push(
      this._sbEnvSwitcher,
      vscode.commands.registerCommand('platformio-ide.switchProjectEnv', () =>
        this.pickProjectEnv()
      )
    );
  }

  showSelectedEnv() {
    const observer = this._pool.getActiveObserver();
    if (!observer) {
      return;
    }
    const envName = observer.getActiveEnvName()
      ? `env:${observer.getActiveEnvName()}`
      : 'Default';
    this._sbEnvSwitcher.text = `$(root-folder) ${envName} (${path.basename(
      observer.projectDir
    )})`;
  }

  async pickProjectEnv() {
    const items = [];
    for (const projectDir of projectHelpers.getPIOProjectDirs()) {
      const observer = this._pool.getObserver(projectDir);
      const envs = await observer.getProjectEnvs();
      if (!envs || !envs.length) {
        continue;
      }
      const shortProjectDir = `${path.basename(
        path.dirname(projectDir)
      )}/${path.basename(projectDir)}`;
      items.push({
        projectDir,
        label: 'Default',
        description: `$(folder) ${shortProjectDir} ("default_envs" from "platformio.ini")`,
      });
      items.push(
        ...envs.map((item) => ({
          projectDir,
          envName: item.name,
          label: `env:${item.name}`,
          description: `$(folder) ${shortProjectDir}`,
        }))
      );
    }
    const pickedItem = await vscode.window.showQuickPick(items, {
      matchOnDescription: true,
    });
    if (!pickedItem) {
      return;
    }
    this.switchToProject(pickedItem.projectDir, { envName: pickedItem.envName });
  }
}
