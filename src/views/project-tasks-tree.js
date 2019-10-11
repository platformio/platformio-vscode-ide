/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as vscode from 'vscode';

import TaskManager from '../tasks';
import { extension } from '../main';
import path from 'path';

export default class ProjectTasksTreeProvider {
  constructor(tasks) {
    this.tasks = tasks;
  }

  getChildren(element) {
    if (element) {
      return this.tasks.filter(task => task.coreEnv === element.label.substr(4));
    }
    const items = [];
    const knownEnvs = [];
    this.tasks.forEach(task => {
      const coreEnv = task.coreEnv;
      if (!coreEnv) {
        items.push(task);
        return;
      }
      if (!knownEnvs.includes(coreEnv)) {
        const item = new vscode.TreeItem(
          `env:${coreEnv}`,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.iconPath = {
          light: path.join(
            extension.context.extensionPath,
            'resources',
            'icons',
            'task-env.svg'
          ),
          dark: path.join(
            extension.context.extensionPath,
            'resources',
            'icons',
            'task-env-inverse.svg'
          )
        };
        items.push(item);
        knownEnvs.push(coreEnv);
      }
    });
    return items;
  }

  getTreeItem(item) {
    if (item instanceof vscode.TreeItem) {
      return item;
    }
    const element = new vscode.TreeItem(item.name);
    element.iconPath = {
      light: path.join(
        extension.context.extensionPath,
        'resources',
        'icons',
        'task.svg'
      ),
      dark: path.join(
        extension.context.extensionPath,
        'resources',
        'icons',
        'task-inverse.svg'
      )
    };
    element.tooltip = item.title;
    element.command = {
      title: item.title,
      command: 'workbench.action.tasks.runTask',
      arguments: [
        {
          type: TaskManager.type,
          task: item.id
        }
      ]
    };
    return element;
  }
}
