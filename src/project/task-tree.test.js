/**
 * Unit tests for src/project/task-tree.js
 */

import ProjectTasksTreeProvider from './task-tree';
import vscode from 'vscode';

jest.mock('vscode', () => jest.requireActual('../../__mocks__/vscode'));

describe('ProjectTasksTreeProvider', () => {
  const makeTask = (name, coreEnv, group, multienv = false) => ({
    name,
    title: `Title: ${name}`,
    coreEnv,
    group,
    multienv,
  });

  describe('constructor', () => {
    it('stores constructor arguments', () => {
      const provider = new ProjectTasksTreeProvider(123, ['env1'], [], 'env1', false);
      expect(provider.id).toBe(123);
      expect(provider.envs).toEqual(['env1']);
      expect(provider.tasks).toEqual([]);
      expect(provider.selectedEnv).toBe('env1');
      expect(provider.multiEnvProject).toBe(false);
      expect(provider.multiEnvExplorer).toBe(false);
    });
  });

  describe('getEnvTasks', () => {
    it('returns tasks matching env without duplicates or cross-env leakage', () => {
      const tasks = [
        makeTask('Build', 'env1'),
        makeTask('Upload', 'env2'),
        makeTask('Clean', 'env1'),
      ];
      const provider = new ProjectTasksTreeProvider(1, ['env1', 'env2'], tasks);
      const result = provider.getEnvTasks('env1');
      // Only env1 tasks are returned; env2 tasks are not leaked; no duplicates
      expect(result.filter((t) => t.name === 'Build')).toHaveLength(1);
      expect(result.filter((t) => t.name === 'Clean')).toHaveLength(1);
      expect(result.filter((t) => t.name === 'Upload')).toHaveLength(0);
    });

    it('returns all tasks when no env is specified', () => {
      const tasks = [makeTask('Build', undefined), makeTask('Upload', 'env1')];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      // env=undefined → first filter matches tasks where coreEnv === undefined
      const result = provider.getEnvTasks();
      expect(result.map((t) => t.name)).toEqual(['Build']);
    });

    it('filters by group when provided', () => {
      const tasks = [
        makeTask('Build', 'env1', 'General'),
        makeTask('Upload', 'env1', 'Platform'),
        makeTask('Clean', 'env1', 'General'),
      ];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      const general = provider.getEnvTasks('env1', 'General');
      const platform = provider.getEnvTasks('env1', 'Platform');
      // Only tasks matching the requested group and env are returned; no duplicates
      expect(general.filter((t) => t.name === 'Build')).toHaveLength(1);
      expect(general.filter((t) => t.name === 'Clean')).toHaveLength(1);
      expect(platform.filter((t) => t.name === 'Upload')).toHaveLength(1);
    });

    it('merges default/env-independent tasks when env is set', () => {
      const tasks = [
        makeTask('Build', undefined, undefined, false),
        makeTask('Upload', 'env1', undefined, false),
      ];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      const result = provider.getEnvTasks('env1');
      expect(result).toContain(tasks[0]);
      expect(result).toContain(tasks[1]);
    });

    it('does not merge multienv tasks into env results', () => {
      const tasks = [
        makeTask('Upload All', undefined, undefined, true),
        makeTask('Build', 'env1', undefined, false),
      ];
      const provider = new ProjectTasksTreeProvider(1, ['env1', 'env2'], tasks);
      const result = provider.getEnvTasks('env1');
      // multienv=true tasks are excluded from the merge
      expect(result.map((t) => t.name)).not.toContain('Upload All');
      expect(result.map((t) => t.name)).toContain('Build');
    });

    it('group filter also applies to merged env-independent tasks', () => {
      const tasks = [
        makeTask('Monitor', undefined, 'Platform', false),
        makeTask('Build', undefined, 'General', false),
        makeTask('Upload', 'env1', 'Platform', false),
      ];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      const result = provider.getEnvTasks('env1', 'Platform');
      expect(result.map((t) => t.name)).toContain('Monitor');
      expect(result.map((t) => t.name)).toContain('Upload');
      expect(result.map((t) => t.name)).not.toContain('Build');
    });

    it('does not merge default tasks for the DEFAULT_ENV_NAME', () => {
      const tasks = [
        makeTask('Build', undefined, undefined, false),
        makeTask('Upload', 'env1', undefined, false),
      ];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      const result = provider.getEnvTasks(ProjectTasksTreeProvider.DEFAULT_ENV_NAME);
      // DEFAULT_ENV_NAME is 'Default', but tasks with coreEnv undefined
      // do not match coreEnv === 'Default', so result is empty.
      expect(result).toEqual([]);
    });
  });

  describe('taskToTreeItem', () => {
    it('creates a TreeItem with correct label and tooltip', () => {
      const provider = new ProjectTasksTreeProvider(1, [], []);
      const task = makeTask('Build', 'env1');
      const treeItem = provider.taskToTreeItem(task);
      expect(treeItem.label).toBe('Build');
      expect(treeItem.tooltip).toBe('Title: Build');
      expect(treeItem.iconPath.id).toBe('circle-outline');
    });

    it('sets the command with correct title, command id, and task argument', () => {
      const provider = new ProjectTasksTreeProvider(1, [], []);
      const task = makeTask('Build', 'env1');
      const treeItem = provider.taskToTreeItem(task);
      expect(treeItem.command).toEqual({
        title: 'Title: Build',
        command: 'platformio-ide._runProjectTask',
        arguments: [task],
      });
    });

    it('appends " All" for multienv tasks in multienv project', () => {
      const provider = new ProjectTasksTreeProvider(
        1,
        ['env1', 'env2'],
        [],
        undefined,
        true,
      );
      const task = makeTask('Build', undefined, undefined, true);
      const treeItem = provider.taskToTreeItem(task);
      expect(treeItem.label).toBe('Build All');
    });

    it('does not append " All" when not a multienv project', () => {
      const provider = new ProjectTasksTreeProvider(1, ['env1'], [], undefined, false);
      const task = makeTask('Build', undefined, undefined, true);
      const treeItem = provider.taskToTreeItem(task);
      expect(treeItem.label).toBe('Build');
    });

    it('does not append " All" when task has a coreEnv even if multienv=true', () => {
      // coreEnv is set → the condition !task.coreEnv is false → no " All"
      const provider = new ProjectTasksTreeProvider(
        1,
        ['env1', 'env2'],
        [],
        undefined,
        true,
      );
      const task = makeTask('Build', 'env1', undefined, true);
      const treeItem = provider.taskToTreeItem(task);
      expect(treeItem.label).toBe('Build');
    });
  });

  describe('getTreeItem', () => {
    it('returns item directly if it is already a TreeItem', () => {
      const provider = new ProjectTasksTreeProvider(1, [], []);
      const treeItem = new vscode.TreeItem('Test');
      expect(provider.getTreeItem(treeItem)).toBe(treeItem);
    });

    it('converts a task to a TreeItem', () => {
      const provider = new ProjectTasksTreeProvider(1, [], []);
      const task = makeTask('Build', 'env1');
      const treeItem = provider.getTreeItem(task);
      expect(treeItem.label).toBe('Build');
    });
  });

  describe('getRootChildren', () => {
    it('returns Default env when no explicit envs exist', () => {
      const provider = new ProjectTasksTreeProvider(1, [], []);
      const children = provider.getRootChildren();
      expect(children).toHaveLength(1);
      expect(children[0].label).toBe('Default');
      expect(children[0].env).toBeUndefined();
    });

    it('sets id and iconPath on each root item', () => {
      const provider = new ProjectTasksTreeProvider(42, ['env1'], []);
      const children = provider.getRootChildren();
      // Default node: id uses "undefined" as the env string
      expect(children[0].id).toBe('42-undefined');
      expect(children[0].iconPath.id).toBe('root-folder');
      expect(children[1].id).toBe('42-env1');
      expect(children[1].iconPath.id).toBe('root-folder');
    });

    it('returns all envs with correct expand state', () => {
      const provider = new ProjectTasksTreeProvider(
        1,
        ['env1', 'env2'],
        [],
        'env1',
        false,
      );
      const children = provider.getRootChildren();
      expect(children).toHaveLength(3); // undefined + env1 + env2
      expect(children[0].label).toBe('Default');
      // Default node env is undefined, so collapsibleState is always Collapsed
      expect(children[0].collapsibleState).toBe(
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      expect(children[1].label).toBe('env1');
      expect(children[1].collapsibleState).toBe(
        vscode.TreeItemCollapsibleState.Expanded,
      );
      expect(children[2].label).toBe('env2');
      expect(children[2].collapsibleState).toBe(
        vscode.TreeItemCollapsibleState.Collapsed,
      );
    });

    it('expands only selected env when multiEnvProject is true', () => {
      const provider = new ProjectTasksTreeProvider(
        1,
        ['env1', 'env2'],
        [],
        'env1',
        false,
      );
      const children = provider.getRootChildren();
      const env1Item = children.find((c) => c.label === 'env1');
      const env2Item = children.find((c) => c.label === 'env2');
      expect(env1Item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(env2Item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    });

    it('expands all envs when multiEnvProject is false', () => {
      const provider = new ProjectTasksTreeProvider(1, ['env1'], [], 'env1', false);
      const children = provider.getRootChildren();
      const env1Item = children.find((c) => c.label === 'env1');
      expect(env1Item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
    });

    it('collapses all envs when no env is selected and multiEnvProject is true', () => {
      const provider = new ProjectTasksTreeProvider(
        1,
        ['env1', 'env2'],
        [],
        undefined,
        false,
      );
      const children = provider.getRootChildren();
      const env1Item = children.find((c) => c.label === 'env1');
      const env2Item = children.find((c) => c.label === 'env2');
      // No selectedEnv and multiEnvProject=true → both collapsed
      expect(env1Item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
      expect(env2Item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    });
  });

  describe('getEnvChildren', () => {
    it('returns "Loading..." when no tasks exist for env', () => {
      const provider = new ProjectTasksTreeProvider(1, ['env1'], []);
      const children = provider.getEnvChildren('env1');
      expect(children).toHaveLength(1);
      expect(children[0].label).toBe('Loading...');
    });

    it('returns raw tasks without group and task group nodes', () => {
      const tasks = [
        makeTask('Build', 'env1'),
        makeTask('Upload', 'env1', 'Platform'),
        makeTask('Clean', 'env1'),
      ];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      const children = provider.getEnvChildren('env1');
      // Raw tasks have 'name'; group nodes have 'label'
      const names = children.map((c) => c.name || c.label);
      expect(names).toContain('Build');
      expect(names).toContain('Clean');
      expect(names).toContain('Platform');
    });

    it('sets env, group, and iconPath on group nodes', () => {
      const tasks = [makeTask('Upload', 'env1', 'Platform')];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      const children = provider.getEnvChildren('env1');
      const groupNode = children.find((c) => c.label === 'Platform');
      expect(groupNode.env).toBe('env1');
      expect(groupNode.group).toBe('Platform');
      expect(groupNode.iconPath).toBe(vscode.ThemeIcon.Folder);
    });

    it('expands General and Platform groups, collapses others', () => {
      const tasks = [
        makeTask('Build', 'env1', 'General'),
        makeTask('Upload', 'env1', 'Platform'),
        makeTask('Debug', 'env1', 'Advanced'),
      ];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      const children = provider.getEnvChildren('env1');
      const general = children.find((c) => c.label === 'General');
      const platform = children.find((c) => c.label === 'Platform');
      const advanced = children.find((c) => c.label === 'Advanced');
      expect(general.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(platform.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(advanced.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    });

    it('includes env-independent tasks merged into the env', () => {
      const tasks = [
        makeTask('Monitor', undefined, undefined, false),
        makeTask('Build', 'env1'),
      ];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      const children = provider.getEnvChildren('env1');
      const names = children.map((c) => c.name || c.label);
      expect(names).toContain('Monitor');
      expect(names).toContain('Build');
    });
  });

  describe('getTaskGroups', () => {
    it('always includes "General" first', () => {
      const provider = new ProjectTasksTreeProvider(1, [], []);
      const groups = provider.getTaskGroups([
        makeTask('t1', 'env1', 'Platform'),
        makeTask('t2', 'env1', 'Advanced'),
      ]);
      expect(groups[0]).toBe('General');
      expect(groups[1]).toBe('Platform');
      expect(groups).toContain('Advanced');
    });

    it('returns only "General" when no tasks have groups', () => {
      const provider = new ProjectTasksTreeProvider(1, [], []);
      const groups = provider.getTaskGroups([makeTask('t1', 'env1')]);
      expect(groups).toEqual(['General']);
    });

    it('deduplicates repeated group names', () => {
      const provider = new ProjectTasksTreeProvider(1, [], []);
      const groups = provider.getTaskGroups([
        makeTask('t1', 'env1', 'Custom'),
        makeTask('t2', 'env1', 'Custom'),
        makeTask('t3', 'env1', 'Custom'),
      ]);
      expect(groups.filter((g) => g === 'Custom')).toHaveLength(1);
    });

    it('places Platform second when present, before other custom groups', () => {
      const provider = new ProjectTasksTreeProvider(1, [], []);
      const groups = provider.getTaskGroups([
        makeTask('t1', 'env1', 'Zebra'),
        makeTask('t2', 'env1', 'Platform'),
        makeTask('t3', 'env1', 'Alpha'),
      ]);
      expect(groups.indexOf('General')).toBe(0);
      expect(groups.indexOf('Platform')).toBe(1);
      expect(groups.indexOf('Zebra')).toBeGreaterThan(1);
      expect(groups.indexOf('Alpha')).toBeGreaterThan(1);
    });

    it('preserves insertion order for non-Platform custom groups', () => {
      const provider = new ProjectTasksTreeProvider(1, [], []);
      const groups = provider.getTaskGroups([
        makeTask('t1', 'env1', 'Beta'),
        makeTask('t2', 'env1', 'Alpha'),
      ]);
      // No Platform → General, Beta, Alpha (insertion order)
      expect(groups).toEqual(['General', 'Beta', 'Alpha']);
    });
  });

  describe('getChildren', () => {
    it('returns root children when no element is provided', () => {
      const provider = new ProjectTasksTreeProvider(1, ['env1'], []);
      const children = provider.getChildren();
      expect(children[0].label).toBe('Default');
    });

    it('routes to getEnvChildren when selectedEnv is set and multiEnvExplorer is false', () => {
      const tasks = [makeTask('Build', 'env1')];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks, 'env1', false);
      // No element passed → selectedEnv branch
      const children = provider.getChildren(undefined);
      const names = children.map((c) => c.name || c.label);
      expect(names).toContain('Build');
    });

    it('returns root children when selectedEnv is set but multiEnvExplorer is true', () => {
      const provider = new ProjectTasksTreeProvider(
        1,
        ['env1', 'env2'],
        [],
        'env1',
        true,
      );
      const children = provider.getChildren(undefined);
      // multiEnvExplorer=true → falls through to getRootChildren
      expect(children[0].label).toBe('Default');
    });

    it('returns env tasks when element is an env node', () => {
      const tasks = [makeTask('Build', 'env1')];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      const envNode = { env: 'env1' };
      const children = provider.getChildren(envNode);
      const names = children.map((c) => c.name || c.label);
      expect(names).toContain('Build');
    });

    it('returns tasks for a group element', () => {
      const tasks = [
        makeTask('Build', 'env1', 'General'),
        makeTask('Upload', 'env1', 'Platform'),
      ];
      const provider = new ProjectTasksTreeProvider(1, ['env1'], tasks);
      const groupNode = { env: 'env1', group: 'General' };
      const children = provider.getChildren(groupNode);
      const names = children.map((c) => c.name || c.label);
      expect(names).toContain('Build');
      expect(names).not.toContain('Upload');
    });
  });
});
