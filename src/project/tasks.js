/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import { IS_WINDOWS, STATUS_BAR_PRIORITY_START } from '../constants';
import ProjectTasksTreeProvider from './task-tree';
import { extension } from '../main';
import vscode from 'vscode';

export default class ProjectTaskManager {
  static PROVIDER_TYPE = 'PlatformIO';
  static TASKS_VIEW_ID = 'platformio-ide.projectTasks';
  static AUTO_REFRESH_DELAY = 500; // 0.5 sec

  constructor(projectDir, projectObserver) {
    this.projectDir = projectDir;
    this.projectObserver = projectObserver;
    this.subscriptions = [];

    this._sid = Math.random();
    this._refreshTimeout = undefined;
    this._sbEnvSwitcher = undefined;

    this.refresh();
  }

  dispose() {
    pioNodeHelpers.misc.disposeSubscriptions(this.subscriptions);
  }

  requestRefresh() {
    if (this._refreshTimeout) {
      clearTimeout(this._refreshTimeout);
    }
    this._refreshTimeout = setTimeout(
      this.refresh.bind(this),
      ProjectTaskManager.AUTO_REFRESH_DELAY
    );
  }

  async refresh(options = { force: false }) {
    this.dispose();

    if (options.force) {
      this.projectObserver.resetCache();
    }

    const projectEnvs = await this.projectObserver.getProjectEnvs();
    const defaultTasks = await this.projectObserver.getDefaultTasks();
    const envTasks = await this.getEnvTasks(projectEnvs);

    const taskViewer = vscode.window.createTreeView(ProjectTaskManager.TASKS_VIEW_ID, {
      treeDataProvider: new ProjectTasksTreeProvider(
        this._sid,
        { ...{ Default: defaultTasks }, ...envTasks },
        this.projectObserver.activeEnvName
      ),
      showCollapseAll: true,
    });

    this.subscriptions.push(
      taskViewer,
      // pre-fetch expanded env tasks
      taskViewer.onDidExpandElement(async ({ element }) =>
        (element.env || '').includes('env:')
          ? await this.onDidRequestEnvTasks(element.env.substring(4))
          : undefined
      ),
      // register VSCode Task Provider
      vscode.tasks.registerTaskProvider(ProjectTaskManager.PROVIDER_TYPE, {
        provideTasks: async () => {
          const result = defaultTasks.map((task) => this.toVSCodeTask(task));
          for (const tasks of Object.values(envTasks)) {
            result.push(...tasks.map((task) => this.toVSCodeTask(task)));
          }
          return result;
        },
        resolveTask: () => {
          return undefined;
        },
      })
    );

    this.controlDeviceMonitorTasks();
    this.registerTaskBasedCommands();
    if (projectEnvs.length > 1) {
      this.registerEnvSwitcher(projectEnvs);
    }
    vscode.commands.executeCommand(
      'setContext',
      'pioMultiEnvProject',
      projectEnvs.length > 1
    );
  }

  async getEnvTasks(envs) {
    const result = {};
    for (const item of envs) {
      result[`env:${item.name}`] =
        (await this.projectObserver.getLoadedEnvTasks(item.name)) || [];
    }
    return result;
  }

  async onDidRequestEnvTasks(name) {
    if (await this.projectObserver.getLoadedEnvTasks(name)) {
      return;
    }
    await this.projectObserver.loadEnvTasks(name);
    return await this.refresh();
  }

