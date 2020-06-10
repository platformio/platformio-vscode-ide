/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';
import * as utils from '../utils';

import { IS_WINDOWS } from '../constants';
import ProjectTasksTreeProvider from './tree-view';
import { extension } from '../main';
import path from 'path';
import vscode from 'vscode';

export default class ProjectTaskManager {
  static AUTO_REFRESH_DELAY = 500; // 0.5 sec
  static type = 'PlatformIO';

  constructor(projectDir) {
    this.projectDir = projectDir;
    this.subscriptions = [];
    this._sid = Math.random();
    this._refreshTimeout = undefined;
    this._envTasks = {};

    this.addProjectConfigWatcher();
    this.controlDeviceMonitorTasks();
    this.registerTaskBasedCommands();
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

  async refresh() {
    const envs = await this.loadProjectEnvs();
    const tasks = await this.getTasks(envs);
    const taskViewer = vscode.window.createTreeView('platformio-ide.projectTasks', {
      treeDataProvider: new ProjectTasksTreeProvider(
        this._sid,
        tasks,
        envs.map(item => item.name)
      ),
      showCollapseAll: true
    });
    this.subscriptions.push(
      taskViewer,
      // pre-fetch expanded env tasks
      taskViewer.onDidExpandElement(async ({ element }) => {
        if (element.env) {
          await this.onDidLoadEnvTasks(element.env);
        }
      }),
      // register VSCode Task Provider
      vscode.tasks.registerTaskProvider(ProjectTaskManager.type, {
        provideTasks: async () => {
          return tasks.map(task => this.toVSCodeTask(task));
        },
        resolveTask: () => {
          return undefined;
        }
      })
    );
  }

  async loadProjectEnvs() {
    const result = [];
    const prevCWD = process.cwd();
    process.chdir(this.projectDir);
    try {
      const config = new pioNodeHelpers.project.ProjectConfig();
      await config.read(path.join(this.projectDir, 'platformio.ini'));
      for (const name of config.envs()) {
        const platform = config.get(`env:${name}`, 'platform');
        if (!platform) {
          continue;
        }
        result.push({ name, platform });
      }
    } catch (err) {
      console.warn(
        `Could not parse "platformio.ini" file in ${this.projectDir}: ${err}`
      );
    }
    // restore original CWD
    process.chdir(prevCWD);
    return result;
  }

  async getTasks(envs) {
    const pt = new pioNodeHelpers.project.ProjectTasks(this.projectDir, 'vscode');
    const result = await pt.getGenericTasks();
    for (const item of envs) {
      result.push(...(this._envTasks[item.name] || []));
    }
    return result;
  }

  async onDidLoadEnvTasks(name) {
    if (name in this._envTasks) {
      return;
    }
    await this.fetchEnvTasks(name);
    this.requestRefresh();
  }

  async fetchEnvTasks(name) {
    const pt = new pioNodeHelpers.project.ProjectTasks(this.projectDir, 'vscode');
    this._envTasks[name] = [];
    this._envTasks[name] = await pt.fetchEnvTasks(name);
    return this._envTasks[name];
  }

  toVSCodeTask(projectTask) {
    const vscodeTask = new vscode.Task(
      {
        type: ProjectTaskManager.type,
        task: projectTask.id
      },
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(this.projectDir)),
      projectTask.title,
      ProjectTaskManager.type,
      new vscode.ProcessExecution(
        IS_WINDOWS ? 'platformio.exe' : 'platformio',
        projectTask.args,
        {
          cwd: this.projectDir,
          env: process.env
        }
      ),
      '$platformio'
    );
    vscodeTask.presentationOptions = {
      panel: vscode.TaskPanelKind.Dedicated
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

  addProjectConfigWatcher() {
    try {
      const watcher = vscode.workspace.createFileSystemWatcher(
        path.join(this.projectDir, 'platformio.ini')
      );
      this.subscriptions.push(
        watcher,
        watcher.onDidCreate(() => {
          this.requestRefresh();
        }),
        watcher.onDidChange(() => {
          this.requestRefresh();
        }),
        watcher.onDidDelete(() => {
          this.dispose();
        })
      );
    } catch (err) {
      utils.notifyError('Project Tasks FileSystemWatcher', err);
    }
  }

  controlDeviceMonitorTasks() {
    let restoreAfterTask = undefined;
    let restoreTasks = [];

    this.subscriptions.push(
      vscode.tasks.onDidStartTaskProcess(event => {
        if (
          !vscode.workspace
            .getConfiguration('platformio-ide')
            .get('autoCloseSerialMonitor')
        ) {
          return;
        }
        if (
          !['upload', 'test'].some(arg =>
            event.execution.task.execution.args.includes(arg)
          )
        ) {
          return;
        }
        vscode.tasks.taskExecutions.forEach(e => {
          if (event.execution.task === e.task) {
            return;
          }
          if (['device', 'monitor'].every(arg => e.task.execution.args.includes(arg))) {
            restoreTasks.push(e.task);
          }
          if (e.task.execution.args.includes('monitor')) {
            e.terminate();
          }
        });
        restoreAfterTask = event.execution.task;
      }),

      vscode.tasks.onDidEndTaskProcess(event => {
        if (event.execution.task !== restoreAfterTask) {
          return;
        }
        setTimeout(() => {
          restoreTasks.forEach(task => {
            vscode.tasks.executeTask(task);
          });
          restoreTasks = [];
        }, parseInt(vscode.workspace.getConfiguration('platformio-ide').get('reopenSerialMonitorDelay')));
      })
    );
  }

  registerTaskBasedCommands() {
    this.subscriptions.push(
      vscode.commands.registerCommand('platformio-ide.build', () => {
        const taskName = extension.getSetting('buildTask') || {
          type: ProjectTaskManager.type,
          task: 'Build'
        };
        return vscode.commands.executeCommand(
          'workbench.action.tasks.runTask',
          taskName
        );
      }),
      vscode.commands.registerCommand('platformio-ide.upload', () =>
        vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: ProjectTaskManager.type,
          task: extension.getSetting('forceUploadAndMonitor')
            ? 'Upload and Monitor'
            : 'Upload'
        })
      ),
      vscode.commands.registerCommand('platformio-ide.remote', () =>
        vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: ProjectTaskManager.type,
          task: 'Remote'
        })
      ),
      vscode.commands.registerCommand('platformio-ide.test', () =>
        vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: ProjectTaskManager.type,
          task: 'Test'
        })
      ),
      vscode.commands.registerCommand('platformio-ide.clean', () =>
        vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: ProjectTaskManager.type,
          task: 'Clean'
        })
      ),
      vscode.commands.registerCommand('platformio-ide.serialMonitor', () =>
        vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: ProjectTaskManager.type,
          task: 'Monitor'
        })
      )
    );
  }

  dispose() {
    pioNodeHelpers.misc.disposeSubscriptions(this.subscriptions);
  }
}
