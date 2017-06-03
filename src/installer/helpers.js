/**
 * Copyright 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as constants from '../constants';
import * as utils from '../utils';

import fs from 'fs-plus';
import path from 'path';
import request from 'request';
import tar from 'tar';
import vscode from 'vscode';
import zlib from 'zlib';


export function getCacheDir() {
  if (!fs.isDirectorySync(constants.CACHE_DIR)) {
    fs.makeTreeSync(constants.CACHE_DIR);
  }
  return constants.CACHE_DIR;
}

export async function download(source, target, retries = 3) {
  const contentLength = await getContentLength(source);

  if (fileExistsAndSizeMatches(target, contentLength)) {
    return target;
  }

  let lastError = '';
  while (retries >= 0) {
    try {
      await _download(source, target);
      if (fileExistsAndSizeMatches(target, contentLength)) {
        return target;
      }
    } catch (error) {
      lastError = error;
      console.error(error);
    }
    retries--;
  }

  throw new Error(`Failed to download file ${source}: ${lastError}`);
}

function fileExistsAndSizeMatches(target, contentLength) {
  if (fs.isFileSync(target)) {
    if (contentLength > 0 && contentLength == fs.getSizeSync(target)) {
      return true;
    }
    try {
      fs.removeSync(target);
    } catch (err) {
      console.error(err);
    }
  }
  return false;
}

async function _download(source, target) {
  return new Promise((resolve, reject) => {
    const proxy = (process.env.HTTPS_PROXY && process.env.HTTPS_PROXY.trim()
      || process.env.HTTP_PROXY && process.env.HTTP_PROXY.trim());
    const file = fs.createWriteStream(target);
    const options = {
      url: source,
    };
    if (proxy) {
      options.proxy = proxy;
    }
    request.get(options)
      .on('error', err => reject(err))
      .pipe(file);
    file.on('error', err => reject(err));
    file.on('finish', () => resolve(target));
  });
}

function getContentLength(url) {
  return new Promise(resolve => {
    request.head({
      url
    }, (err, response) => {
      if (err || response.statusCode !== 200 || !response.headers.hasOwnProperty('content-length')) {
        resolve(-1);
      }
      resolve(parseInt(response.headers['content-length']));
    });
  });
}

export function extractTarGz(source, destination) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(source)
      .pipe(zlib.createGunzip())
      .on('error', err => reject(err))
      .pipe(tar.extract({
        cwd: destination
      }))
      .on('error', err => reject(err))
      .on('end', () => resolve(destination));
  });
}

export async function getPythonExecutable(customDirs = null) {
  const candidates = new Set();
  const defaultName = constants.IS_WINDOWS ? 'python.exe' : 'python';

  if (customDirs) {
    customDirs.forEach(dir => candidates.add(path.join(dir, defaultName)));
  }

  if (vscode.workspace.getConfiguration('platformio-ide').get('useBuiltinPIOCore')) {
    candidates.add(path.join(constants.ENV_BIN_DIR, defaultName));
  }

  if (constants.IS_WINDOWS) {
    candidates.add(defaultName);
    candidates.add('C:\\Python27\\' + defaultName);
  } else {
    candidates.add('python2.7');
    candidates.add(defaultName);
  }

  for (const item of process.env.PATH.split(path.delimiter)) {
    if (fs.isFileSync(path.join(item, defaultName))) {
      candidates.add(path.join(item, defaultName));
    }
  }

  for (const executable of candidates.values()) {
    if (await isPython2(executable)) {
      return executable;
    }
  }

  return null;
}

function isPython2(executable) {
  const args = ['-c', 'import sys; assert "msys" not in sys.executable.lower(); print ".".join(str(v) for v in sys.version_info[:2])'];
  return new Promise(resolve => {
    utils.runCommand(
      executable,
      args,
      (code, stdout) => {
        resolve(code === 0 && stdout.startsWith('2.7'));
      }
    );
  });
}

export function PEPverToSemver(pepver) {
  return pepver.replace(/(\.\d+)\.?(dev|a|b|rc|post)/, '$1-$2.');
}
