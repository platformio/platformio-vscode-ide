/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import os from 'os';
import vscode from 'vscode';

export async function notifyError(title, err) {
  const description = err.stack || err.toString();
  const ghbody = `# Description of problem
  Leave a comment...

  BEFORE SUBMITTING, PLEASE SEARCH FOR DUPLICATES IN
  - https://github.com/platformio/platformio-vscode-ide/issues

  # Configuration

  VSCode: ${vscode.version}
  PIO IDE: v${getIDEVersion()}
  System: ${os.type()}, ${os.release()}, ${os.arch()}

  # Exception
  \`\`\`
  ${description}
  \`\`\`
  `;
  const reportUrl = pioNodeHelpers.misc.getErrorReportUrl(title, ghbody);

  let action = 'Report a problem';
  if (!reportUrl.includes('issues/new')) {
    action = 'Check available solutions';
  }

  const selected = await vscode.window.showErrorMessage(description, action);
  if (selected === action) {
    vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(reportUrl));
  }
  console.error(err);
}

export function getIDEManifest() {
  return vscode.extensions.getExtension('platformio.platformio-ide').packageJSON;
}

export function getIDEVersion() {
  return getIDEManifest().version;
}

export function getPIOProjectDirs() {
  return (vscode.workspace.workspaceFolders || [])
    .map(folder => folder.uri.fsPath)
    .filter(dir => pioNodeHelpers.misc.isPIOProject(dir));
}

let _lastActiveProjectDir = undefined;

export function getActivePIOProjectDir() {
  const pioProjectDirs = getPIOProjectDirs();
  if (pioProjectDirs.length < 1) {
    _lastActiveProjectDir = undefined;
    return _lastActiveProjectDir;
  }
  if (
    !_lastActiveProjectDir ||
    !vscode.workspace.workspaceFolders.find(
      folder => folder.uri.fsPath === _lastActiveProjectDir
    )
  ) {
    _lastActiveProjectDir = pioProjectDirs[0];
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return _lastActiveProjectDir;
  }
  const resource = editor.document.uri;
  if (resource.scheme !== 'file') {
    return _lastActiveProjectDir;
  }
  const folder = vscode.workspace.getWorkspaceFolder(resource);
  if (!folder || !pioNodeHelpers.misc.isPIOProject(folder.uri.fsPath)) {
    // outside workspace
    return _lastActiveProjectDir;
  }
  _lastActiveProjectDir = folder.uri.fsPath;
  return _lastActiveProjectDir;
}
