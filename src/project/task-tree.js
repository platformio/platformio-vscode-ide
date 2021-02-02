/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as vscode from 'vscode';

export default class ProjectTasksTreeProvider {
  static DEFAULT_ENV_NAME = 'Default';

  constructor(id, envs, tasks, activeEnvName) {
    this.id = id;
    this.envs = envs;
    this.tasks = tasks;
    this.activeEnvName = activeEnvName;
    this.multiEnvProject = this.envs.length > 1;
  }

  getTreeItem(item) {
    return item instanceof vscode.TreeItem ? item : this.taskToTreeItem(item);
  }

  taskToTreeItem(task) {
    const treeItem = new vscode.TreeItem(task.name);
    treeItem.iconPath = new vscode.ThemeIcon('circle-outline');
    treeItem.tooltip = task.title;
    treeItem.command = {
      title: task.title,
      command: 'platformio-ide.privateRunTask',
      arguments: [task],
    };
    if (!task.coreEnv && task.multienv && this.multiEnvProject) {
      treeItem.label += ' All';
    }
    return treeItem;
  }

  getChildren(element) {
    if (element && element.group) {
      return this.getEnvGroupChildren(element.env, element.group);
    } else if (element && element.env) {
      return this.getEnvChildren(element.env);
    }
    return this.getRootChildren();
  }

  getRootChildren() {
    const result = [];
    for (const envName of [undefined, ...this.envs.map((item) => item.name)]) {
      const treeItem = new vscode.TreeItem(
        envName || ProjectTasksTreeProvider.DEFAULT_ENV_NAME,
        envName && (envName === this.activeEnvName || !this.multiEnvProject)
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      treeItem.id = `${this.id}-${envName}`;
      treeItem.env = envName;
      treeItem.iconPath = new vscode.ThemeIcon('root-folder');
      result.push(treeItem);
    }
    return result;
  }

  getEnvGroupChildren(env, group) {
    return this.tasks.filter((task) => task.coreEnv === env && task.group === group);
  }

  getEnvChildren(env) {
    const envTasks = this.tasks.filter((task) => task.coreEnv === env);
    if (!envTasks.length) {
      return [new vscode.TreeItem('Loading...')];
    }
    const result = envTasks.filter((task) => !task.group);
    // root groups
    for (const group of this.getTaskGroups(envTasks)) {
      const element = new vscode.TreeItem(
        group,
        ['General', 'Platform'].includes(group)
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      element.env = env;
      element.group = group;
      element.iconPath = vscode.ThemeIcon.Folder;
      result.push(element);
    }
    return result;
  }

  getTaskGroups(tasks) {
    const result = ['General'];
    const candidates = tasks.filter((task) => task.group).map((task) => task.group);
    // reorder
    if (candidates.includes('Platform')) {
      result.push('Platform');
    }
    for (const group of candidates) {
      if (!result.includes(group)) {
        result.push(group);
      }
    }
    return result;
  }
}
