/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'pioarduino-node-helpers';
import * as projectHelpers from './helpers';
import {
  disposeClangdCcWatcher,
  disposeIdfCcWatcher,
  ensureClangdArgs,
  ensureClangdConfig,
  ensureCompileCommands,
  ensureLaunchJson,
  fixupCompileCommands,
  getActiveBackend,
  invalidateIdfCache,
  isIdfProject,
  notifyRescanBackend,
  watchClangdCompileCommands,
  watchIdfCompileCommands,
} from '../intellisense';
import { disposeSubscriptions, notifyError } from '../utils';
import { ProjectConfigLanguageProvider } from './config';
import ProjectTaskManager from './tasks';
import ProjectTestManager from './tests';
import { STATUS_BAR_PRIORITY_START } from '../constants';
import { extension } from '../main';
import path from 'path';
import vscode from 'vscode';

export default class ProjectManager {
  CONFIG_CHANGED_DELAY = 3; // seconds

  constructor() {
    this._taskManager = undefined;
    this._sbEnvSwitcher = undefined;
    this._logOutputChannel = vscode.window.createOutputChannel(
      'pioarduino: Project Configuration',
    );
    this._configProvider = new ProjectConfigLanguageProvider();
    this._configChangedTimeout = undefined;
    this._activeProjectIsIdf = false; // sync flag updated on project switch
    const self = this;
    const activeBackend = getActiveBackend();

    const idfAwareBackend = {
      ...activeBackend,
      rebuildArgs(env) {
        if (activeBackend.id === 'clangd' && self._activeProjectIsIdf) {
          // Run a no-op PIO command for IDF — prevents compiledb while still
          // triggering onDidRebuildIndex → fixupCompileCommands for the clangd cache.
          return ['--version'];
        }
        return activeBackend.rebuildArgs(env);
      },
    };
    this._pool = new pioNodeHelpers.project.ProjectPool({
      ide: activeBackend.indexerIde,
      intelliSenseBackend: idfAwareBackend, // ← use wrapped backend
      api: {
        logOutputChannel: this._logOutputChannel,
        createFileSystemWatcher: vscode.workspace.createFileSystemWatcher,
        createDirSystemWatcher: (dir) =>
          vscode.workspace.createFileSystemWatcher(path.join(dir, '*')),
        withIndexRebuildingProgress: (task) =>
          vscode.window.withProgress(
            {
              location: { viewId: vscode.ProgressLocation.Notification },
              title: 'pioarduino: Configuring project',
              cancellable: true,
            },
            async (progress, token) =>
              await task(
                (message, increment = undefined) =>
                  progress.report({
                    message,
                    increment: increment,
                  }),
                token,
              ),
          ),
        withTasksLoadingProgress: (task) =>
          vscode.window.withProgress(
            {
              location: { viewId: ProjectTaskManager.TASKS_VIEW_ID },
            },
            async () =>
              await vscode.window.withProgress(
                {
                  location: { viewId: vscode.ProgressLocation.Window },
                  title: 'pioarduino: Loading tasks...',
                },
                task,
              ),
          ),
        onDidChangeProjectConfig: (configPath) => {
          const projectDir = path.dirname(configPath);
          if (this._configChangedTimeout) {
            clearTimeout(this._configChangedTimeout);
            this._configChangedTimeout = undefined;
          }
          this._configChangedTimeout = setTimeout(
            () =>
              this.switchToProject(projectDir, {
                force: true,
              }),
            ProjectManager.CONFIG_CHANGED_DELAY * 1000,
          );
        },
        onDidNotifyError: notifyError.bind(this),
        onDidRebuildIndex: async (projectDir) => {
          const obs = this._pool.getObserver(projectDir);
          const env = obs ? await obs.revealActiveEnvironment() : undefined;
          const envDir = env ? path.join(projectDir, '.pio', 'build', env) : undefined;

          const isIdf = await isIdfProject(obs, envDir);
          await fixupCompileCommands(projectDir, envDir, {
            allowRootFallback: !isIdf,
          });
          await ensureClangdConfig(projectDir, obs);
          await ensureClangdArgs(projectDir);
          await ensureLaunchJson(projectDir, env);
          await notifyRescanBackend();
        },
      },
      settings: {
        autoPreloadEnvTasks: extension.getConfiguration('autoPreloadEnvTasks'),
        autoRebuild: extension.getConfiguration('autoRebuildAutocompleteIndex'),
      },
    });

    this.subscriptions = [
      this._pool,
      this._logOutputChannel,
      this._configProvider,
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (!extension.getConfiguration('activateProjectOnTextEditorChange')) {
          return;
        }
        const projectDir = projectHelpers.getActiveEditorProjectDir();
        if (projectDir) {
          this.switchToProject(projectDir);
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() =>
        this.switchToProject(this.findActiveProjectDir()),
      ),
      vscode.commands.registerCommand('platformio-ide.rebuildProjectIndex', () =>
        this._pool.getActiveObserver().rebuildIndex({ force: true }),
      ),
      vscode.commands.registerCommand('platformio-ide.refreshProjectTasks', () =>
        this._taskManager.refresh({ force: true }),
      ),
      vscode.commands.registerCommand('platformio-ide.toggleMultiEnvProjectTasks', () =>
        this._taskManager.toggleMultiEnvExplorer(),
      ),
      vscode.commands.registerCommand('platformio-ide._runProjectTask', (task) =>
        this._taskManager.runTask(task),
      ),
      vscode.commands.registerCommand(
        'platformio-ide.activeEnvironment',
        async () => await this._pool.getActiveObserver().revealActiveEnvironment(),
      ),
    ];
    this.internalSubscriptions = [];

    this.registerEnvSwitcher();
    // switch to the first project in a workspace on start-up
    this.switchToProject(this.findActiveProjectDir(), { force: true });
  }

