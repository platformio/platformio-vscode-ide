/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';
import * as piodebug from 'platformio-vscode-debug';

import { getIDEVersion, isPIOProject, notifyError } from './utils';

import InstallationManager from './installer/manager';
import PIOHome from './home';
import PIOTasksProvider from './tasks';
import PIOTerminal from './terminal';
import ProjectIndexer from './project/indexer';
import vscode from 'vscode';


class PlatformIOVSCodeExtension {

  constructor() {
    this.context = undefined;
    this.pioTerm = undefined;
    this.pioHome = undefined;

    this._enterpriseSettings = undefined;
  }

  async activate(context) {
    this.context = context;
    const hasPIOProject = this.workspaceHasPIOProject();

    if (this.getConfig().get('activateOnlyOnPlatformIOProject') && !hasPIOProject) {
      return;
    }

    this.pioTerm = new PIOTerminal();
    this.pioHome = new PIOHome();

    this.context.subscriptions.push(this.pioTerm);
    this.context.subscriptions.push(this.pioHome);

    pioNodeHelpers.misc.patchOSEnviron({
      caller: 'vscode',
      useBuiltinPIOCore: this.getConfig().get('useBuiltinPIOCore'),
      extraPath: this.getConfig().get('customPATH'),
      extraVars: {
        PLATFORMIO_IDE: getIDEVersion()
      }
    });

    await this.startInstaller();
    this.registerCommands();

    if (!hasPIOProject) {
      await this.startPIOHome();
      this.initStatusBar({ filterCommands: ['platformio-ide.showHome'] });
      return;
    }

    if (this.getConfig().get('updateTerminalPathConfiguration')) {
      this.pioTerm.updateEnvConfiguration();
    }

    this.initDebug();
    this.initTasksProvider();
    this.initStatusBar({ ignoreCommands: this.getEnterpriseSetting('ignoreToolbarCommands') });
    this.initProjectIndexer();
    await this.startPIOHome();
  }

  getConfig() {
    return vscode.workspace.getConfiguration('platformio-ide');
  }

  loadEnterpriseSettings() {
    const ext = vscode.extensions.all.find(item =>
      item.id.startsWith('platformio.')
      && item.id !== 'platformio.platformio-ide'
      && item.isActive
    );
    if (!ext || !ext.exports || !ext.exports.hasOwnProperty('settings')) {
      return;
    }
    return ext.exports.settings;
  }

  getEnterpriseSetting(id, defaultValue = undefined) {
    if (!this._enterpriseSettings) {
      this._enterpriseSettings = this.loadEnterpriseSettings();
    }
    if (!this._enterpriseSettings || !this._enterpriseSettings.hasOwnProperty(id)) {
      return defaultValue;
    }
    return this._enterpriseSettings[id];
  }

  workspaceHasPIOProject() {
    return vscode.workspace.rootPath && isPIOProject(vscode.workspace.rootPath);
  }

