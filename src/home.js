/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import { extension } from './main';
import vscode from 'vscode';


export class HomeContentProvider {

  static shutdownServer() {
    pioNodeHelpers.home.shutdownServer();
  }

  async provideTextDocumentContent(uri) {
    const params = await pioNodeHelpers.home.ensureServerStarted({
      onIDECommand: (command, params) => {
        if (command === 'open_project') {
          vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(params));
        }
      }
    });
    const start = `/${ uri.authority }`;
    const workbench = vscode.workspace.getConfiguration('workbench') || {};
    const theme = (workbench.colorTheme || '').toLowerCase().includes('light') ? 'light' : 'dark';
    return `
      <html>
      <body style="margin: 0; padding: 0; height: 100%; overflow: hidden; background-color: ${theme === 'light' ? '#FFF' : '#1E1E1E' }">
        <iframe src="${ pioNodeHelpers.home.getFrontendUri(params.host, params.port, {
        start,
        theme,
        workspace: extension.getEnterpriseSetting('defaultPIOHomeWorkspace')
      }) }"
          width="100%"
          height="100%"
          frameborder="0"
          style="border: 0; left: 0; right: 0; bottom: 0; top: 0; position:absolute;" />
      </body>
      </html>
    `;
  }

}
