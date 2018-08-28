/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as vscode from 'vscode';

class QuickItem extends vscode.TreeItem {
  constructor(label, command, collapsibleState, children) {
    super(label, collapsibleState);
    if (command) {
      this.command = {
        title: label,
        command
      };
    }
    this.customChildren = children;
  }
}

export default class QuickAccessTreeProvider {

  getChildren(element) {
    if (element && element.customChildren) {
      return element.customChildren;
    }
    return [
      new QuickItem('PIO Home', 'platformio-ide.showHome'),
      new QuickItem('New Terminal', 'platformio-ide.newTerminal'),
      new QuickItem('Clone Git Project', 'git.clone'),
      new QuickItem('Updates', undefined, vscode.TreeItemCollapsibleState.Expanded, [
        new QuickItem('Update global libraries', 'platformio-ide.updateGlobalLibs'),
        new QuickItem('Update platforms & packages', 'platformio-ide.updatePlatforms'),
        new QuickItem('Update PIO Core packages, platforms, and global libraries', 'platformio-ide.updateCore'),
        new QuickItem('Upgrade PlatformIO Core', 'platformio-ide.upgradeCore')
      ])
    ];
  }

  getTreeItem(element) {
    return element;
  }

}
