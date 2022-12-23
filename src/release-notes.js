/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { disposeSubscriptions } from './utils';
import { extension } from './main';
import { promises as fs } from 'fs';
import path from 'path';
import vscode from 'vscode';

export default class PIOReleaseNotes {
  constructor() {
    this.version = extension.context.extension.packageJSON.version;
    this._currentPanel = undefined;

    this.subscriptions = [
      vscode.commands.registerCommand('platformio-ide.showReleaseNotes', () =>
        this.toggle()
      ),
    ];

    const stateKey = 'showedReleaseNotesFor';
    if (extension.context.globalState.get(stateKey) !== this.version) {
      extension.context.globalState.update(stateKey, this.version);
      this.toggle();
    }
  }

  dispose() {
    disposeSubscriptions(this.subscriptions);
  }

  async toggle() {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
    try {
      if (this._currentPanel) {
        this._currentPanel.webview.html = await this.getWebviewContent();
        return this._currentPanel.reveal(column);
      }
    } catch (err) {
      console.warn(err);
    }
    this._currentPanel = await this.newPanel();
  }

  async newPanel(startUrl) {
    const panel = vscode.window.createWebviewPanel(
      'pioReleaseNotes',
      'PlatformIO IDE: Release Notes',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );
    panel.onDidDispose(
      () => (this._currentPanel = undefined),
      undefined,
      this.subscriptions
    );
    panel.webview.html = await this.getWebviewContent(startUrl);
    return panel;
  }

  async getWebviewContent() {
    const releaseNotes = await this.readReleaseNotes();
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PlatformIO IDE: Release Notes</title>
</head>
<body>
  <div id="content">Loading...</div>
  <textarea id="pioRNMarkdown" hidden="hidden">
# PlatformIO IDE Release Notes

Welcome to the ${this.version} release of PlatformIO IDE.
There are many updates in this version that we hope you'll like.

**PlatformIO Core**: If you would like to read the PlatformIO Core release notes, go to the [Release Notes](https://docs.platformio.org/en/latest/core/history.html) on [docs.platformio.org](https://docs.platformio.org/).

${releaseNotes}

## Stay in touch with us

Please follow us on [LinkedIn](https://www.linkedin.com/company/platformio) and Twitter [@PlatformIO_Org](https://twitter.com/PlatformIO_Org) to keep up to date with the latest news, articles and tips!

-----

**Release History**: Want to read release notes for the previous versions? Please visit [PlatformIO IDE Changelog](https://github.com/platformio/platformio-vscode-ide/blob/develop/CHANGELOG.md) for more detailed information.

  </textarea>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    document.getElementById('content').innerHTML =
      marked.parse(document.getElementById('pioRNMarkdown').value);
  </script>
</body>
</html>`;
  }

  async readReleaseNotes() {
    const changelogPath = path.join(extension.context.extensionPath, 'CHANGELOG.md');
    try {
      const contents = await fs.readFile(changelogPath, { encoding: 'utf-8' });
      const startsAt = contents.indexOf('\n## ');
      return contents.substring(startsAt, contents.indexOf('\n## ', startsAt + 3));
    } catch (err) {
      return err.toString();
    }
  }
}
