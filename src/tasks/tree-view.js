/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as vscode from 'vscode';

import ProjectTaskManager from './project';

export default class ProjectTasksTreeProvider {
  constructor(id, tasks, envs) {
    this.id = id;
    this.tasks = tasks;
    this.envs = envs;
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
      command: 'workbench.action.tasks.runTask',
      arguments: [
        {
          type: ProjectTaskManager.type,
          task: task.id,
        },
      ],
    };
    if (!task.coreEnv && task.multienv && this.envs.length > 1) {
      treeItem.label += ' All';
    }
    return treeItem;
  }

  getChildren(element) {
    if (element && element.group) {
      return this.getGroupChildren(element.group, element.env);
    } else if (element && element.env) {
      return this.getEnvChildren(element.env);
    }
    return this.getRootChildren();
  }

  getTaskGroups(tasks) {
    return new Set(tasks.filter((task) => task.group).map((task) => task.group));
  }

  getRootChildren() {
    const result = this.tasks.filter((task) => !task.group && !task.coreEnv);
    // root groups
    for (const group of this.getTaskGroups(this.tasks)) {
      if (['Platform', 'Custom'].includes(group)) {
        continue;
      }
      const treeItem = new vscode.TreeItem(
        group,
        group === 'General'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      treeItem.group = group;
      treeItem.iconPath = vscode.ThemeIcon.Folder;
      result.push(treeItem);
    }
    // envs
    for (const env of this.envs) {
      const treeItem = new vscode.TreeItem(
        `env:${env}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      treeItem.id = `${this.id}-${env}`;
      treeItem.env = env;
      treeItem.iconPath = new vscode.ThemeIcon('root-folder');
      result.push(treeItem);
    }
    return result;
  }

  getGroupChildren(group, env = undefined) {
    return this.tasks.filter((task) => task.group === group && task.coreEnv === env);
  }

  getEnvChildren(env) {
    const envTasks = this.tasks.filter((task) => task.coreEnv == env);
    if (!envTasks.length) {
      return [new vscode.TreeItem('Loading...')];
    }
    const result = envTasks.filter((task) => !task.group && !task.coreEnv);
    // root groups
    for (const group of this.getTaskGroups(envTasks)) {
      const element = new vscode.TreeItem(
        group,
        group === 'General'
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
}
