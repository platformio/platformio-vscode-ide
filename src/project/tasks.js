/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { IS_WINDOWS, STATUS_BAR_PRIORITY_START } from '../constants';
import { disposeSubscriptions, listCoreSerialPorts, notifyError } from '../utils';
import { getProjectItemState, updateProjectItemState } from './helpers';
import ProjectTasksTreeProvider from './task-tree';
import { extension } from '../main';
import path from 'path';
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
    this._multienvTaskExplorer = false;
    this._refreshTimeout = undefined;
    this._startedTask = undefined;
    this._tasksToRestore = [];
    this._sbPortSwitcher = undefined;
    this._customPort = getProjectItemState(projectDir, 'customPort');

    this.refresh();
  }

  dispose() {
    disposeSubscriptions(this.subscriptions);
  }

  toggleMultiEnvExplorer() {
    this._multienvTaskExplorer = !this._multienvTaskExplorer;
    this.refresh({ force: true });
  }

  requestRefresh() {
    if (this._refreshTimeout) {
      clearTimeout(this._refreshTimeout);
    }
    this._refreshTimeout = setTimeout(
      this.refresh.bind(this),
      ProjectTaskManager.AUTO_REFRESH_DELAY,
    );
  }

  async refresh({ force = false } = {}) {
    this.dispose();

    if (force) {
      this.projectObserver.resetCache();
      this._sid = Math.random();
    }

    const projectEnvs = (await this.projectObserver.getConfig()).envs();
    const projectTasks = [...(await this.projectObserver.getDefaultTasks())];
    for (const env of projectEnvs) {
      projectTasks.push(...((await this.projectObserver.getLoadedEnvTasks(env)) || []));
    }

    const taskViewer = vscode.window.createTreeView(ProjectTaskManager.TASKS_VIEW_ID, {
      treeDataProvider: new ProjectTasksTreeProvider(
        this._sid,
        projectEnvs,
        projectTasks,
        this.projectObserver.getSelectedEnv(),
        this._multienvTaskExplorer,
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
        provideTasks: () => projectTasks.map((task) => this.toVSCodeTask(task)),
        resolveTask: () => {
          return undefined;
        },
      }),

      vscode.tasks.onDidEndTaskProcess((event) => this.onDidEndTaskProcess(event)),
    );

    this.registerTaskBasedCommands(projectTasks);
    this.registerPortSwitcher();
    vscode.commands.executeCommand('setContext', 'pioProjectTasksReady', true);
    vscode.commands.executeCommand(
      'setContext',
      'pioMultiEnvProject',
      projectEnvs.length > 1,
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
    const envClone = Object.assign({}, process.env);
    if (process.env.PLATFORMIO_PATH) {
      envClone.PATH = process.env.PLATFORMIO_PATH;
      envClone.Path = process.env.PLATFORMIO_PATH;
    }
    // getCoreArgs only appends --upload-port when the TaskItem declares
    // optionalArgs. Dynamically fetched targets (uploadfs, erase_flash, …)
    // have no optionalArgs, so we append the port ourselves when needed.
    let coreArgs = projectTask.getCoreArgs({ port: this._customPort });
    if (
      this._customPort &&
      !coreArgs.includes('--upload-port') &&
      ProjectTaskManager._isPortOwningTarget(this._getTarget(coreArgs))
    ) {
      coreArgs = [...coreArgs, '--upload-port', this._customPort];
    }

    const vscodeTask = new vscode.Task(
      {
        type: ProjectTaskManager.PROVIDER_TYPE,
        task: projectTask.id,
      },
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(this.projectDir)),
      projectTask.id,
      ProjectTaskManager.PROVIDER_TYPE,
      new vscode.ProcessExecution(
        IS_WINDOWS ? 'platformio.exe' : 'platformio',
        coreArgs,
        {
          cwd: this.projectDir,
          env: envClone,
        },
      ),
      '$platformio',
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

  async runTask(task) {
    this._autoCloseSerialMonitor(task);

    // Wait for all port-owning tasks (upload*, erase*) until all subscribers
    // (e.g. ESP-Decoder) have released the serial port before starting the task.
    if (this._needsPortCoordinationTask(task)) {
      try {
        await extension.fireWillUpload(this._customPort);
      } catch (err) {
        notifyError('Upload Port Coordination', err);
        return;
      }
      // Set ownership only for real uploads so that fireDidUpload is emitted
      // on completion. Erase tasks do not emit upload lifecycle events.
      await vscode.commands.executeCommand(
        'workbench.action.tasks.runTask',
        `${ProjectTaskManager.PROVIDER_TYPE}: ${task.id}`,
      );
      if (this._isUploadTask(task)) {
        this._ownedUploadTaskId = task.id;
      }
      return;
    }

    // use string-based task defination for Win 7 // issue #3481
    vscode.commands.executeCommand(
      'workbench.action.tasks.runTask',
      `${ProjectTaskManager.PROVIDER_TYPE}: ${task.id}`,
    );
  }

  async _autoCloseSerialMonitor(startedTask) {
    this._startedTask = startedTask;
    this._tasksToRestore = [];
    const startedArgs = this.getTaskArgs(this._startedTask);
    const closeMonitorConds = [
      extension.getConfiguration('autoCloseSerialMonitor'),
      startedArgs.includes('test') || this._needsPortCoordinationTask(this._startedTask),
    ];
    if (!closeMonitorConds.every((value) => value)) {
      return;
    }

    // skip "native" dev-platform
    // const platform = (await this.projectObserver.getConfig()).getEnvPlatform(
    //   await this.projectObserver.revealActiveEnvironment()
    // );
    // if (platform === 'native') {
    //   return;
    // }

    vscode.tasks.taskExecutions.forEach((event) => {
      const isCurrentTask = this.areTasksEqual(this._startedTask, event.task);
      const skipConds = [
        // skip non-PlatformIO task
        event.task.definition.type !== ProjectTaskManager.PROVIDER_TYPE,
        !this.getTaskArgs(event.task).includes('monitor'),
        this.isMonitorAndUploadTask(event.task) && !isCurrentTask,
      ];
      if (skipConds.some((value) => value)) {
        return;
      }
      // do not restart the same tasks
      if (!isCurrentTask) {
        this._tasksToRestore.push(event.task);
      }
      event.terminate();
    });
  }

  onDidEndTaskProcess(event) {
    // Only fire onDidUpload for the exact upload task started by this manager
    // instance to avoid duplicate emissions when multiple ProjectTaskManagers
    // are active (one per workspace folder).
    if (
      this._ownedUploadTaskId &&
      event.execution.task.definition.type === ProjectTaskManager.PROVIDER_TYPE &&
      event.execution.task.definition.task === this._ownedUploadTaskId
    ) {
      this._ownedUploadTaskId = undefined;
      extension.fireDidUpload(this._customPort, event.exitCode);
    }

    const skipConds = [
      !this._startedTask,
      !this.areTasksEqual(this._startedTask, event.execution.task),
      event.exitCode !== 0,
      !this._tasksToRestore.length,
    ];
    if (skipConds.some((value) => value)) {
      return;
    }
    this._startedTask = undefined;
    setTimeout(
      () => {
        while (this._tasksToRestore.length) {
          vscode.tasks.executeTask(this._tasksToRestore.pop());
        }
      },
      parseInt(extension.getConfiguration('reopenSerialMonitorDelay')),
    );
  }

  getTaskArgs(task) {
    return task.args || task.execution.args;
  }

  isMonitorAndUploadTask(task) {
    const args = this.getTaskArgs(task);
    return ['--target', 'upload', 'monitor'].every((arg) => args.includes(arg));
  }

  static _isPortOwningTarget(target) {
    return /^(upload|erase)/i.test(target ?? '');
  }

  _getTarget(args) {
    const idx = args.indexOf('--target');
    return idx !== -1 ? args[idx + 1] : undefined;
  }

  // Returns true for any task that needs exclusive port access: upload* and
  // erase* targets. Used for port coordination and serial monitor auto-close.
  _needsPortCoordinationTask(task) {
    const args = this.getTaskArgs(task);
    return (
      args.includes('upload') ||
      ProjectTaskManager._isPortOwningTarget(this._getTarget(args))
    );
  }

  // Returns true only for real upload tasks (upload, uploadfs, …).
  // Erase tasks are intentionally excluded so upload lifecycle events
  // (fireWillUpload / fireDidUpload) are not emitted for erase operations.
  _isUploadTask(task) {
    const args = this.getTaskArgs(task);
    return (
      args.includes('upload') ||
      /^upload/i.test(this._getTarget(args) ?? '')
    );
  }

  areTasksEqual(task1, task2) {
    if (!task1 || !task2) {
      return task1 === task2;
    }
    const args1 = this.getTaskArgs(task1);
    const args2 = this.getTaskArgs(task2);
    return (
      args1.length === args2.length &&
      args1.every((value, index) => value === args2[index])
    );
  }

  registerTaskBasedCommands(tasks) {
    const _runTask = (name) => {
      const candidates = tasks.filter(
        (task) =>
          task.name === name && task.coreEnv === this.projectObserver.getSelectedEnv(),
      );
      this.runTask(candidates[0]);
    };

    this.subscriptions.push(
      vscode.commands.registerCommand('platformio-ide.build', () => _runTask('Build')),
      vscode.commands.registerCommand('platformio-ide.upload', () =>
        _runTask('Upload'),
      ),
      vscode.commands.registerCommand('platformio-ide.uploadAndMonitor', () =>
        _runTask('Upload and Monitor'),
      ),
      vscode.commands.registerCommand('platformio-ide.clean', () => _runTask('Clean')),
      vscode.commands.registerCommand('platformio-ide.test', () => _runTask('Test')),
      vscode.commands.registerCommand('platformio-ide.serialMonitor', () =>
        _runTask('Monitor'),
      ),
    );
  }

  registerPortSwitcher() {
    this._sbPortSwitcher = vscode.window.createStatusBarItem(
      'pio-port-switcher',
      vscode.StatusBarAlignment.Left,
      STATUS_BAR_PRIORITY_START,
    );
    this._sbPortSwitcher.name = 'pioarduino: Port Switcher';
    this._sbPortSwitcher.tooltip = 'Set upload/monitor/test port';
    this._sbPortSwitcher.command = 'platformio-ide.setProjectPort';
    this.switchPort(this._customPort);

    this.subscriptions.push(
      this._sbPortSwitcher,
      vscode.commands.registerCommand('platformio-ide.setProjectPort', () =>
        this.pickProjectPort(),
      ),
    );
  }

  async pickProjectPort() {
    let serialPorts = await listCoreSerialPorts();
    if (process.platform === 'darwin') {
      serialPorts = serialPorts.filter(
        (port) => !/\.(Bluetooth|debug)/i.test(port.port),
      );
    } else if (process.platform === 'linux') {
      serialPorts = serialPorts.filter(
        (port) => !/\/(ttyS\d+|rfcomm)/.test(port.port),
      );
    } else if (process.platform === 'win32') {
      serialPorts = serialPorts.filter(
        (port) => !/bluetooth/i.test(port.description || ''),
      );
    }
    const pickedItem = await vscode.window.showQuickPick(
      [
        { label: 'Auto' },
        ...serialPorts.map((port) => ({
          label: port.port,
          description: [port.description, port.hwid]
            .filter((value) => !!value)
            .join(' | '),
        })),
        { label: 'Custom...' },
      ],
      {
        matchOnDescription: true,
      },
    );
    if (!pickedItem) {
      return;
    }
    if (pickedItem.label === 'Custom...') {
      const value = await vscode.window.showInputBox({
        title: 'Enter custom upload/monitor/test port',
        placeHolder: 'Examples: COM3, /dev/ttyUSB*, 192.168.0.13, /media/disk',
      });
      if (!value) {
        return;
      }
      this.switchPort(value.trim());
    } else {
      this.switchPort(pickedItem.label !== 'Auto' ? pickedItem.label : undefined);
    }
  }

  switchPort(port = undefined) {
    updateProjectItemState(this.projectDir, 'customPort', port);
    this._customPort = port;
    this._sbPortSwitcher.text = `$(plug) ${
      this._customPort ? path.basename(this._customPort) : 'Auto'
    }`;
    this._sbPortSwitcher.show();
  }
}
