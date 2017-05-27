/**
 * Copyright 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import open from 'open';
import vscode from 'vscode';

export default class VscodePythonInstallConfirm {

  TRY_AGAIN = 0;
  ABORT = 1;

  async requestPythonInstall() {
    const selectedItem = await vscode.window.showInformationMessage(
      'PlatformIO: Can not find Python 2.7 Interpreter',
      { title: 'Install Python 2.7', isCloseAffordance: true },
      { title: 'I have Python 2.7', isCloseAffordance: true },
      { title: 'Try again', isCloseAffordance: true },
      { title: 'Abort PlatformIO IDE Installation', isCloseAffordance: true }
    );

    switch (selectedItem.title) {
      case 'Install Python 2.7':
        open('http://docs.platformio.org/page/faq.html#install-python-interpreter');
        return this.TRY_AGAIN;
      case 'Abort PlatformIO IDE Installation':
        return this.ABORT;
      default:
        return this.TRY_AGAIN;
    }
  }
}
