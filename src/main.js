/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';
import * as piodebug from 'platformio-vscode-debug';
import * as utils from './utils';

import InstallationManager from './installer/manager';
import PIOHome from './home';
import PIOTerminal from './terminal';
import QuickAccessTreeProvider from './views/quick-access-tree';
import TaskManager from './tasks';
import TasksTreeProvider from './views/tasks-tree';
import { maybeRateExtension } from './misc';
import path from 'path';
import vscode from 'vscode';

class PlatformIOVSCodeExtension {

  constructor() {
    this.context = undefined;
    this.pioTerm = undefined;
    this.pioHome = undefined;
    this.subscriptions = [];
    this.taskSubscriptions = [];

    this._inited = false;
    this._initedBefore = false;
    this._enterpriseSettings = undefined;
  }

  activate(context) {
    this.context = context;
    this.pioHome = new PIOHome();
    this.pioTerm = new PIOTerminal();

    this.context.subscriptions.push(
      this.pioHome,
      this.pioTerm,
      vscode.workspace.onDidChangeWorkspaceFolders(this.reinit.bind(this)),
      vscode.workspace.onDidChangeConfiguration(() => this.reinit(true))
    );

    this.reinit();
  }

  async reinit(force) {
    const hasPIOProject = !!utils.getActivePIOProjectDir();
    if (!hasPIOProject || force) {
      this.deactivate();
      this._inited = false;
    }
    if (this._inited || (!hasPIOProject && this.getConfig().get('activateOnlyOnPlatformIOProject'))) {
      return;
    }

    if (!this._initedBefore) {
      pioNodeHelpers.misc.patchOSEnviron({
        caller: 'vscode',
        useBuiltinPIOCore: this.getConfig().get('useBuiltinPIOCore'),
        extraPath: this.getConfig().get('customPATH'),
        extraVars: {
          PLATFORMIO_IDE: utils.getIDEVersion()
        }
      });
      await this.startInstaller();
      this.initDebug();
      if (typeof this.getEnterpriseSetting('onPIOCoreReady') === 'function') {
        await this.getEnterpriseSetting('onPIOCoreReady')();
      }
    }

    vscode.commands.executeCommand('setContext', 'pioCoreReady', true);

    this.registerGlobalCommands();

    // workaround: init empty Tasks view to keep it above QuickAccess
    this.taskSubscriptions.push(
      vscode.window.registerTreeDataProvider('platformio-activitybar.tasks',
      new TasksTreeProvider([]))
    );
    this.subscriptions.push(
      vscode.window.registerTreeDataProvider('platformio-activitybar.quickAccess',
      new QuickAccessTreeProvider())
    );

    if (!hasPIOProject) {
      await this.startPIOHome();
      this.initToolbar({ filterCommands: ['platformio-ide.showHome'] });
      return;
    }

    this.initTasks();

    if (this.getConfig().get('updateTerminalPathConfiguration')) {
      this.pioTerm.updateEnvConfiguration();
    }

    this.initToolbar({ ignoreCommands: this.getEnterpriseSetting('ignoreToolbarCommands') });
    this.initProjectIndexer();
    await this.startPIOHome();
    maybeRateExtension(this.context.globalState);

    this._inited = true;
    this._initedBefore = true;
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
          utils.notifyError('Installation Manager', err);
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
      return utils.notifyError('Start PIO Home Server', err);
    }
    vscode.commands.executeCommand('platformio-ide.showHome');
  }

  registerGlobalCommands() {
    this.subscriptions.push(
      vscode.commands.registerCommand(
        'platformio-ide.showHome',
        () => this.pioHome.toggle()
      ),
      vscode.commands.registerCommand(
        'platformio-ide.newTerminal',
        () => this.pioTerm.new().show()
      ),
      vscode.commands.registerCommand(
        'platformio-ide.startDebugging',
        () => {
          vscode.commands.executeCommand('workbench.view.debug');
          vscode.commands.executeCommand('workbench.debug.action.toggleRepl');
          vscode.commands.executeCommand('workbench.action.debug.start');
        }
      ),
      vscode.commands.registerCommand(
        'platformio-ide.updateGlobalLibs',
        () => this.pioTerm.sendText('platformio lib --global update')
      ),
      vscode.commands.registerCommand(
        'platformio-ide.updatePlatforms',
        () => this.pioTerm.sendText('platformio platform update')
      ),
      vscode.commands.registerCommand(
        'platformio-ide.updateCore',
        () => this.pioTerm.sendText('platformio update --core-packages')
      ),
      vscode.commands.registerCommand(
        'platformio-ide.upgradeCore',
        () => this.pioTerm.sendText('platformio upgrade')
      )
    );
  }

  registerTaskBasedCommands() {
    this.subscriptions.push(
      vscode.commands.registerCommand(
        'platformio-ide.build',
        () => vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: TaskManager.type,
          task: this.getConfig().get('defaultToolbarBuildAction') === 'pre-debug' ? 'Pre-Debug' : 'Build'
        })
      ),
      vscode.commands.registerCommand(
        'platformio-ide.upload',
        () => vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: TaskManager.type,
          task: this.getConfig().get('forceUploadAndMonitor') ? 'Upload and Monitor' : 'Upload'
        })
      ),
      vscode.commands.registerCommand(
        'platformio-ide.remote',
        () => vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: TaskManager.type,
          task: 'Remote'
        })
      ),
      vscode.commands.registerCommand(
        'platformio-ide.test',
        () => vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: TaskManager.type,
          task: 'Test'
        })
      ),
      vscode.commands.registerCommand(
        'platformio-ide.clean',
        () => vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: TaskManager.type,
          task: 'Clean'
        })
      ),
      vscode.commands.registerCommand(
        'platformio-ide.serialMonitor',
        () => vscode.commands.executeCommand('workbench.action.tasks.runTask', {
          type: TaskManager.type,
          task: 'Monitor'
        })
      )
    );
  }

  initTasks() {
    const manager = new TaskManager();
    this.subscriptions.push(manager, manager.onDidTasksUpdated(tasks => {
      this.disposeTaskSubscriptions();
      this.taskSubscriptions.push(
        vscode.window.registerTreeDataProvider('platformio-activitybar.tasks',
        new TasksTreeProvider(tasks))
      );
    }));
    manager.registerProvider();
    this.registerTaskBasedCommands();
  }

  initDebug() {
    piodebug.activate(this.context);
  }

  initToolbar({ filterCommands, ignoreCommands }) {
    if (this.getConfig().get('disableToolbar')) {
      return;
    }
    [
      ['$(home)', 'PlatformIO: Home', 'platformio-ide.showHome'],
      ['$(check)', 'PlatformIO: Build', 'platformio-ide.build'],
      ['$(arrow-right)', 'PlatformIO: Upload', 'platformio-ide.upload'],
      ['$(cloud-upload)', 'PlatformIO: Upload to remote device', 'platformio-ide.remote'],
      ['$(trashcan)', 'PlatformIO: Clean', 'platformio-ide.clean'],
      ['$(beaker)', 'PlatformIO: Test', 'platformio-ide.test'],
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
        this.subscriptions.push(sbItem);
      });
  }

  initProjectIndexer() {
    const observer = new pioNodeHelpers.project.ProjectObserver({
      createFileSystemWatcher: vscode.workspace.createFileSystemWatcher,
      createDirSystemWatcher: (dir) => vscode.workspace.createFileSystemWatcher(path.join(dir, '*')),
      withProgress: (task) => vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: 'PlatformIO: IntelliSense Index Rebuild'
      }, task),
      useBuiltinPIOCore: this.getConfig().get('useBuiltinPIOCore')
    });

    const doUpdate = () => {
      observer.update(this.getConfig().get('autoRebuildAutocompleteIndex') && vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath) : []);
    };

    this.subscriptions.push(
      observer,
      vscode.workspace.onDidChangeWorkspaceFolders(doUpdate.bind(this)),
      vscode.workspace.onDidChangeConfiguration(doUpdate.bind(this)),
      vscode.commands.registerCommand(
        'platformio-ide.rebuildProjectIndex',
        () => {
          doUpdate(); // re-scan PIO Projects
          observer.rebuildIndex();
        }
      )
    );
    doUpdate();
  }

  disposeTaskSubscriptions() {
    pioNodeHelpers.misc.disposeSubscriptions(this.taskSubscriptions);
  }

  deactivate() {
    this.disposeTaskSubscriptions();
    pioNodeHelpers.misc.disposeSubscriptions(this.subscriptions);
    vscode.commands.executeCommand('setContext', 'pioCoreReady', false);
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
