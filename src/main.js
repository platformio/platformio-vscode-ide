/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as misc from './misc';
import * as pioNodeHelpers from 'platformio-node-helpers';
import * as piodebug from 'platformio-vscode-debug';
import * as utils from './utils';

import InstallationManager from './installer/manager';
import PIOHome from './home';
import PIOTerminal from './terminal';
import ProjectTasksTreeProvider from './views/project-tasks-tree';
import QuickAccessTreeProvider from './views/quick-access-tree';
import StateStorage from './state-storage';
import TaskManager from './tasks';
import fs from 'fs-plus';
import path from 'path';
import vscode from 'vscode';

class PlatformIOVSCodeExtension {

  constructor() {
    this.context = undefined;
    this.pioTerm = undefined;
    this.pioHome = undefined;
    this.subscriptions = [];
    this.taskSubscriptions = [];

    this._enterpriseSettings = undefined;
  }

  async activate(context) {
    this.context = context;
    this.stateStorage = new StateStorage(context.globalState);
    this.pioHome = new PIOHome();
    this.pioTerm = new PIOTerminal();

    this.context.subscriptions.push(
      this.pioHome,
      this.pioTerm
    );

    const hasPIOProject = !!utils.getActivePIOProjectDir();
    if (!hasPIOProject && this.getConfig().get('activateOnlyOnPlatformIOProject')) {
      return;
    }

    // temporary workaround for https://github.com/Microsoft/vscode/issues/58348
    if (!vscode.workspace.getConfiguration('extensions').has('showRecommendationsOnlyOnDemand')) {
      vscode.workspace.getConfiguration('extensions').update('showRecommendationsOnlyOnDemand', true);
    }

    this.patchOSEnviron();

    this.context.subscriptions.push(this.handleUseDevelopmentPIOCoreConfiguration());

    await this.startInstaller();
    vscode.commands.executeCommand('setContext', 'pioCoreReady', true);

    if (typeof this.getEnterpriseSetting('onPIOCoreReady') === 'function') {
      await this.getEnterpriseSetting('onPIOCoreReady')();
    }

    this.initDebug();
    this.registerGlobalCommands();

    // workaround: init empty Project Tasks view to keep it above QuickAccess
    this.taskSubscriptions.push(
      vscode.window.registerTreeDataProvider('platformio-activitybar.projectTasks',
      new ProjectTasksTreeProvider([]))
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
    this.startPIOHome();

    misc.maybeRateExtension(this.stateStorage);
    misc.warnAboutConflictedExtensions();
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(editor => misc.warnAboutInoFile(editor, this.stateStorage))
    );
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

  patchOSEnviron() {
    const extraVars = {
      PLATFORMIO_IDE: utils.getIDEVersion()
    };
    // handle HTTP proxy settings
    const http_proxy = vscode.workspace.getConfiguration('http').get('proxy');
    if (http_proxy && !process.env.HTTP_PROXY && !process.env.http_proxy) {
      extraVars['HTTP_PROXY'] = http_proxy;
    }
    if (http_proxy && !process.env.HTTPS_PROXY && !process.env.https_proxy) {
      extraVars['HTTPS_PROXY'] = http_proxy;
    }
    pioNodeHelpers.misc.patchOSEnviron({
      caller: 'vscode',
      useBuiltinPIOCore: this.getConfig().get('useBuiltinPIOCore'),
      extraPath: this.getConfig().get('customPATH'),
      extraVars
    });
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
          outputChannel.appendLine('PlatformIO IDE installed successfully.\n');
          outputChannel.appendLine('Please restart VSCode.');
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
    if (this.getConfig().get('disableAutostartPIOHomeServer')) {
      return;
    }
    // Auto-start of PIO Home Server
    try {
      await pioNodeHelpers.home.ensureServerStarted();
    } catch (err) {
      console.warn(err);
      // return utils.notifyError('Start PIO Home Server', err);
    }
    if (!pioNodeHelpers.home.showAtStartup('vscode')) {
      return;
    }
    vscode.commands.executeCommand('platformio-ide.showHome');
  }

  registerGlobalCommands() {
    this.subscriptions.push(
      vscode.commands.registerCommand(
        'platformio-ide.showHome',
        (startUrl) => this.pioHome.toggle(startUrl)
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
        () => this.pioTerm.sendText('platformio update')
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
        () =>  {
          const taskName = this.getConfig().get('buildTask') || {
            type: TaskManager.type,
            task: 'Build'
          };
          return vscode.commands.executeCommand('workbench.action.tasks.runTask', taskName);
        }
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
    this.subscriptions.push(manager, manager.onDidProjectTasksUpdated(tasks => {
      this.disposeTaskSubscriptions();
      this.taskSubscriptions.push(
        vscode.window.registerTreeDataProvider('platformio-activitybar.projectTasks',
        new ProjectTasksTreeProvider(tasks))
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
        this.subscriptions.push(sbItem);
      });
  }

  initProjectIndexer() {
    const observer = new pioNodeHelpers.project.ProjectObserver({
      ide: 'vscode',
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

  handleUseDevelopmentPIOCoreConfiguration() {
    return vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('platformio-ide.useDevelopmentPIOCore') || !this.getConfig().get('useBuiltinPIOCore')) {
        return;
      }
      const envDir = pioNodeHelpers.core.getEnvDir();
      if (!envDir || !fs.isDirectorySync(envDir)) {
        return;
      }
      pioNodeHelpers.home.shutdownServer();
      const delayedJob = () => {
        try {
          fs.removeSync(envDir);
        } catch (err) {
          console.warn(err);
        }
        vscode.window.showInformationMessage('Please restart VSCode to apply the changes.');
      };
      setTimeout(delayedJob, 2000);
    });
  }

  disposeLocalSubscriptions() {
    vscode.commands.executeCommand('setContext', 'pioCoreReady', false);
    pioNodeHelpers.misc.disposeSubscriptions(this.subscriptions);
  }

  disposeTaskSubscriptions() {
    pioNodeHelpers.misc.disposeSubscriptions(this.taskSubscriptions);
  }

  deactivate() {
    this.disposeTaskSubscriptions();
    this.disposeLocalSubscriptions();
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
