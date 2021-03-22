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
import ProjectObservable from './project/observable';
import QuickAccessTreeProvider from './views/quick-access-tree';
import { STATUS_BAR_PRIORITY_START } from './constants';
import StateStorage from './state-storage';
import fs from 'fs-plus';
import vscode from 'vscode';

class PlatformIOVSCodeExtension {
  constructor() {
    this.context = undefined;
    this.pioTerm = undefined;
    this.pioHome = undefined;
    this.projectObservable = undefined;
    this.subscriptions = [];

    this._enterpriseSettings = undefined;
  }

  async activate(context) {
    this.context = context;
    this.stateStorage = new StateStorage(context.globalState);
    this.pioHome = new PIOHome();
    this.pioTerm = new PIOTerminal();

    this.subscriptions.push(this.pioHome, this.pioTerm);

    const hasPIOProject = ProjectObservable.getPIOProjectDirs().length > 0;
    if (!hasPIOProject && this.getSetting('activateOnlyOnPlatformIOProject')) {
      return;
    }

    // temporary workaround for https://github.com/Microsoft/vscode/issues/58348
    if (
      !vscode.workspace
        .getConfiguration('extensions')
        .has('showRecommendationsOnlyOnDemand')
    ) {
      vscode.workspace
        .getConfiguration('extensions')
        .update('showRecommendationsOnlyOnDemand', true);
    }

    this.patchOSEnviron();
    await this.startInstaller(!hasPIOProject);
    this.subscriptions.push(this.handleUseDevelopmentPIOCoreConfiguration());

    vscode.commands.executeCommand('setContext', 'pioCoreReady', true);
    if (typeof this.getEnterpriseSetting('onPIOCoreReady') === 'function') {
      await this.getEnterpriseSetting('onPIOCoreReady')();
    }

    this.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        'platformio-activitybar.quickAccess',
        new QuickAccessTreeProvider()
      )
    );

    this.registerGlobalCommands();

    if (!hasPIOProject) {
      this.initToolbar({ filterCommands: ['platformio-ide.showHome'] });
      return;
    }

    vscode.commands.executeCommand('setContext', 'pioProjectReady', true);

    this.initDebug();
    this.initToolbar({
      ignoreCommands: this.getEnterpriseSetting('ignoreToolbarCommands'),
    });
    this.projectObservable = new ProjectObservable();
    this.subscriptions.push(this.projectObservable);

    this.startPIOHome();

    misc.maybeRateExtension(this.stateStorage);
    misc.warnAboutConflictedExtensions();
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) =>
        misc.warnAboutInoFile(editor, this.stateStorage)
      )
    );
  }

  getSetting(id) {
    return vscode.workspace.getConfiguration('platformio-ide').get(id);
  }

  loadEnterpriseSettings() {
    const ext = vscode.extensions.all.find(
      (item) =>
        item.id.startsWith('platformio.') &&
        item.id !== 'platformio.platformio-ide' &&
        item.isActive
    );
    return ext && ext.exports ? ext.exports.settings : undefined;
  }

  getEnterpriseSetting(id, defaultValue = undefined) {
    if (!this._enterpriseSettings) {
      this._enterpriseSettings = this.loadEnterpriseSettings();
    }
    if (this._enterpriseSettings && id in this._enterpriseSettings) {
      return this._enterpriseSettings[id];
    }
    return defaultValue;
  }

  patchOSEnviron() {
    const extraVars = {
      PLATFORMIO_IDE: utils.getIDEVersion(),
    };
    // handle HTTP proxy settings
    const http_proxy = vscode.workspace.getConfiguration('http').get('proxy');
    if (http_proxy && !process.env.HTTP_PROXY && !process.env.http_proxy) {
      extraVars['HTTP_PROXY'] = http_proxy;
    }
    if (!vscode.workspace.getConfiguration('http').get('proxyStrictSSL')) {
      // https://stackoverflow.com/questions/48391750/disable-python-requests-ssl-validation-for-an-imported-module
      extraVars['CURL_CA_BUNDLE'] = '';
    }
    if (http_proxy && !process.env.HTTPS_PROXY && !process.env.https_proxy) {
      extraVars['HTTPS_PROXY'] = http_proxy;
    }
    if (this.getSetting('customPyPiIndexUrl')) {
      extraVars['PIP_INDEX_URL'] = this.getSetting('customPyPiIndexUrl');
    }
    pioNodeHelpers.proc.patchOSEnviron({
      caller: 'vscode',
      extraPath: this.getSetting('customPATH'),
      extraVars,
    });
  }

  async startInstaller(disableAutoUpdates) {
    const im = new InstallationManager(this.context.globalState, disableAutoUpdates);
    if (im.locked()) {
      vscode.window.showInformationMessage(
        'PlatformIO IDE installation has been suspended, because PlatformIO ' +
          'IDE Installer is already started in another window.'
      );
      return;
    }
    const doInstall = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'PlatformIO',
      },
      async (progress) => {
        progress.report({
          message: 'Checking PlatformIO Core installation...',
        });
        try {
          return !(await im.check());
        } catch (err) {}
        return true;
      }
    );

    if (!doInstall) {
      return;
    }

    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'PlatformIO Installer',
      },
      async (progress) => {
        progress.report({
          message: 'Installing PlatformIO IDE...',
        });
        const outputChannel = vscode.window.createOutputChannel(
          'PlatformIO Installation'
        );
        outputChannel.show();
        outputChannel.appendLine('Installing PlatformIO IDE...');
        outputChannel.appendLine(
          'It may take a few minutes depending on your connection speed'
        );
        outputChannel.appendLine(
          'Please do not close this window and do not ' +
            'open other folders until this process is completed.'
        );
        outputChannel.appendLine(
          '\nDebugging information is available via VSCode > Help > Toggle Developer Tools > Console.'
        );

        try {
          im.lock();
          await im.install(progress);
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

        im.destroy();
        return true;
      }
    );
  }

  async startPIOHome() {
    if (
      this.getSetting('disablePIOHomeStartup') ||
      !pioNodeHelpers.home.showAtStartup('vscode')
    ) {
      return;
    }
    vscode.commands.executeCommand('platformio-ide.showHome');
  }

  registerGlobalCommands() {
    this.subscriptions.push(
      vscode.commands.registerCommand('platformio-ide.showHome', (startUrl) =>
        this.pioHome.toggle(startUrl)
      ),
      vscode.commands.registerCommand('platformio-ide.newTerminal', () =>
        this.pioTerm.new().show()
      ),
      vscode.commands.registerCommand('platformio-ide.openPIOCoreCLI', () =>
        this.pioTerm.sendText('pio --help')
      ),
      vscode.commands.registerCommand('platformio-ide.startDebugging', () => {
        vscode.commands.executeCommand('workbench.view.debug');
        vscode.commands.executeCommand('workbench.debug.action.toggleRepl');
        vscode.commands.executeCommand('workbench.action.debug.start');
      }),
      vscode.commands.registerCommand('platformio-ide.updateGlobalLibs', () =>
        this.pioTerm.sendText('pio lib --global update')
      ),
      vscode.commands.registerCommand('platformio-ide.updatePlatforms', () =>
        this.pioTerm.sendText('pio platform update')
      ),
      vscode.commands.registerCommand('platformio-ide.updateCore', () =>
        this.pioTerm.sendText('pio update')
      ),
      vscode.commands.registerCommand('platformio-ide.upgradeCore', () =>
        this.pioTerm.sendText('pio upgrade')
      )
    );
  }

  initDebug() {
    piodebug.activate(this.context);
  }

  initToolbar({ filterCommands, ignoreCommands }) {
    if (this.getSetting('disableToolbar')) {
      return;
    }
    [
      ['$(home)', 'PlatformIO: Home', 'platformio-ide.showHome'],
      ['$(check)', 'PlatformIO: Build', 'platformio-ide.build'],
      ['$(arrow-right)', 'PlatformIO: Upload', 'platformio-ide.upload'],
      ['$(trashcan)', 'PlatformIO: Clean', 'platformio-ide.clean'],
      ['$(plug)', 'PlatformIO: Serial Monitor', 'platformio-ide.serialMonitor'],
      ['$(terminal)', 'PlatformIO: New Terminal', 'platformio-ide.newTerminal'],
    ]
      .filter(
        (item) =>
          (!filterCommands || filterCommands.includes(item[2])) &&
          (!ignoreCommands || !ignoreCommands.includes(item[2]))
      )
      .reverse()
      .forEach((item, index) => {
        const [text, tooltip, command] = item;
        const sbItem = vscode.window.createStatusBarItem(
          vscode.StatusBarAlignment.Left,
          STATUS_BAR_PRIORITY_START + index + 1
        );
        sbItem.text = text;
        sbItem.tooltip = tooltip;
        sbItem.command = command;
        sbItem.show();
        this.subscriptions.push(sbItem);
      });
  }

  handleUseDevelopmentPIOCoreConfiguration() {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        !e.affectsConfiguration('platformio-ide.useDevelopmentPIOCore') ||
        !this.getSetting('useBuiltinPIOCore')
      ) {
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
        vscode.window.showInformationMessage(
          'Please restart VSCode to apply the changes.'
        );
      };
      setTimeout(delayedJob, 2000);
    });
  }

  disposeLocalSubscriptions() {
    vscode.commands.executeCommand('setContext', 'pioCoreReady', false);
    pioNodeHelpers.misc.disposeSubscriptions(this.subscriptions);
  }

  deactivate() {
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
