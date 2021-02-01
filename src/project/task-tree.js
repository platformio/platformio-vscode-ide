/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as vscode from 'vscode';

import ProjectTaskManager from './tasks';

export default class ProjectTasksTreeProvider {
  constructor(id, envTasks, selectedEnvName) {
    this.id = id;
    this.envTasks = envTasks;
    this.selectedEnvName = selectedEnvName;
    this.multiEnvProject =
      Object.keys(this.envTasks).filter((env) => env.includes('env:')).length > 1;
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
    if (!task.coreEnv && task.multienv && this.multiEnvProject) {
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

  getRootChildren() {
    const result = [];
    for (const env of Object.keys(this.envTasks)) {
      const treeItem = new vscode.TreeItem(
        env,
        env === `env:${this.selectedEnvName}` ||
        (env.includes('env:') && !this.multiEnvProject)
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      treeItem.id = `${this.id}-${env}`;
      treeItem.env = env;
      treeItem.iconPath = new vscode.ThemeIcon('root-folder');
      result.push(treeItem);
    }
    return result;
  }

  getGroupChildren(group, env = undefined) {
    return this.envTasks[env].filter((task) => task.group === group);
  }

  getEnvChildren(env) {
    const envTasks = this.envTasks[env];
    if (!envTasks.length) {
      return [new vscode.TreeItem('Loading...')];
    }
    const result = envTasks.filter((task) => !task.group && !task.coreEnv);
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
