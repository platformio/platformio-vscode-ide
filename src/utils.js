/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import fs from 'fs-plus';
import path from 'path';
import vscode from 'vscode';


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
