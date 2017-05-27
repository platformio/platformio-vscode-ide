/**
 * Copyright 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { ensureDirExists } from './utils';

import InstallationManager from './installer/manager';
import ProjectIndexer from './project/indexer';
import initCommand from './commands/init';
import path from 'path';
import semver from 'semver';
import vscode from 'vscode';

export default class PlatformIOVSCodeExtension {

  constructor() {
    this.activate = this.activate.bind(this);

    const min = 100;
    const max = 999;
    this.instanceId = Math.floor(Math.random() * (max - min)) + min;
  }

  async activate(context) {
    if (!vscode.workspace.rootPath) {
      return;
    }

    const ext = vscode.extensions.getExtension('platformio.platformio-ide');
    const isPrerelease = Boolean(semver.prerelease(ext.packageJSON.version));

    await this.startInstaller(context.globalState, context.extensionPath, isPrerelease);

    const indexer = new ProjectIndexer(vscode.workspace.rootPath);
    context.subscriptions.push(indexer);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => indexer.toggle()));

    await indexer.toggle();

    context.subscriptions.push(
      vscode.commands.registerCommand(
        'platformio-ide.init-project',
        initCommand)
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        'platformio-ide.rebuild-index',
        () => indexer.doRebuild({
          verbose: true,
        }))
    );
  }

  startInstaller(globalState, extensionPath, isPrerelease) {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'PlatformIO',
    }, async (progress) => {
      progress.report({
        message: 'Verifying PlatformIO Core installation...',
      });

      const cacheDir = path.join(extensionPath, '.cache');
      await ensureDirExists(cacheDir);

      const config = vscode.workspace.getConfiguration('platformio-ide');
      const im = new InstallationManager(globalState, config, cacheDir, isPrerelease);

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

        outputChannel.appendLine('Installing PlatformIO Core...');
        outputChannel.appendLine("Please don't close this window and don't "
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
}