  dispose() {
    this.disposeInternals();
    disposeSubscriptions(this.internalSubscriptions);
    disposeSubscriptions(this.subscriptions);
  }

  findActiveProjectDir() {
    let projectDir = undefined;
    if (extension.getConfiguration('activateProjectOnTextEditorChange')) {
      projectDir = projectHelpers.getActiveEditorProjectDir();
    }
    return projectDir || this.getSelectedProjectDir();
  }

  getSelectedProjectDir() {
    const pioProjectDirs = projectHelpers.getPIOProjectDirs();
    const currentActiveDir = this._pool.getActiveProjectDir();
    if (pioProjectDirs.length < 1) {
      return undefined;
    }
    if (
      currentActiveDir &&
      pioProjectDirs.find((projectDir) => projectDir === currentActiveDir)
    ) {
      return currentActiveDir;
    }
    const lastActiveDir = projectHelpers.getLastProjectDir();
    if (
      lastActiveDir &&
      pioProjectDirs.find((projectDir) => projectDir === lastActiveDir)
    ) {
      return lastActiveDir;
    }
    return pioProjectDirs[0];
  }

  saveActiveProjectState() {
    const observer = this._pool.getActiveObserver();
    if (!observer) {
      return;
    }
    projectHelpers.updateProjectItemState(
      observer.projectDir,
      'selectedEnv',
      observer.getSelectedEnv(),
    );
  }

