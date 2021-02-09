/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import { IS_WINDOWS } from '../constants';
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
    this._restoreOnDidEndTask = undefined;
    this._tasksToRestore = [];

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

  async refresh({ force = false } = {}) {
    this.dispose();

    if (force) {
      this.projectObserver.resetCache();
      this._sid = Math.random();
    }

    const projectEnvs = await this.projectObserver.getProjectEnvs();
    const projectTasks = [...(await this.projectObserver.getDefaultTasks())];
    for (const item of projectEnvs) {
      projectTasks.push(
        ...((await this.projectObserver.getLoadedEnvTasks(item.name)) || [])
      );
    }

    const taskViewer = vscode.window.createTreeView(ProjectTaskManager.TASKS_VIEW_ID, {
      treeDataProvider: new ProjectTasksTreeProvider(
        this._sid,
        projectEnvs,
        projectTasks,
        this.projectObserver.getActiveEnvName()
      ),
      showCollapseAll: true,
    });

    this.subscriptions.push(
      taskViewer,

      // pre-fetch expanded env tasks
      taskViewer.onDidExpandElement(async ({ element }) => {
        if (element.env) {
          await this.onDidRequestEnvTasks(element.env);
        }
      }),

      // register VSCode Task Provider
      vscode.tasks.registerTaskProvider(ProjectTaskManager.PROVIDER_TYPE, {
        provideTasks: async () => projectTasks.map((task) => this.toVSCodeTask(task)),
        resolveTask: () => {
          return undefined;
        },
      }),

      vscode.tasks.onDidEndTaskProcess((event) => this.onDidEndTaskProcess(event))
    );

    this.registerTaskBasedCommands(projectTasks);
    vscode.commands.executeCommand(
      'setContext',
      'pioMultiEnvProject',
      projectEnvs.length > 1
    );
  }

  async onDidRequestEnvTasks(name) {
    if (await this.projectObserver.getLoadedEnvTasks(name)) {
      return;
    }
    await this.projectObserver.loadEnvTasks(name);
    return this.requestRefresh();
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

  runTask(task) {
    this._autoCloseSerialMonitor(task);
    vscode.commands.executeCommand('workbench.action.tasks.runTask', {
      type: ProjectTaskManager.PROVIDER_TYPE,
      task: task.id,
    });
  }

  _autoCloseSerialMonitor(task) {
    const closeMonitorConds = [
      extension.getSetting('autoCloseSerialMonitor'),
      ['upload', 'test'].some((arg) => task.args.includes(arg)),
    ];
    if (!closeMonitorConds.every((value) => value)) {
      return;
    }
    vscode.tasks.taskExecutions.forEach((event) => {
      const isMonitorAndUploadTask = ['--target', 'upload', 'monitor'].every((arg) =>
        event.task.execution.args.includes(arg)
      );
      const skipConds = [
        // skip non-PlatformIO task
        event.task.definition.type !== ProjectTaskManager.PROVIDER_TYPE,
        !event.task.execution.args.includes('monitor'),
        this.areTasksEqual(task, event.task) && !isMonitorAndUploadTask,
      ];
      if (skipConds.some((value) => value)) {
        return;
      }
      event.terminate();
      if (
        !isMonitorAndUploadTask &&
        ['device', 'monitor'].every((arg) => event.task.execution.args.includes(arg))
      ) {
        this._tasksToRestore.push(event.task);
      }
    });
    this._restoreOnDidEndTask = task;
  }

  onDidEndTaskProcess(event) {
    const skipConds = [
      !this._restoreOnDidEndTask,
      event.execution.task.definition.type !== ProjectTaskManager.PROVIDER_TYPE,
      event.exitCode !== 0,
      this.areTasksEqual(this._restoreOnDidEndTask, event.execution.task),
    ];
    if (skipConds.some((value) => value)) {
      return;
    }
    this._restoreOnDidEndTask = undefined;
    setTimeout(() => {
      while (this._tasksToRestore.length) {
        vscode.tasks.executeTask(this._tasksToRestore.pop());
      }
    }, parseInt(extension.getSetting('reopenSerialMonitorDelay')));
  }

  areTasksEqual(task1, task2) {
    if (!task1 || !task2) {
      return task1 === task2;
    }
    const args1 = task1.args || task1.execution.args;
    const args2 = task2.args || task2.execution.args;
    return args1 === args2;
  }

  registerTaskBasedCommands(tasks) {
    const _runTask = (name) => {
      const candidates = tasks.filter(
        (task) =>
          task.name === name && task.coreEnv === this.projectObserver.getActiveEnvName()
      );
      this.runTask(candidates[0]);
    };

    this.subscriptions.push(
      vscode.commands.registerCommand('platformio-ide.build', () => {
        if (extension.getSetting('buildTask')) {
          return vscode.commands.executeCommand(
            'workbench.action.tasks.runTask',
            extension.getSetting('buildTask')
          );
        }
        _runTask('Build');
      }),
      vscode.commands.registerCommand('platformio-ide.upload', () =>
        _runTask(
          extension.getSetting('forceUploadAndMonitor')
            ? 'Upload and Monitor'
            : 'Upload'
        )
      ),
      vscode.commands.registerCommand('platformio-ide.test', () => _runTask('Test')),
      vscode.commands.registerCommand('platformio-ide.clean', () => _runTask('Clean')),
      vscode.commands.registerCommand('platformio-ide.serialMonitor', () =>
        _runTask('Monitor')
      ),
      vscode.commands.registerCommand('platformio-ide.remoteUpload', () =>
        _runTask('Remote Upload')
      )
    );
  }
}
