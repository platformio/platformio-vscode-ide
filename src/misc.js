/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { CONFLICTED_EXTENSION_IDS } from './constants';
import vscode from 'vscode';


export async function maybeRateExtension(globalState) {
  const momentoKey = 'rate-extension-state';
  const askAfterSessionNums = 13;
  let state = globalState.get(momentoKey);
  if (state && state.done) {
    return;
  }
  else if (!state || !state.callCounter) {
    state = {
      callCounter: 0,
      done: false
    };
  }

  state.callCounter += 1;
  if (state.callCounter < askAfterSessionNums) {
    globalState.update(momentoKey, state);
    return;
  }

  const selectedItem = await vscode.window.showInformationMessage(
    'If you enjoy using PlatformIO IDE for VSCode, would you mind taking a moment to rate it? ' +
    'It will not take more than one minute. Thanks for your support!',
    { title: 'Rate PlatformIO IDE Extension', isCloseAffordance: false },
    { title: 'Remind me later', isCloseAffordance: false },
    { title: 'No, Thanks', isCloseAffordance: true }
  );

  switch (selectedItem ? selectedItem.title : undefined) {
    case 'Rate PlatformIO IDE Extension':
      vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('http://bit.ly/pio-vscode-rate'));
      state.done = true;
      break;
    case 'No, Thanks':
      state.done = true;
      break;
    default:
      state.callCounter = 0;
  }
  globalState.update(momentoKey, state);
}

export async function warnAboutConflictedExtensions() {
  const conflicted = vscode.extensions.all
    .filter(ext => ext.isActive && CONFLICTED_EXTENSION_IDS.includes(ext.id))
    .map(ext => ext.packageJSON.displayName || ext.id);
  if (conflicted.length === 0) {
    return;
  }
  const selectedItem = await vscode.window.showWarningMessage(
    `Conflicted extensions with IntelliSense service were detected (${conflicted.join(', ')}). ` +
    'Code-completion, linting and navigation will not work properly. ' +
    'Please disable or uninstall them.',
    { title: 'Show extensions', isCloseAffordance: false },
    { title: 'More details', isCloseAffordance: false },
    { title: 'Remind me later', isCloseAffordance: true }
  );  
  switch (selectedItem ? selectedItem.title : undefined) {
    case 'More details':
      vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('http://bit.ly/pio-vscode-conflicted-extensions'));
      break;
    case 'Show extensions':
      vscode.commands.executeCommand('workbench.extensions.action.showEnabledExtensions');
      break;
  }  
}