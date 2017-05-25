/**
 * Copyright (c) 2016-present, PlatformIO Plus <contact@pioplus.com>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { runPioCommand } from '../utils';
import vscode from 'vscode';

export default async function initCommand() {
  if (!vscode.workspace.rootPath) {
    vscode.window.showWarningMessage(
      'PlatformIO projec could not be initialized. Please open a folder '
      + 'first before performing initialization.'
    );
  }
  await vscode.window.withProgress({
    title: 'PlatformIO Project initialization',
    location: vscode.ProgressLocation.Window,
  }, async (progress) => {
    progress.report({
      message: 'Updating a list of avaialbe boards',
    });

    try {
      const data = JSON.parse(await new Promise((resolve, reject) => {
        runPioCommand(['boards', '--json-output'], (code, stdout, stderr) => {
          if (code !== 0) {
            reject(stderr);
          } else {
            resolve(stdout);
          }
        });
      }));
      const items = data.map((board) => ({
        label: board.name,
        description: board.vendor,
        detail: board.mcu,
        boardId: board.id,
      }));

      progress.report({
        message: 'Selecting a board',
      });
      const selectedBoard = await vscode.window.showQuickPick(items, {
        ignoreFocusOut: true,
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: 'Select a board',
      });

      if (selectedBoard) {
        progress.report({
          message: 'Performing initialization',
        });

        await new Promise((resolve, reject) => {
          runPioCommand(['init', '--board', selectedBoard.boardId, '--project-dir', vscode.workspace.rootPath], (code, stdout, stderr) => {
            if (code !== 0) {
              reject(stderr);
            } else {
              resolve(stdout);
            }
          });
        });
      }
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage(error);
    }
  });
}
