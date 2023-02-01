/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';
import { disposeSubscriptions } from '../utils';
import { promises as fs } from 'fs';
import path from 'path';
import vscode from 'vscode';

export default class ProjectTestManager {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.controller = vscode.tests.createTestController(
      'platformio-tests',
      'PlatformIO Tests'
    );
    this.subscriptions = [this.controller];

    this.controller.refreshHandler = this.refreshHandler.bind(this);
    this.controller.resolveHandler = this.resolveHandler.bind(this);
    this.controller.createRunProfile(
      'Run Tests',
      vscode.TestRunProfileKind.Run,
      this.runHandler.bind(this),
      true
    );
  }

  dispose() {
    disposeSubscriptions(this.subscriptions);
  }

  async runCoreTestCommand(args) {
    const jsonOutputPath = path.join(
      pioNodeHelpers.core.getTmpDir(),
      `test-list-${Math.round(Math.random() * 100000)}.json`
    );
    let output = undefined;
    let error = new Error();
    try {
      const envClone = Object.assign({}, process.env);
      envClone['PLATFORMIO_FORCE_ANSI'] = 'true';
      output = await pioNodeHelpers.core.getPIOCommandOutput(
        ['test', ...args, '--json-output-path', jsonOutputPath],
        {
          projectDir: this.projectDir,
          runInQueue: true,
          spawnOptions: {
            env: envClone,
          },
        }
      );
    } catch (err) {
      error = err;
    }
    try {
      await fs.access(jsonOutputPath);
    } catch (err) {
      throw error;
    }

    const data = await pioNodeHelpers.misc.loadJSON(jsonOutputPath);
    await fs.unlink(jsonOutputPath); // cleanup
    return [data, output || error.toString()];
  }

  async refreshHandler() {
    this.controller.items.replace([]); // clear
    await this.resolveTestSuites();
  }

  async resolveHandler(test) {
    if (test) {
      console.warn('Not Implemented');
      return;
    }
    await this.resolveTestSuites();
  }

  async resolveTestSuites() {
    try {
      const [data] = await this.runCoreTestCommand(['--list-tests']);
      const envToSuites = data.test_suites.reduce(
        (result, item) =>
          result.set(item.env_name, [...(result.get(item.env_name) || []), item]),
        new Map()
      );
      envToSuites.forEach((suites, envName) => {
        const envSuite = this.controller.createTestItem(`env:${envName}`, envName);
        envSuite.children.replace(
          suites.map((suite) =>
            this.controller.createTestItem(
              `suite:${envName}/${suite.test_name}`,
              suite.test_name,
              suite.test_dir ? vscode.Uri.file(suite.test_dir) : undefined
            )
          )
        );
        this.controller.items.add(envSuite);
      });
    } catch (err) {
      console.error(err);
      const item = this.controller.createTestItem(
        'error',
        'Error (expand for details)'
      );
      item.error = err.toString();
      this.controller.items.add(item);
    }
  }

  extractTestSuites(test) {
    if (test.id.startsWith('suite:')) {
      return [test];
    } else if (test.id.startsWith('case:')) {
      return [test.parent];
    } else if (test.id.startsWith('env:')) {
      return test.children;
    }
    return [];
  }

  async runHandler(request, token) {
    const run = this.controller.createTestRun(request);
    const queue = [];
    const exclude = [];

    if (request.include) {
      request.include.forEach((test) =>
        this.extractTestSuites(test).forEach((suite) =>
          queue.includes(suite) ? undefined : queue.push(suite)
        )
      );
    } else {
      this.controller.items.forEach((item) =>
        item.children.forEach((suite) => queue.push(suite))
      );
    }
    if (request.exclude) {
      request.exclude.forEach((test) =>
        this.extractTestSuites(test).forEach((suite) => exclude.push(suite))
      );
    }

    while (queue.length > 0 && !token.isCancellationRequested) {
      const suite = queue.pop();
      if (exclude.includes(suite)) {
        run.skipped(suite);
        continue;
      }
      await this._runTestSuite(run, suite);
    }
    run.end();
  }

  async _runTestSuite(run, suite) {
    const envName = suite.parent.label;
    const testName = suite.label;
    const startedAt = Date.now();
    run.started(suite);
    try {
      const [data, output] = await this.runCoreTestCommand([
        '--environment',
        envName,
        '--filter',
        testName,
      ]);
      process.chdir(data.project_dir);
      const result = data.test_suites.find(
        (item) => item.env_name === envName && item.test_name === testName
      );

      switch (result.status) {
        case 'SKIPPED':
          run.skipped(suite);
          break;

        case 'ERRORED':
          run.failed(
            suite,
            new vscode.TestMessage(result.test_cases[0].exception),
            Date.now() - startedAt
          );
          break;

        default:
          this._processTestSuiteResult(run, suite, result, startedAt);
          break;
      }

      run.appendOutput(output, undefined, suite);
    } catch (err) {
      run.appendOutput(err.toString(), undefined, suite);
      run.failed(suite, new vscode.TestMessage(err.toString()), Date.now() - startedAt);
    }
  }

  async _processTestSuiteResult(run, suite, result, startedAt) {
    const envName = suite.parent.label;
    const testName = suite.label;
    suite.children.replace([]);
    result.test_cases.forEach((testCase) => {
      const test = this.controller.createTestItem(
        `case:${envName}/${testName}/${testCase.name}`,
        testCase.name,
        testCase.source
          ? vscode.Uri.file(path.resolve(testCase.source.file))
          : undefined
      );
      if (testCase.source && testCase.source.line) {
        test.range = new vscode.Range(
          testCase.source.line - 1,
          0,
          testCase.source.line - 1,
          0
        );
      }
      suite.children.add(test);

      switch (testCase.status) {
        case 'SKIPPED':
          run.skipped(test);
          break;
        case 'ERRORED':
          run.failed(
            test,
            new vscode.TestMessage(testCase.exception),
            Date.now() - startedAt
          );
          break;
        case 'FAILED':
          run.failed(
            test,
            new vscode.TestMessage(testCase.message),
            Date.now() - startedAt
          );
          break;
        default:
          run.passed(test, Date.now() - startedAt);
          break;
      }

      if (testCase.stdout) {
        run.appendOutput(
          testCase.stdout,
          test.uri ? new vscode.Location(test.uri, test.range) : undefined,
          test
        );
      }
    });
  }
}
