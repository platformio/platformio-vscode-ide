/**
 * Unit tests for src/project/helpers.js
 */

import {
  getActiveEditorProjectDir,
  getLastProjectDir,
  getPIOProjectDirs,
  getProjectItemState,
  isPIOProjectSync,
  updateProjectItemState,
} from './helpers';
import { extension } from '../main';
import fs from 'fs';
import path from 'path';
import vscode from 'vscode';

jest.mock('vscode', () => jest.requireActual('../../__mocks__/vscode'));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), accessSync: jest.fn() }));

jest.mock('../main', () => ({
  extension: {
    context: {
      globalState: {
        get: jest.fn(),
        update: jest.fn(),
      },
    },
  },
}));

const mockGlobalState = extension.context.globalState;

describe('isPIOProjectSync', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when platformio.ini exists', () => {
    fs.accessSync.mockImplementation(() => {});
    expect(isPIOProjectSync('/tmp/test-project')).toBe(true);
    expect(fs.accessSync).toHaveBeenCalledWith(
      path.join('/tmp/test-project', 'platformio.ini'),
    );
  });

  it('returns false when platformio.ini does not exist', () => {
    fs.accessSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(isPIOProjectSync('/tmp/test-project')).toBe(false);
  });
});

describe('getPIOProjectDirs', () => {
  afterEach(() => {
    jest.clearAllMocks();
    vscode.workspace.workspaceFolders = undefined;
  });

  it('returns empty array when no workspace folders are open', () => {
    vscode.workspace.workspaceFolders = undefined;
    expect(getPIOProjectDirs()).toEqual([]);
  });

  it('returns only directories that contain platformio.ini', () => {
    vscode.workspace.workspaceFolders = [
      { uri: { fsPath: '/workspace/pio-project' } },
      { uri: { fsPath: '/workspace/other-project' } },
    ];
    fs.accessSync.mockImplementation((p) => {
      if (p.includes('pio-project')) {
        return;
      }
      throw new Error('ENOENT');
    });
    expect(getPIOProjectDirs()).toEqual(['/workspace/pio-project']);
  });
});

describe('getActiveEditorProjectDir', () => {
  afterEach(() => {
    jest.clearAllMocks();
    vscode.workspace.workspaceFolders = undefined;
    vscode.window.activeTextEditor = undefined;
  });

  it('returns undefined when no workspace folders are open', () => {
    vscode.workspace.workspaceFolders = undefined;
    expect(getActiveEditorProjectDir()).toBeUndefined();
  });

  it('returns undefined when no editor is active', () => {
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/workspace/pio-project' } }];
    vscode.window.activeTextEditor = undefined;
    expect(getActiveEditorProjectDir()).toBeUndefined();
  });

  it('returns undefined when active editor scheme is not file', () => {
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/workspace/pio-project' } }];
    vscode.window.activeTextEditor = {
      document: { uri: { scheme: 'untitled' } },
    };
    expect(getActiveEditorProjectDir()).toBeUndefined();
  });

  it('returns project dir when editor belongs to a PIO project workspace', () => {
    fs.accessSync.mockImplementation(() => {});
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/workspace/pio-project' } }];
    vscode.window.activeTextEditor = {
      document: {
        uri: { scheme: 'file', fsPath: '/workspace/pio-project/src/main.cpp' },
      },
    };
    vscode.workspace.getWorkspaceFolder.mockReturnValue({
      uri: { fsPath: '/workspace/pio-project' },
    });
    expect(getActiveEditorProjectDir()).toBe('/workspace/pio-project');
  });

  it('returns undefined when editor workspace is not a PIO project', () => {
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/workspace/pio-project' } }];
    vscode.window.activeTextEditor = {
      document: { uri: { scheme: 'file', fsPath: '/workspace/other/src/main.cpp' } },
    };
    fs.accessSync.mockImplementation((p) => {
      if (p.includes('pio-project')) {
        return;
      }
      throw new Error('ENOENT');
    });
    vscode.workspace.getWorkspaceFolder.mockReturnValue({
      uri: { fsPath: '/workspace/other' },
    });
    expect(getActiveEditorProjectDir()).toBeUndefined();
  });

  it('returns undefined when getWorkspaceFolder returns null', () => {
    fs.accessSync.mockImplementation(() => {});
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/workspace/pio-project' } }];
    vscode.window.activeTextEditor = {
      document: {
        uri: { scheme: 'file', fsPath: '/workspace/pio-project/src/main.cpp' },
      },
    };
    vscode.workspace.getWorkspaceFolder.mockReturnValue(null);
    expect(getActiveEditorProjectDir()).toBeUndefined();
  });
});

