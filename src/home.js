/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import { IS_OSX } from './constants';
import ProjectObservable from './project/observable';
import crypto from 'crypto';
import { extension } from './main';
import { notifyError } from './utils';
import path from 'path';
import vscode from 'vscode';

export default class PIOHome {
  static defaultStartUrl = '/';

  constructor() {
    this.subscriptions = [];
    this._currentPanel = undefined;
    this._lastStartUrl = PIOHome.defaultStartUrl;

    // close PIO Home when workspaces folders are changed (VSCode reactivates extensiuon)
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(this.disposePanel.bind(this))
    );
  }

  async toggle(startUrl = PIOHome.defaultStartUrl) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
    try {
      if (this._currentPanel) {
        if (this._lastStartUrl !== startUrl) {
          this._currentPanel.webview.html = await this.getWebviewContent(startUrl);
        }
        return this._currentPanel.reveal(column);
      }
    } catch (err) {
      console.warn(err);
    }
    this._currentPanel = await this.newPanel(startUrl);
  }

  async newPanel(startUrl) {
    const panel = vscode.window.createWebviewPanel(
      'pioHome',
      extension.getEnterpriseSetting('pioHomeTitle', 'PIO Home'),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    this.subscriptions.push(panel.onDidDispose(this.onPanelDisposed.bind(this)));
    panel.iconPath = vscode.Uri.file(
      path.join(
        extension.context.extensionPath,
        'resources',
        'platformio-mini-logo.svg'
      )
    );
    panel.webview.html = this.getLoadingContent();
    try {
      panel.webview.html = await this.getWebviewContent(startUrl);
    } catch (err) {
      if (!err.toString().includes('Webview is disposed')) {
        notifyError('Start PIO Home Server', err);
      }
    }
    return panel;
  }

  getTheme() {
    const workbench = vscode.workspace.getConfiguration('workbench') || {};
    return (workbench.colorTheme || '').toLowerCase().includes('light')
      ? 'light'
      : 'dark';
  }

  getLoadingContent() {
    const theme = this.getTheme();
    return `<!DOCTYPE html>
    <html lang="en">
    <body style="background-color: ${theme === 'light' ? '#FFF' : '#1E1E1E'}">
      <div style="padding: 15px;">Loading...</div>
    </body>
    </html>`;
  }

  async getWebviewContent(startUrl) {
    this._lastStartUrl = startUrl;
    await pioNodeHelpers.home.ensureServerStarted({
      port: extension.getSetting('pioHomeServerHttpPort'),
      host: extension.getSetting('pioHomeServerHttpHost'),
      onIDECommand: await this.onIDECommand.bind(this),
    });
    const theme = this.getTheme();
    const iframeId =
      'pioHomeIFrame-' +
      crypto.createHash('sha1').update(crypto.randomBytes(512)).digest('hex');
    const iframeScript = `
<script>
  for (const command of ['selectAll', 'copy', 'paste', 'cut', 'undo', 'redo']) {
    document.addEventListener(command, (e) => {
      document.getElementById('${iframeId}').contentWindow.postMessage({'command': 'execCommand', 'data': command}, '*');
    });
  }
  window.addEventListener('message', (e) => {
    if (e.data.command === 'kbd-event') {
      window.dispatchEvent(new KeyboardEvent('keydown', e.data.data));
    }
  });
</script>
  `;
    return `<!DOCTYPE html>
      <html lang="en">
      <head>${IS_OSX ? iframeScript : ''}</head>
      <body style="margin: 0; padding: 0; height: 100%; overflow: hidden; background-color: ${
        theme === 'light' ? '#FFF' : '#1E1E1E'
      }">
        <iframe id="${iframeId}" src="${pioNodeHelpers.home.getFrontendUrl({
      start: startUrl,
      theme,
      workspace: extension.getEnterpriseSetting('defaultPIOHomeWorkspace'),
    })}"
          width="100%"
          height="100%"
          frameborder="0"
          style="border: 0; left: 0; right: 0; bottom: 0; top: 0; position:absolute;" />
      </body>
      </html>
    `;
  }

  async onIDECommand(command, params) {
    switch (command) {
      case 'open_project':
        return this.onOpenProjectCommand(params);
      case 'open_text_document':
        return await this.onOpenTextDocumentCommand(params);
      case 'get_pio_project_dirs':
        return this.onGetPIOProjectDirs();
    }
  }

  onOpenProjectCommand(params) {
    if (extension.projectObservable) {
      extension.projectObservable.saveProjectStateItem(
        vscode.Uri.file(params).fsPath,
        'activeEnv',
        undefined
      );
      extension.projectObservable.switchToProject(vscode.Uri.file(params).fsPath);
    }
    this.disposePanel();
    if (vscode.workspace.workspaceFolders) {
      vscode.workspace.updateWorkspaceFolders(
        vscode.workspace.workspaceFolders.length,
        null,
        { uri: vscode.Uri.file(params) }
      );
    } else {
      vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(params));
    }
    vscode.commands.executeCommand('workbench.view.explorer');
    return true;
  }

  async onOpenTextDocumentCommand(params) {
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(params.path));
    const gotoPosition = new vscode.Position(
      (params.line || 1) - 1,
      (params.column || 1) - 1
    );
    editor.selection = new vscode.Selection(gotoPosition, gotoPosition);
    editor.revealRange(
      new vscode.Range(gotoPosition, gotoPosition),
      vscode.TextEditorRevealType.InCenter
    );
    return true;
  }

  onGetPIOProjectDirs() {
    return ProjectObservable.getPIOProjectDirs();
  }

  onPanelDisposed() {
    this._currentPanel = undefined;
  }

  disposePanel() {
    if (!this._currentPanel) {
      return;
    }
    this._currentPanel.dispose();
    this._currentPanel = undefined;
  }

  dispose() {
    this.disposePanel();
    pioNodeHelpers.misc.disposeSubscriptions(this.subscriptions);
    pioNodeHelpers.home.shutdownServer();
  }
}
