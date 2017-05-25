/**
 * Copyright (c) 2016-present, PlatformIO Plus <contact@pioplus.com>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as utils from '../../utils';

import { ENV_BIN_DIR, ENV_DIR, IS_WINDOWS, PIO_CORE_MIN_VERSION, PIO_HOME_DIR } from '../../constants';
import { PEPverToSemver, download, extractTarGz } from '../helpers';

import BaseStage from './base';
import fs from 'fs-plus';
import path from 'path';
import semver from 'semver';
import tmp from 'tmp';

export default class PlatformIOCoreStage extends BaseStage {

  static UPGRADE_PIOCORE_TIMEOUT = 86400 * 3 * 1000; // 3 days

  static pythonVersion = '2.7.13';
  static vitrualenvUrl = 'https://pypi.python.org/packages/source/v/virtualenv/virtualenv-14.0.6.tar.gz';

  constructor() {
    super(...arguments);
    tmp.setGracefulCleanup();
  }

  get name() {
    return 'PlatformIO Core';
  }

  async check() {
    if (this.params.useBuiltinPIOCore) {
      if (!fs.isDirectorySync(ENV_BIN_DIR)) {
        throw new Error('Virtual environment is not created');
      }
      try {
        await this.autoUpgradePIOCore();
      } catch (err) {
        console.log(err);
      }
    }

    const customDirs = this.params.useBuiltinPIOCore ? [ENV_BIN_DIR] : null;
    const coreVersion = await utils.getCoreVersion(await utils.getPythonExecutable(customDirs));
    if (semver.lt(PEPverToSemver(coreVersion), PIO_CORE_MIN_VERSION)) {
      this.params.setUseBuiltinPIOCore(true);
      throw new Error(`Incompatible PIO Core ${coreVersion}`);
    }

    this.status = BaseStage.STATUS_SUCCESSED;
    console.log(`Found PIO Core ${coreVersion}`);
    return true;
  }

  async install() {
    if (this.status === BaseStage.STATUS_SUCCESSED) {
      return true;
    }
    if (!this.params.useBuiltinPIOCore) {
      this.status = BaseStage.STATUS_SUCCESSED;
      return true;
    }
    this.status = BaseStage.STATUS_INSTALLING;

    await this.cleanVirtualEnvDir();

    if (await this.isCondaInstalled()) {
      await this.createVirtualenvWithConda();
    } else {
      const pythonExecutable = await this.whereIsPython();
      if (!pythonExecutable) {
        this.status = BaseStage.STATUS_FAILED;
        throw new Error('Can not find Python Interpreter');
      }
      try {
        await this.createVirtualenvWithUser(pythonExecutable);
      } catch (err) {
        console.error(err);
        await this.createVirtualenvWithDownload(pythonExecutable);
      }
    }

    const envPythonExecutable = await utils.getPythonExecutable([ENV_BIN_DIR]);
    if (!envPythonExecutable) {
      throw new Error('Python interpreter not found');
    }

    await this.installPIOCore(envPythonExecutable);

    this.status = BaseStage.STATUS_SUCCESSED;
    return true;
  }

  async whereIsPython() {
    let status = this.params.installConfirm.TRY_AGAIN;
    do {
      const pythonExecutable = await utils.getPythonExecutable();
      if (pythonExecutable) {
        return pythonExecutable;
      }

      if (IS_WINDOWS) {
        try {
          return await this.installPythonForWindows();
        } catch (err) {
          console.error(err);
        }
      }

      status = await this.params.installConfirm.requestPythonInstall();

    } while (status !== this.params.installConfirm.ABORT);
    return null;
  }

  async installPythonForWindows() {
    // https://www.python.org/ftp/python/2.7.13/python-2.7.13.msi
    // https://www.python.org/ftp/python/2.7.13/python-2.7.13.amd64.msi
    const pythonArch = process.arch === 'x64' ? '.amd64' : '';
    const msiUrl = `https://www.python.org/ftp/python/${PlatformIOCoreStage.pythonVersion}/python-${PlatformIOCoreStage.pythonVersion}${pythonArch}.msi`;
    const msiInstaller = await download(
      msiUrl,
      path.join(this.params.cacheDir, path.basename(msiUrl))
    );
    const targetDir = path.join(PIO_HOME_DIR, 'python27');
    const pythonPath = path.join(targetDir, 'python.exe');

    if (!fs.isFileSync(pythonPath)) {
      try {
        await this.installPythonFromWindowsMSI(msiInstaller, targetDir);
      } catch (err) {
        console.error(err);
        await this.installPythonFromWindowsMSI(msiInstaller, targetDir, true);
      }
    }

    // append temporary to system environment
    process.env.PATH = [targetDir, path.join(targetDir, 'Scripts'), process.env.PATH].join(path.delimiter);
    process.env.Path = process.env.PATH;

    // install virtualenv
    return new Promise(resolve => {
      utils.spawnCommand(
        pythonPath,
        ['-m', 'pip', 'install', 'virtualenv'],
        () => resolve(pythonPath)
      );
    });
  }

  async installPythonFromWindowsMSI(msiInstaller, targetDir, administrative = false) {
    const logFile = path.join(this.params.cacheDir, 'python27msi.log');
    await new Promise((resolve, reject) => {
      utils.spawnCommand(
        'msiexec.exe',
        [administrative ? '/a' : '/i', msiInstaller, '/qn', '/li', logFile, `TARGETDIR=${targetDir}`],
        async (code, stdout, stderr) => {
          if (code === 0) {
            return resolve(stdout);
          } else {
            if (fs.isFileSync(logFile)) {
              stderr = fs.readFileSync(logFile).toString();
            }
            return reject(`MSI Python2.7: ${stderr}`);
          }
        },
        {
          spawnOptions: {
            shell: true,
          },
        }
      );
    });
    if (!fs.isFileSync(path.join(targetDir, 'python.exe'))) {
      throw new Error('Could not install Python 2.7 using MSI');
    }
  }

  async cleanVirtualEnvDir() {
    if (fs.isFileSync(ENV_DIR)) {
      try {
        fs.removeSync(ENV_DIR);
      } catch (err) {
        console.error(err);
      }
    }
  }

  isCondaInstalled() {
    return new Promise(resolve => {
      utils.spawnCommand('conda', ['--version'], code => resolve(code === 0));
    });
  }

  createVirtualenvWithConda() {
    return new Promise((resolve, reject) => {
      utils.spawnCommand(
        'conda',
        ['create', '--yes', '--quiet', 'python=2', '--prefix', ENV_DIR],
        (code, stdout, stderr) => {
          if (code === 0) {
            return resolve(stdout);
          } else {
            return reject(`Conda Virtualenv: ${stderr}`);
          }
        }
      );
    });
  }

  createVirtualenvWithUser(pythonExecutable) {
    return new Promise((resolve, reject) => {
      utils.spawnCommand(
        'virtualenv',
        ['-p', pythonExecutable, ENV_DIR],
        (code, stdout, stderr) => {
          if (code === 0) {
            return resolve(stdout);
          } else {
            return reject(`User's Virtualenv: ${stderr}`);
          }
        }
      );
    });
  }

  createVirtualenvWithDownload(pythonExecutable) {
    return new Promise((resolve, reject) => {
      download(
        PlatformIOCoreStage.vitrualenvUrl,
        path.join(this.params.cacheDir, 'virtualenv.tar.gz')
      ).then(archivePath => {
        const tmpDir = tmp.dirSync({
          unsafeCleanup: true,
        });
        extractTarGz(archivePath, tmpDir.name).then(dstDir => {
          const virtualenvScript = fs.listTreeSync(dstDir).find(
            item => path.basename(item) === 'virtualenv.py');
          if (!virtualenvScript) {
            return reject('Can not find virtualenv.py script');
          }
          utils.spawnCommand(
            pythonExecutable,
            [virtualenvScript, ENV_DIR],
            (code, stdout, stderr) => {
              if (code === 0) {
                return resolve(stdout);
              } else {
                return reject(`Virtualenv Download: ${stderr}`);
              }
            }
          );
        });
      }).catch(err => reject(`Virtualenv Download: ${err}`));
    });
  }

  async installPIOCore(pythonExecutable) {
    const cmd = pythonExecutable;
    const args = ['-m', 'pip', 'install', '--no-cache-dir', '-U'];
    if (this.params.useDevelopmentPIOCore) {
      args.push('https://github.com/platformio/platformio/archive/develop.zip');
    } else {
      args.push('platformio');
    }
    try {
      await new Promise((resolve, reject) => {
        utils.spawnCommand(cmd, args, (code, stdout, stderr) => {
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(`PIP: ${stderr}`);
          }
        });
      });
    } catch (err) {
      console.error(err);
      // Old versions of PIP don't support `--no-cache-dir` option
      return new Promise((resolve, reject) => {
        utils.spawnCommand(
          cmd,
          args.filter(arg => arg !== '--no-cache-dir'),
          (code, stdout, stderr) => {
            if (code === 0) {
              resolve(stdout);
            } else {
              reject(`PIP: ${stderr}`);
            }
          }
        );
      });
    }
  }

  initState() {
    let state = this.state;
    if (!state || !state.hasOwnProperty('pioCoreChecked') || !state.hasOwnProperty('lastIDEVersion')) {
      state = {
        pioCoreChecked: 0,
        lastIDEVersion: null,
      };
    }
    return state;
  }

  async autoUpgradePIOCore() {
    const newState = this.initState();
    const now = new Date().getTime();
    if ((now - PlatformIOCoreStage.UPGRADE_PIOCORE_TIMEOUT) > parseInt(newState.pioCoreChecked)) {
      newState.pioCoreChecked = now;
      // PIO Core
      await new Promise(resolve => {
        utils.runPioCommand(
          ['upgrade'],
          (code, stdout, stderr) => {
            if (code !== 0) {
              console.error(stdout, stderr);
            }
            resolve(true);
          },
          {
            busyTitle: 'Upgrading PIO Core',
          }
        );
      });
      // PIO Core Packages
      await new Promise(resolve => {
        utils.runPioCommand(
          ['update', '--core-packages'],
          (code, stdout, stderr) => {
            if (code !== 0) {
              console.error(stdout, stderr);
            }
            resolve(true);
          },
          {
            busyTitle: 'Updating PIO Core packages',
          }
        );
      });
    }
    this.state = newState;
  }

}