  startInstaller() {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'PlatformIO',
    }, async (progress) => {
      progress.report({
        message: 'Checking PlatformIO Core installation...',
      });

      const im = new InstallationManager(this.context.globalState);
      if (im.locked()) {
        vscode.window.showInformationMessage(
          'PlatformIO IDE installation has been suspended, because PlatformIO '
          + 'IDE Installer is already started in another window.');
      } else if (await im.check()) {
        return;
      } else {
        progress.report({
          message: 'Installing PlatformIO IDE...',
        });
        const outputChannel = vscode.window.createOutputChannel('PlatformIO Installation');
        outputChannel.show();

        outputChannel.appendLine('Installing PlatformIO Core...');
        outputChannel.appendLine('Please do not close this window and do not '
          + 'open other folders until this process is completed.');

        try {
          im.lock();
          await im.install();
          outputChannel.appendLine('PlatformIO IDE installed successfully.');
          const action = 'Reload Now';
          const selected = await vscode.window.showInformationMessage(
            'PlatformIO IDE has been successfully installed! Please reload window',
            action
          );
          if (selected === action) {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        } catch (err) {
          outputChannel.appendLine('Failed to install PlatformIO IDE.');
          notifyError('Installation Manager', err);
        } finally {
          im.unlock();
        }
      }
      im.destroy();
      return Promise.reject(undefined);
    });
  }

  async startPIOHome() {
    if (!pioNodeHelpers.home.showAtStartup('vscode')) {
      return;
    }
    // Hot-loading of PIO Home Server
    try {
      await pioNodeHelpers.home.ensureServerStarted();
    } catch (err) {
      return notifyError('Start PIO Home Server', err);
    }
    vscode.commands.executeCommand('platformio-ide.showHome');
  }

  registerCommands() {
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.showHome',
      () => this.pioHome.toggle()
    ));
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.build',
      () => vscode.commands.executeCommand(
        'workbench.action.tasks.runTask',
        `PlatformIO: ${this.getConfig().get('defaultToolbarBuildAction') === 'pre-debug' ? 'Pre-Debug' : 'Build'}`
      )
    ));
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.upload',
      () => {
        let task = 'PlatformIO: Upload';
        if (this.getConfig().get('forceUploadAndMonitor')) {
          task = 'PlatformIO: Upload and Monitor';
        }
        vscode.commands.executeCommand('workbench.action.tasks.runTask', task);
      }
    ));
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.remote',
      () => vscode.commands.executeCommand('workbench.action.tasks.runTask', 'PlatformIO: Remote')
    ));
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.test',
      () => vscode.commands.executeCommand('workbench.action.tasks.runTask', 'PlatformIO: Test')
    ));
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.clean',
      () => vscode.commands.executeCommand('workbench.action.tasks.runTask', 'PlatformIO: Clean')
    ));
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.serialMonitor',
      () => vscode.commands.executeCommand('workbench.action.tasks.runTask', 'PlatformIO: Monitor')
    ));
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.newTerminal',
      () => this.pioTerm.new().show()
    ));
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.updateCore',
      () => this.pioTerm.sendText('pio update')
    ));
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.upgradeCore',
      () => this.pioTerm.sendText('pio upgrade')
    ));
  }

  initDebug() {
    piodebug.activate(this.context);
  }

  initTasksProvider() {
    this.context.subscriptions.push(new PIOTasksProvider(vscode.workspace.rootPath));
  }

  initStatusBar({ filterCommands, ignoreCommands }) {
    [
      ['$(home)', 'PlatformIO: Home', 'platformio-ide.showHome'],
      ['$(check)', 'PlatformIO: Build', 'platformio-ide.build'],
      ['$(arrow-right)', 'PlatformIO: Upload', 'platformio-ide.upload'],
      ['$(cloud-upload)', 'PlatformIO: Upload to remote device', 'platformio-ide.remote'],
      ['$(trashcan)', 'PlatformIO: Clean', 'platformio-ide.clean'],
      ['$(beaker)', 'PlatformIO: Test', 'platformio-ide.test'],
      ['$(checklist)', 'PlatformIO: Run Task...', 'workbench.action.tasks.runTask'],
      ['$(plug)', 'PlatformIO: Serial Monitor', 'platformio-ide.serialMonitor'],
      ['$(terminal)', 'PlatformIO: New Terminal', 'platformio-ide.newTerminal']
    ]
      .filter(item => (!filterCommands || filterCommands.includes(item[2])) && (!ignoreCommands || !ignoreCommands.includes(item[2])))
      .reverse()
      .forEach((item, index) => {
        const [text, tooltip, command] = item;
        const sbItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10 + index);
        sbItem.text = text;
        sbItem.tooltip = tooltip;
        sbItem.command = command;
        sbItem.show();
        this.context.subscriptions.push(sbItem);
      });
  }

  initProjectIndexer() {
    const indexer = new ProjectIndexer(vscode.workspace.rootPath);
    this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => indexer.toggle()));
    this.context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.rebuildProjectIndex',
      () => indexer.doRebuild({
        verbose: true
      })
    ));
    this.context.subscriptions.push(indexer);
    indexer.toggle();
  }

  deactivate() {
  }
}

export const extension = new PlatformIOVSCodeExtension();

export function activate(context) {
  extension.activate(context);
  return extension;
}

export function deactivate() {
  extension.deactivate();
  piodebug.deactivate();
}