  async switchToProject(projectDir, options = {}) {
    if (!projectDir) {
      console.error('switchProject => Please provide project folder');
      return;
    }
    this._sbEnvSwitcher.text = '$(root-folder) Loading...';

    let currentProjectDir = undefined;
    let currentEnv = undefined;
    if (this._pool.getActiveObserver()) {
      currentProjectDir = this._pool.getActiveObserver().projectDir;
      currentEnv = this._pool.getActiveObserver().getSelectedEnv();
    }
    const observer = this._pool.getObserver(projectDir);

    // validate configuration file
    const configUri = vscode.Uri.file(path.join(projectDir, 'platformio.ini'));
    try {
      const isConfigValid = await this._configProvider.lintConfig(configUri);
      if (!isConfigValid) {
        vscode.window.showErrorMessage(
          'The project configuration process has encountered an error due to ' +
            "a problem with the 'platformio.ini' file. " +
            'Please review the file and fix the issues.',
        );
        vscode.window.showTextDocument(configUri);
        return;
      }
    } catch (err) {
      console.error(err);
    }

    if ('env' in options) {
      await observer.switchProjectEnv(options.env);
    } else if (!observer.getSelectedEnv()) {
      await observer.switchProjectEnv(
        projectHelpers.getProjectItemState(projectDir, 'selectedEnv'),
      );
    }

    // ignore active project and & env
    if (
      options.force ||
      !currentProjectDir ||
      currentProjectDir !== projectDir ||
      currentEnv !== observer.getSelectedEnv()
    ) {
      disposeSubscriptions(this.internalSubscriptions);
      if (currentProjectDir && currentProjectDir !== projectDir) {
        invalidateIdfCache(currentProjectDir);
        disposeIdfCcWatcher(currentProjectDir);
        disposeClangdCcWatcher(currentProjectDir);
      }
      const selectedEnv = await observer.revealActiveEnvironment();
      const selectedEnvDir = selectedEnv
        ? path.join(projectDir, '.pio', 'build', selectedEnv)
        : undefined;
      this._activeProjectIsIdf = await isIdfProject(observer, selectedEnvDir);

      // For IDF projects, watch the CMake-generated compile_commands.json so
      // fixupCompileCommands is triggered automatically when the build completes.
      if (this._activeProjectIsIdf && selectedEnvDir) {
        watchIdfCompileCommands(projectDir, selectedEnvDir, async () => {
          try {
            await fixupCompileCommands(projectDir, selectedEnvDir, {
              allowRootFallback: false,
            });
            await ensureClangdArgs(projectDir);
            await notifyRescanBackend();
          } catch (err) {
            notifyError('IDF compile_commands.json processing failed', err);
          }
        });
      } else {
        disposeIdfCcWatcher(projectDir);
      }

      // Watch the processed clangd compile_commands.json so that an external
      // delete (e.g. user wiping .cache/clangd) triggers a rebuild rather than
      // leaving clangd without a database.
      watchClangdCompileCommands(projectDir, async () => {
        const obs = this._pool.getObserver(projectDir);
        const env = obs ? await obs.revealActiveEnvironment() : undefined;
        const envDir = env ? path.join(projectDir, '.pio', 'build', env) : undefined;
        await ensureCompileCommands(projectDir, obs, envDir);
        await ensureClangdArgs(projectDir);
        await notifyRescanBackend();
      });

      await this._pool.switch(projectDir);
      const activeObs = this._pool.getActiveObserver();
      const activeEnv = activeObs
        ? await activeObs.revealActiveEnvironment()
        : undefined;
      const envDir = activeEnv
        ? path.join(projectDir, '.pio', 'build', activeEnv)
        : undefined;
      await ensureCompileCommands(projectDir, activeObs, envDir);
      await ensureClangdArgs(projectDir);
      this._taskManager = new ProjectTaskManager(projectDir, observer);
      this.internalSubscriptions.push(
        this._taskManager,
        new ProjectTestManager(projectDir),
      );

      // open "platformio.ini" if no visible editors
      if (
        vscode.window.visibleTextEditors.length === 0 &&
        extension.getConfiguration('autoOpenPlatformIOIniFile')
      ) {
        vscode.window.showTextDocument(
          vscode.Uri.file(path.join(projectDir, 'platformio.ini')),
        );
      }
    }

    this.showSelectedEnv();
    this.saveActiveProjectState();
  }

  registerEnvSwitcher() {
    this._sbEnvSwitcher = vscode.window.createStatusBarItem(
      'pio-env-switcher',
      vscode.StatusBarAlignment.Left,
      STATUS_BAR_PRIORITY_START,
    );
    this._sbEnvSwitcher.name = 'pioarduino: Project Environment Switcher';
    this._sbEnvSwitcher.tooltip = 'Switch pioarduino Project Environment';
    this._sbEnvSwitcher.command = 'platformio-ide.pickProjectEnv';
    this._sbEnvSwitcher.text = '$(root-folder) Loading...';
    this._sbEnvSwitcher.show();

    this.subscriptions.push(
      this._sbEnvSwitcher,
      vscode.commands.registerCommand('platformio-ide.pickProjectEnv', () =>
        this.pickProjectEnv(),
      ),
    );
  }

  showSelectedEnv() {
    const observer = this._pool.getActiveObserver();
    if (!observer) {
      return;
    }
    const env = observer.getSelectedEnv()
      ? `env:${observer.getSelectedEnv()}`
      : 'Default';
    this._sbEnvSwitcher.text = `$(root-folder) ${env} (${path.basename(
      observer.projectDir,
    )})`;
  }

  async pickProjectEnv() {
    const items = [];
    for (const projectDir of projectHelpers.getPIOProjectDirs()) {
      const observer = this._pool.getObserver(projectDir);
      const envs = (await observer.getConfig()).envs();
      if (!envs || !envs.length) {
        continue;
      }
      const shortProjectDir = `${path.basename(
        path.dirname(projectDir),
      )}/${path.basename(projectDir)}`;
      items.push({
        projectDir,
        label: 'Default',
        description: `$(folder) ${shortProjectDir} ("default_envs" from "platformio.ini")`,
      });
      items.push(
        ...envs.map((env) => ({
          projectDir,
          env,
          label: `env:${env}`,
          description: `$(folder) ${shortProjectDir}`,
        })),
      );
    }
    const pickedItem = await vscode.window.showQuickPick(items, {
      matchOnDescription: true,
    });
    if (!pickedItem) {
      return;
    }
    this.switchToProject(pickedItem.projectDir, { env: pickedItem.env, force: true });
  }
}
