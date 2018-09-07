/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import { extension } from './main';
import { notifyError } from './utils';
import path from 'path';
import vscode from 'vscode';


export default class PIOHome {

  constructor() {
    this.subscriptions = [];
    this._currentPanel = undefined;
  }

  async toggle() {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
    if (this._currentPanel) {
      this._currentPanel.reveal(column);
    } else {
      this._currentPanel = await this.newPanel();
    }
  }

  async newPanel() {
    const panel = vscode.window.createWebviewPanel(
      'pioHome',
      extension.getEnterpriseSetting('pioHomeTitle', 'PIO Home'),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    this.subscriptions.push(panel.onDidDispose(this.onPanelDisposed.bind(this)));
    panel.iconPath = vscode.Uri.file(path.join(extension.context.extensionPath, 'resources', 'platformio-mini-logo.png'));
    panel.webview.html = this.getLoadingContent();
    try {
      panel.webview.html = await this.getWebviewContent();
    } catch (err) {
      notifyError('Start PIO Home Server', err);
    }
    return panel;
  }

  getTheme() {
    const workbench = vscode.workspace.getConfiguration('workbench') || {};
    return (workbench.colorTheme || '').toLowerCase().includes('light') ? 'light' : 'dark';
  }

  getLoadingContent() {
    const theme = this.getTheme();
    return `<!DOCTYPE html>
    <html lang="en">
    <body style="background-color: ${theme === 'light' ? '#FFF' : '#1E1E1E'}">
      Loading...
    </body>
    </html>`;
  }

  async getWebviewContent() {
    const params = await pioNodeHelpers.home.ensureServerStarted({
      onIDECommand: (command, params) => {
        if (command === 'open_project') {
          if (vscode.workspace.workspaceFolders) {
            vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders.length, null, { uri: vscode.Uri.file(params)});
          } else {
            vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(params));
          }
          vscode.commands.executeCommand('workbench.view.explorer');
        }
      }
    });
    const start = '/';
    const theme = this.getTheme();
    return `<!DOCTYPE html>
      <html lang="en">
      <body style="margin: 0; padding: 0; height: 100%; overflow: hidden; background-color: ${theme === 'light' ? '#FFF' : '#1E1E1E'}">
        <iframe src="${ pioNodeHelpers.home.getFrontendUri(params.host, params.port, {
        start,
        theme,
        workspace: extension.getEnterpriseSetting('defaultPIOHomeWorkspace')
      })}"
          width="100%"
          height="100%"
          frameborder="0"
          style="border: 0; left: 0; right: 0; bottom: 0; top: 0; position:absolute;" />
      </body>
      </html>
    `;
  }

  onPanelDisposed() {
    this._currentPanel = undefined;
  }

  dispose() {
    if (this._currentPanel) {
      this._currentPanel.dispose();
      this._currentPanel = undefined;
    }
    pioNodeHelpers.misc.disposeSubscriptions(this.subscriptions);
    pioNodeHelpers.home.shutdownServer();
  }

}
