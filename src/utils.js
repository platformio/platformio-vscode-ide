/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import fs from 'fs-plus';
import path from 'path';
import qs from 'querystringify';
import vscode from 'vscode';


export async function notifyError(title, err) {
  const description = err.stack || err.toString();
  const action = 'Report a problem';
  const selected = await vscode.window.showErrorMessage(description, action);
  if (selected === action) {
    const ghbody = `# Description of problem
Leave a comment...

# Configuration

VSCode: ${vscode.version}
PIO IDE: v${getIDEVersion()}
System: ${process.platform}_${process.arch}

# Exception
\`\`\`
${description}
\`\`\`
`;
    vscode.commands.executeCommand(
      'vscode.open',
      vscode.Uri.parse(`https://github.com/platformio/platformio-vscode-ide/issues/new?${qs.stringify(
        { title: encodeURIComponent(title), body: encodeURIComponent(ghbody) })}`)
    );
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
