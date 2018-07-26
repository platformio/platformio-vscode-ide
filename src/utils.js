/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import fs from 'fs-plus';
import os from 'os';
import path from 'path';
import vscode from 'vscode';


export async function notifyError(title, err) {
  const description = err.stack || err.toString();
  const action = 'Report a problem';
  const selected = await vscode.window.showErrorMessage(description, action);
  if (selected === action) {
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
    vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(pioNodeHelpers.misc.getErrorReportUrl(title, ghbody)));
  }
  console.error(err);
}

export function getIDEManifest() {
  return vscode.extensions.getExtension('platformio.platformio-ide').packageJSON;
}

export function getIDEVersion() {
  return getIDEManifest().version;
}

/* Custom */

export function isPIOProject(dir) {
  return fs.isFileSync(path.join(dir, 'platformio.ini'));
}