  toVSCodeTask(projectTask) {
    const envClone = Object.create(process.env);
    if (process.env.PLATFORMIO_PATH) {
      envClone.PATH = process.env.PLATFORMIO_PATH;
      envClone.Path = process.env.PLATFORMIO_PATH;
    }
    const vscodeTask = new vscode.Task(
      {
        type: ProjectTaskManager.PROVIDER_TYPE,
        task: projectTask.id,
      },
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(this.projectDir)),
      projectTask.title,
      ProjectTaskManager.PROVIDER_TYPE,
      new vscode.ProcessExecution(
        IS_WINDOWS ? 'platformio.exe' : 'platformio',
        projectTask.args,
        {
          cwd: this.projectDir,
          env: envClone,
        }
      ),
      '$platformio'
    );
    vscodeTask.presentationOptions = {
      panel: vscode.TaskPanelKind.Dedicated,
    };
    if (projectTask.isBuild()) {
      vscodeTask.group = vscode.TaskGroup.Build;
    } else if (projectTask.isClean()) {
      vscodeTask.group = vscode.TaskGroup.Clean;
    } else if (projectTask.isTest()) {
      vscodeTask.group = vscode.TaskGroup.Test;
    }
    return vscodeTask;
  }

  controlDeviceMonitorTasks() {
    let restoreAfterTask = undefined;
    let restoreTasks = [];

    this.subscriptions.push(
      vscode.tasks.onDidStartTaskProcess((event) => {
        if (
          !vscode.workspace
            .getConfiguration('platformio-ide')
            .get('autoCloseSerialMonitor')
        ) {
          return;
        }
        if (
          !['upload', 'test'].some((arg) =>
            event.execution.task.execution.args.includes(arg)
          )
        ) {
          return;
        }
        vscode.tasks.taskExecutions.forEach((e) => {
          if (event.execution.task === e.task) {
            return;
          }
          if (
            ['device', 'monitor'].every((arg) => e.task.execution.args.includes(arg))
          ) {
            restoreTasks.push(e.task);
          }
          if (e.task.execution.args.includes('monitor')) {
            e.terminate();
          }
        });
        restoreAfterTask = event.execution.task;
      }),

      vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution.task !== restoreAfterTask || event.exitCode !== 0) {
          return;
        }
        setTimeout(() => {
          restoreTasks.forEach((task) => {
            vscode.tasks.executeTask(task);
          });
          restoreTasks = [];
        }, parseInt(vscode.workspace.getConfiguration('platformio-ide').get('reopenSerialMonitorDelay')));
      })
    );
  }

  registerTaskBasedCommands() {
    const maybeEnvTask = (name) => {
      return this.projectObserver.activeEnvName
        ? `${name} (${this.projectObserver.activeEnvName})`
        : name;
    };

    this.subscriptions.push(
      vscode.commands.registerCommand('platformio-ide.build', () => {
        const taskName = extension.getSetting('buildTask') || {
          type: ProjectTaskManager.PROVIDER_TYPE,
          task: maybeEnvTask('Build'),
        };
        return vscode.commands.executeCommand(
          'workbench.action.tasks.runTask',
          taskName
        );
      }),
      vscode.commands.registerCommand('platformio-ide.upload', () =>
        vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: ProjectTaskManager.PROVIDER_TYPE,
          task: maybeEnvTask(
            extension.getSetting('forceUploadAndMonitor')
              ? 'Upload and Monitor'
              : 'Upload'
          ),
        })
      ),
      vscode.commands.registerCommand('platformio-ide.remote', () =>
        vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: ProjectTaskManager.PROVIDER_TYPE,
          task: maybeEnvTask('Remote'),
        })
      ),
      vscode.commands.registerCommand('platformio-ide.test', () =>
        vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: ProjectTaskManager.PROVIDER_TYPE,
          task: maybeEnvTask('Test'),
        })
      ),
      vscode.commands.registerCommand('platformio-ide.clean', () =>
        vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: ProjectTaskManager.PROVIDER_TYPE,
          task: maybeEnvTask('Clean'),
        })
      ),
      vscode.commands.registerCommand('platformio-ide.serialMonitor', () =>
        vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: ProjectTaskManager.PROVIDER_TYPE,
          task: maybeEnvTask('Monitor'),
        })
      )
    );
  }

  registerEnvSwitcher(envs) {
    // reset last selected env if it was removed from config
    if (
      this.projectObserver.activeEnvName &&
      !envs.some((item) => item.name === this.projectObserver.activeEnvName)
    ) {
      this.projectObserver.activeEnvName = undefined;
    }

    this._sbEnvSwitcher = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      STATUS_BAR_PRIORITY_START
    );
    this._sbEnvSwitcher.tooltip = 'Switch PlatformIO Project Environment';
    this._sbEnvSwitcher.command = 'platformio-ide.switchProjectEnv';
    this._sbEnvSwitcher.text = `$(root-folder) ${
      this.projectObserver.activeEnvName
        ? `env:${this.projectObserver.activeEnvName}`
        : 'Default'
    }`;
    this._sbEnvSwitcher.show();

    this.subscriptions.push(
      this._sbEnvSwitcher,
      vscode.commands.registerCommand('platformio-ide.switchProjectEnv', () =>
        this.switchProjectEnv(envs)
      )
    );
  }

  async switchProjectEnv(envs) {
    const items = [
      {
        label: 'Default',
        description:
          'All or "default_envs" declared in [platformio] section of "platformio.ini"',
      },
    ];
    items.push(...envs.map((item) => ({ label: `env:${item.name}` })));
    const pickedItem = await vscode.window.showQuickPick(items);
    if (!pickedItem) {
      return;
    }
    const newEnv =
      pickedItem.label === 'Default' ? undefined : pickedItem.label.substring(4);
    if (newEnv === this.projectObserver.activeEnvName) {
      return;
    }
    this.projectObserver.activeEnvName = newEnv;
    if (this.projectObserver.activeEnvName) {
      this._sbEnvSwitcher.text = '$(root-folder) Loading...';
      await this.projectObserver.loadEnvTasks(this.projectObserver.activeEnvName);
      this.refresh();
    }
    this.projectObserver.rebuildIndex();
  }
}