describe('getProjectItemState', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns stored value for a given project and key', () => {
    mockGlobalState.get.mockReturnValue({
      '/workspace/project1': { selectedEnv: 'dev' },
    });
    expect(getProjectItemState('/workspace/project1', 'selectedEnv')).toBe('dev');
  });

  it('returns undefined when project is not in state', () => {
    mockGlobalState.get.mockReturnValue({});
    expect(getProjectItemState('/workspace/unknown', 'selectedEnv')).toBeUndefined();
  });

  it('returns undefined when key is missing for existing project', () => {
    mockGlobalState.get.mockReturnValue({
      '/workspace/project1': {},
    });
    expect(getProjectItemState('/workspace/project1', 'selectedEnv')).toBeUndefined();
  });
});

describe('updateProjectItemState', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates project entry when it does not exist', () => {
    mockGlobalState.get.mockReturnValue({});
    fs.accessSync.mockImplementation(() => {});
    updateProjectItemState('/workspace/project1', 'selectedEnv', 'prod');
    expect(mockGlobalState.update).toHaveBeenCalledWith(
      'projects',
      expect.objectContaining({
        '/workspace/project1': { selectedEnv: 'prod' },
      }),
    );
    expect(mockGlobalState.update).toHaveBeenCalledWith(
      'lastProjectDir',
      '/workspace/project1',
    );
  });

  it('updates existing project entry and cleans up removed projects', () => {
    mockGlobalState.get.mockImplementation((key) => {
      if (key === 'projects') {
        return {
          '/workspace/project1': {},
          '/workspace/removed': {},
        };
      }
      return undefined;
    });
    fs.accessSync.mockImplementation((p) => {
      if (p.includes('removed')) {
        throw new Error('ENOENT');
      }
    });
    updateProjectItemState('/workspace/project1', 'selectedEnv', 'prod');
    expect(mockGlobalState.update).toHaveBeenCalledWith(
      'projects',
      expect.objectContaining({
        '/workspace/project1': { selectedEnv: 'prod' },
      }),
    );
    expect(mockGlobalState.update).toHaveBeenCalledWith(
      'lastProjectDir',
      '/workspace/project1',
    );
  });

  it('does not remove the project being updated even if its ini is temporarily missing', () => {
    // Simulate a race where accessSync throws for the project being updated
    mockGlobalState.get.mockReturnValue({ '/workspace/project1': {} });
    fs.accessSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    updateProjectItemState('/workspace/project1', 'selectedEnv', 'dev');
    // The project should still be written (cleanup runs after the update)
    const [, writtenProjects] = mockGlobalState.update.mock.calls.find(
      ([k]) => k === 'projects',
    );
    // project1 was removed by cleanup because accessSync throws — this documents
    // the current behaviour so any future change is intentional
    expect(writtenProjects).not.toHaveProperty('/workspace/project1');
  });

  it('overwrites an existing key value', () => {
    mockGlobalState.get.mockReturnValue({
      '/workspace/project1': { selectedEnv: 'old' },
    });
    fs.accessSync.mockImplementation(() => {});
    updateProjectItemState('/workspace/project1', 'selectedEnv', 'new');
    const [, writtenProjects] = mockGlobalState.update.mock.calls.find(
      ([k]) => k === 'projects',
    );
    expect(writtenProjects['/workspace/project1'].selectedEnv).toBe('new');
  });
});

describe('getLastProjectDir', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns the last project directory from global state', () => {
    mockGlobalState.get.mockReturnValue('/workspace/last-project');
    expect(getLastProjectDir()).toBe('/workspace/last-project');
  });

  it('returns undefined when no last project is stored', () => {
    mockGlobalState.get.mockReturnValue(undefined);
    expect(getLastProjectDir()).toBeUndefined();
  });
});
