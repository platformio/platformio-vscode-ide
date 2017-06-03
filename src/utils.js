/**
 * Copyright 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as constants from './constants';

import fs from 'fs-plus';
import path from 'path';
import spawn from 'cross-spawn';
import vscode from 'vscode';


export function runCommand(cmd, args, callback, options = {}) {
  console.info('runCommand', cmd, args, options);
  let completed = false;
  const outputLines = [];
  const errorLines = [];

  try {
    const child = spawn(cmd, args, options.spawnOptions);

    child.stdout.on('data', (line) => outputLines.push(line));
    child.stderr.on('data', (line) => errorLines.push(line));
    child.on('close', onExit);
    child.on('error', (err) => {
      errorLines.push(err.toString());
      onExit(-1);
    }
    );
  } catch (error) {
    errorLines.push(error.toString());
    onExit(-1);
  }

  function onExit(code) {
    if (completed) {
      return;
    }
    completed = true;
    const stdout = outputLines.map(x => x.toString()).join('');
    const stderr = errorLines.map(x => x.toString()).join('');
    callback(code, stdout, stderr);
  }
}

export function runPIOCommand(args, callback, options = {}) {
  runCommand(
    'platformio',
    [...constants.DEFAULT_PIO_ARGS, ...args],
    callback,
    options
  );
}

export function getIDEManifest() {
  return vscode.extensions.getExtension('platformio.platformio-ide').packageJSON;
}

export function getIDEVersion() {
  return getIDEManifest().version;
}

export function getCoreVersion() {
  return new Promise((resolve, reject) => {
    runCommand(
      'platformio',
      ['--version'],
      (code, stdout, stderr) => {
        if (code === 0) {
          return resolve(stdout.trim().match(/[\d+\.]+.*$/)[0]);
        }
        return reject(stderr);
      },
      {
        cacheValid: '10s'
      }
    );
  });
}

/* Custom */

export function isPIOProject(dir) {
  return fs.isFileSync(path.join(dir, 'platformio.ini'));
}

export function makeCommandWithArgs(command, ...args) {
  return () => vscode.commands.executeCommand(command, ...args);
}

export function makeStatusBarItem(text, tooltip, command, priority) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
  item.text = text;
  item.tooltip = tooltip;
  item.command = command;
  item.show();
  return item;
}
