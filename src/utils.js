/**
 * Copyright (c) 2016-present, PlatformIO Plus <contact@pioplus.com>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { DEFAULT_PIO_ARGS, ENV_BIN_DIR, IS_WINDOWS } from './constants';

import fs from 'fs-plus';
import path from 'path';
import spawn from 'cross-spawn';
import vscode from 'vscode';

export function getCurrentPythonExecutable() {
  const useBuiltinPIOCore = vscode.workspace.getConfiguration('platformio-ide').get('useBuiltinPIOCore');
  const customDirs = useBuiltinPIOCore ? [ENV_BIN_DIR] : null;
  return getPythonExecutable(customDirs);
}

export async function runPioCommand(args, callback, options = {}) {
  spawnCommand(
    await getCurrentPythonExecutable(),
    ['-m', 'platformio', ...DEFAULT_PIO_ARGS, ...args],
    callback,
    options
  );
}

export function isPioProject(dir) {
  return fs.isFileSync(path.join(dir, 'platformio.ini'));
}

export async function ensureDirExists(dirPath) {
  if (!fs.isDirectorySync(dirPath)) {
    fs.makeTreeSync(dirPath);
  }
}

export function getCoreVersion(pythonExecutable) {
  return new Promise((resolve, reject) => {
    spawnCommand(
      pythonExecutable,
      ['-m', 'platformio', '--version'],
      (code, stdout, stderr) => {
        if (code === 0) {
          return resolve(stdout.trim().match(/[\d+\.]+.*$/)[0]);
        }
        return reject(stderr);
      },
      {
        cacheValid: '10s',
      }
    );
  });
}

export function spawnCommand(cmd, args, callback, options = {}) {
  console.log('spawnCommand', cmd, args, options);
  const completed = false;
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

    const stdout = outputLines.map(x => x.toString()).join('');
    const stderr = errorLines.map(x => x.toString()).join('');

    callback(code, stdout, stderr);
  }
}

export async function getPythonExecutable(customDirs = null) {
  const candidates = [];
  const defaultName = IS_WINDOWS ? 'python.exe' : 'python';

  if (customDirs) {
    customDirs.forEach(dir => candidates.push(path.join(dir, defaultName)));
  }

  if (IS_WINDOWS) {
    candidates.push(defaultName);
    candidates.push('C:\\Python27\\' + defaultName);
  } else {
    candidates.push('python2.7');
    candidates.push(defaultName);
  }

  for (const item of process.env.PATH.split(path.delimiter)) {
    if (fs.isFileSync(path.join(item, defaultName))) {
      candidates.push(path.join(item, defaultName));
    }
  }

  for (const executable of candidates) {
    if ( (await isPython2(executable)) ) {
      return executable;
    }
  }

  return null;
}

function isPython2(executable) {
  const args = ['-c', 'import sys; print \'.\'.join(str(v) for v in sys.version_info[:2])'];
  return new Promise(resolve => {
    spawnCommand(
      executable,
      args,
      (code, stdout) => {
        resolve(code === 0 && stdout.startsWith('2.7'));
      }
    );
  });
}
