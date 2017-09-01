/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import { getIDEVersion, isPIOProject } from './utils';

import { HomeContentProvider } from './home';
import InstallationManager from './installer/manager';
import PIOTasksProvider from './tasks';
import PIOTerminal from './terminal';
import ProjectIndexer from './project/indexer';
import initCommand from './commands/init';
import vscode from 'vscode';


class PlatformIOVSCodeExtension {

  constructor() {
    this.config = vscode.workspace.getConfiguration('platformio-ide');
    this.pioTerm = new PIOTerminal();

    this._context = null;
    this._isMonitorRun = false;
  }

  async activate(context) {
    this._context = context;

    pioNodeHelpers.misc.patchOSEnviron({
      caller: 'vscode',
      useBuiltinPIOCore: this.config.get('useBuiltinPIOCore'),
      extraPath: this.config.get('customPATH'),
      extraVars: {
        PLATFORMIO_IDE: getIDEVersion()
      }
    });

    this.registerCommands();

    await this.startInstaller();

    if (pioNodeHelpers.home.showAtStartup('vscode')) {
      vscode.commands.executeCommand('platformio-ide.showHome');
    }

    if (!vscode.workspace.rootPath || !isPIOProject(vscode.workspace.rootPath)) {
      this.initStatusBar(['PlatformIO: Home']);
      return;
    }

    this.initTasksProvider();
    this.initStatusBar();
    this.initProjectIndexer();
  }

  startInstaller() {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'PlatformIO',
    }, async (progress) => {
      progress.report({
        message: 'Verifying PlatformIO Core installation...',
      });

      const im = new InstallationManager(this._context.globalState);
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
        const outputChannel = vscode.window.createOutputChannel('PlatformIO Instalation');
        outputChannel.show();

        outputChannel.appendLine('Installing PlatformIO Core...');
        outputChannel.appendLine('Please don\'t close this window and don\'t '
          + 'open other folders until this process is completed.');

        try {
          im.lock();
          await im.install();
          outputChannel.appendLine('PlatformIO IDE installed successfully.');
        } catch (err) {
          vscode.window.showErrorMessage(err.toString(), {
            modal: true,
          });
          outputChannel.appendLine('Failed to install PlatformIO IDE.');
        } finally {
          im.unlock();
        }
      }
      im.destroy();
      return Promise.reject(null);
    });
  }

  registerCommands() {
    // PIO Home
    this._context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('platformio-home', new HomeContentProvider()));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.showHome',
      () => vscode.commands.executeCommand('vscode.previewHtml', vscode.Uri.parse('platformio-home://'), vscode.ViewColumn.One, 'PIO Home')
    ));

    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.initProject',
      initCommand
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.build',
      async () => {
        await this.terminateMonitorTask();
        vscode.commands.executeCommand('workbench.action.tasks.runTask', 'PlatformIO: Build');
      }
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.upload',
      async () => {
        await this.terminateMonitorTask();

        let task = 'PlatformIO: Upload';
        if (this.config.get('forceUploadAndMonitor')) {
          task = 'PlatformIO: Upload and Monitor';
          this._isMonitorRun = true;
        }
        vscode.commands.executeCommand('workbench.action.tasks.runTask', task);
      }
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.clean',
      async () => {
        await this.terminateMonitorTask();
        vscode.commands.executeCommand('workbench.action.tasks.runTask', 'PlatformIO: Clean');
      }
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.serialMonitor',
      async () => {
        await this.terminateMonitorTask();
        this._isMonitorRun = true;
        vscode.commands.executeCommand('workbench.action.tasks.runTask', 'PlatformIO: Monitor');
      }
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.libraryManager',
      () => this.pioTerm.sendText('pio lib')
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.newTerminal',
      () => this.pioTerm.new().show()
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.updateCore',
      () => this.pioTerm.sendText('pio update')
    ));
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.upgradeCore',
      () => this.pioTerm.sendText('pio upgrade')
    ));
  }

  async terminateMonitorTask() {
    if (!this._isMonitorRun) {
      return;
    }
    try {
      await vscode.commands.executeCommand('workbench.action.tasks.terminate');
    } catch (err) {
      console.error(err);
    }
    this._isMonitorRun = false;
    return new Promise(resolve => setTimeout(() => resolve(), 500));
  }

  initTasksProvider() {
    this._context.subscriptions.push(new PIOTasksProvider(vscode.workspace.rootPath));
  }

  initStatusBar(filterItems) {
    const items = [
      ['$(home)', 'PlatformIO: Home', 'platformio-ide.showHome'],
      ['$(check)', 'PlatformIO: Build', 'platformio-ide.build'],
      ['$(arrow-right)', 'PlatformIO: Upload', 'platformio-ide.upload'],
      ['$(trashcan)', 'PlatformIO: Clean', 'platformio-ide.clean'],
      ['$(checklist)', 'PlatformIO: Run a Task', 'workbench.action.tasks.runTask'],
      ['$(plug)', 'PlatformIO: Serial Monitor', 'platformio-ide.serialMonitor'],
      ['$(terminal)', 'PlatformIO: New Terminal', 'platformio-ide.newTerminal']
    ];
    items.filter(item => !filterItems || filterItems.includes(item[1])).reverse().forEach((item, index) => {
      const [text, tooltip, command] = item;
      const sbItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10 + index);
      sbItem.text = text;
      sbItem.tooltip = tooltip;
      sbItem.command = command;
      sbItem.show();
      this._context.subscriptions.push(sbItem);
    });
  }

  initProjectIndexer() {
    const indexer = new ProjectIndexer(vscode.workspace.rootPath);
    this._context.subscriptions.push(indexer);
    this._context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => indexer.toggle()));
    indexer.toggle();
    this._context.subscriptions.push(vscode.commands.registerCommand(
      'platformio-ide.rebuildProjectIndex',
      () => indexer.doRebuild({ verbose: true })
    ));
  }

  deactivate() {
    this.pioTerm.dispose();
    HomeContentProvider.shutdownServer();
  }
}

const pio = new PlatformIOVSCodeExtension();

export function activate(context) {
  pio.activate(context);
}

export function deactivate() {
  pio.deactivate();
}
