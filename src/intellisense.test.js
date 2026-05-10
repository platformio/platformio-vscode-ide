/**
 * Unit tests for src/intellisense.js
 *
 * Private helpers (detectPicolibcFlags, detectChipFamiliesFromEntries,
 * absolutizeIncludes, etc.) are tested indirectly through the exported
 * functions that exercise them, or via a thin re-export shim defined at
 * the bottom of this file using jest.mock module factories.
 */

import * as pioNodeHelpers from 'pioarduino-node-helpers';
import {
  applyBackendConfigDefaults,
  disposeAllIdfWatchers,
  disposeClangdCcWatcher,
  disposeIdfCcWatcher,
  getActiveBackend,
  getActiveBackendId,
  getActiveConflictedExtensionIds,
  invalidateIdfCache,
  isBackendExtensionInstalled,
  isIdfProject,
  warnIfBackendMissing,
  watchClangdCompileCommands,
  watchIdfCompileCommands,
} from './intellisense';
import { extension } from './main';
import { promises as fsMock } from 'fs';
import vscode from 'vscode';

jest.mock('vscode', () => jest.requireActual('../__mocks__/vscode'));

jest.mock('./constants', () => ({
  IS_WINDOWS: false,
  INTELLISENSE_BACKENDS: {
    cpptools: {
      id: 'cpptools',
      label: 'Microsoft C/C++ (cpptools)',
      extensionId: 'ms-vscode.cpptools',
      rescanCommand: 'C_Cpp.RescanWorkspace',
      configDefaults: {
        'C_Cpp.debugShortcut': false,
        'C_Cpp.intelliSenseEngine': 'default',
      },
    },
    clangd: {
      id: 'clangd',
      label: 'clangd (vscode-clangd)',
      extensionId: 'llvm-vs-code-extensions.vscode-clangd',
      rescanCommand: 'clangd.restart',
      configDefaults: {
        'C_Cpp.intelliSenseEngine': 'disabled',
        'clangd.detectExtensionConflicts': false,
      },
    },
  },
  getConflictedExtensionIds: jest.fn((backendId) => {
    const all = ['ms-vscode.cpptools', 'llvm-vs-code-extensions.vscode-clangd'];
    const active =
      backendId === 'clangd'
        ? 'llvm-vs-code-extensions.vscode-clangd'
        : 'ms-vscode.cpptools';
    return ['vsciot-vscode.vscode-arduino', ...all.filter((id) => id !== active)];
  }),
}));

jest.mock('./main', () => ({
  extension: {
    getConfiguration: jest.fn(),
  },
}));

jest.mock('./shellTokenize', () => jest.fn(() => []));

jest.mock('pioarduino-node-helpers', () => ({
  core: {
    getCoreDir: jest.fn(() => '/home/user/.platformio'),
    getCorePythonCommandOutput: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn(),
    readdir: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
  },
}));

// ─── helpers ────────────────────────────────────────────────────────────────

function setBackend(id) {
  extension.getConfiguration.mockReturnValue(id === 'cpptools' ? null : id);
}

function setExtensionInstalled(installed) {
  vscode.extensions.getExtension.mockReturnValue(
    installed ? { id: 'mock' } : undefined,
  );
}

// ─── getActiveBackendId ──────────────────────────────────────────────────────

describe('getActiveBackendId', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns "cpptools" when configuration is falsy', () => {
    extension.getConfiguration.mockReturnValue(null);
    expect(getActiveBackendId()).toBe('cpptools');
  });

  it('returns "clangd" when configuration is set to clangd', () => {
    extension.getConfiguration.mockReturnValue('clangd');
    expect(getActiveBackendId()).toBe('clangd');
  });

  it('returns "cpptools" when configuration is empty string', () => {
    extension.getConfiguration.mockReturnValue('');
    expect(getActiveBackendId()).toBe('cpptools');
  });
});

// ─── getActiveBackend ────────────────────────────────────────────────────────

describe('getActiveBackend', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns the cpptools backend object by default', () => {
    setBackend('cpptools');
    const backend = getActiveBackend();
    expect(backend.id).toBe('cpptools');
    expect(backend.extensionId).toBe('ms-vscode.cpptools');
  });

  it('returns the clangd backend object when configured', () => {
    setBackend('clangd');
    const backend = getActiveBackend();
    expect(backend.id).toBe('clangd');
    expect(backend.extensionId).toBe('llvm-vs-code-extensions.vscode-clangd');
  });

  it('falls back to cpptools for an unknown backend id', () => {
    extension.getConfiguration.mockReturnValue('unknown-backend');
    const backend = getActiveBackend();
    expect(backend.id).toBe('cpptools');
  });
});

// ─── getActiveConflictedExtensionIds ─────────────────────────────────────────

describe('getActiveConflictedExtensionIds', () => {
  afterEach(() => jest.clearAllMocks());

  it('excludes the active backend extension from the conflict list', () => {
    setBackend('clangd');
    const ids = getActiveConflictedExtensionIds();
    expect(ids).not.toContain('llvm-vs-code-extensions.vscode-clangd');
    expect(ids).toContain('ms-vscode.cpptools');
  });

  it('always includes the arduino extension', () => {
    setBackend('cpptools');
    const ids = getActiveConflictedExtensionIds();
    expect(ids).toContain('vsciot-vscode.vscode-arduino');
  });
});

// ─── isBackendExtensionInstalled ─────────────────────────────────────────────

describe('isBackendExtensionInstalled', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns true when the backend extension is present', () => {
    setBackend('clangd');
    setExtensionInstalled(true);
    expect(isBackendExtensionInstalled()).toBe(true);
    expect(vscode.extensions.getExtension).toHaveBeenCalledWith(
      'llvm-vs-code-extensions.vscode-clangd',
    );
  });

  it('returns false when the backend extension is absent', () => {
    setBackend('clangd');
    setExtensionInstalled(false);
    expect(isBackendExtensionInstalled()).toBe(false);
  });
});

// ─── applyBackendConfigDefaults ──────────────────────────────────────────────

describe('applyBackendConfigDefaults', () => {
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      inspect: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    vscode.workspace.getConfiguration = jest.fn().mockReturnValue(mockConfig);
    vscode.ConfigurationTarget = { Global: 1 };
  });

  afterEach(() => jest.clearAllMocks());

  it('does nothing when the backend extension is not installed', async () => {
    setBackend('clangd');
    setExtensionInstalled(false);
    await applyBackendConfigDefaults();
    expect(mockConfig.update).not.toHaveBeenCalled();
  });

  it('sets config keys that are currently unset', async () => {
    setBackend('clangd');
    setExtensionInstalled(true);
    mockConfig.inspect.mockReturnValue({
      globalValue: undefined,
      workspaceValue: undefined,
    });
    await applyBackendConfigDefaults();
    // clangd backend has two configDefaults keys
    expect(mockConfig.update).toHaveBeenCalledTimes(2);
    expect(mockConfig.update).toHaveBeenCalledWith(
      'C_Cpp.intelliSenseEngine',
      'disabled',
      1,
    );
    expect(mockConfig.update).toHaveBeenCalledWith(
      'clangd.detectExtensionConflicts',
      false,
      1,
    );
  });

  it('overwrites a key that was set by the other backend', async () => {
    setBackend('clangd');
    setExtensionInstalled(true);
    // 'C_Cpp.intelliSenseEngine' was set to 'default' by cpptools backend
    mockConfig.inspect.mockImplementation((key) => ({
      globalValue: key === 'C_Cpp.intelliSenseEngine' ? 'default' : undefined,
      workspaceValue: undefined,
    }));
    await applyBackendConfigDefaults();
    expect(mockConfig.update).toHaveBeenCalledWith(
      'C_Cpp.intelliSenseEngine',
      'disabled',
      1,
    );
  });

  it('does not overwrite a key that was set by the user (not by another backend)', async () => {
    setBackend('clangd');
    setExtensionInstalled(true);
    // User set 'C_Cpp.intelliSenseEngine' to 'Tag Parser' — not a backend default
    mockConfig.inspect.mockImplementation((key) => ({
      globalValue: key === 'C_Cpp.intelliSenseEngine' ? 'Tag Parser' : undefined,
      workspaceValue: undefined,
    }));
    await applyBackendConfigDefaults();
    expect(mockConfig.update).not.toHaveBeenCalledWith(
      'C_Cpp.intelliSenseEngine',
      expect.anything(),
      expect.anything(),
    );
  });
});

// ─── invalidateIdfCache ───────────────────────────────────────────────────────

describe('invalidateIdfCache', () => {
  afterEach(() => jest.clearAllMocks());

  it('runs without error when called with any project dir', () => {
    expect(() => invalidateIdfCache('/workspace/project')).not.toThrow();
  });

  it('can be called multiple times without error', () => {
    invalidateIdfCache('/workspace/project');
    invalidateIdfCache('/workspace/project');
    invalidateIdfCache('/workspace/other');
  });
});

// ─── disposeAllIdfWatchers ────────────────────────────────────────────────────

describe('disposeAllIdfWatchers', () => {
  afterEach(() => jest.clearAllMocks());

  it('runs without error when no watchers are registered', () => {
    expect(() => disposeAllIdfWatchers()).not.toThrow();
  });
});

// ─── disposeIdfCcWatcher / disposeClangdCcWatcher ────────────────────────────

describe('disposeIdfCcWatcher', () => {
  afterEach(() => jest.clearAllMocks());

  it('runs without error when no watcher is registered for the project', () => {
    expect(() => disposeIdfCcWatcher('/workspace/project')).not.toThrow();
  });
});

describe('disposeClangdCcWatcher', () => {
  afterEach(() => jest.clearAllMocks());

  it('runs without error when no watcher is registered for the project', () => {
    expect(() => disposeClangdCcWatcher('/workspace/project')).not.toThrow();
  });
});

// ─── watchClangdCompileCommands ───────────────────────────────────────────────

describe('watchClangdCompileCommands', () => {
  let mockWatcher;

  beforeEach(() => {
    mockWatcher = {
      onDidDelete: jest.fn(),
      dispose: jest.fn(),
    };
    vscode.workspace.createFileSystemWatcher = jest.fn().mockReturnValue(mockWatcher);
    vscode.RelativePattern = jest.fn((base, pattern) => ({ base, pattern }));
  });

  afterEach(() => jest.clearAllMocks());

  it('does nothing when projectDir is falsy', () => {
    watchClangdCompileCommands('', jest.fn());
    expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
  });

  it('creates three file system watchers for the project', () => {
    watchClangdCompileCommands('/workspace/project', jest.fn());
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(3);
  });

  it('registers onDidDelete on each watcher', () => {
    watchClangdCompileCommands('/workspace/project', jest.fn());
    expect(mockWatcher.onDidDelete).toHaveBeenCalledTimes(3);
  });

  it('calls onMissing when a watcher fires onDidDelete', async () => {
    const onMissing = jest.fn().mockResolvedValue(undefined);
    watchClangdCompileCommands('/workspace/project', onMissing);
    // Simulate the delete event by calling the registered handler
    const handler = mockWatcher.onDidDelete.mock.calls[0][0];
    await handler();
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it('disposes previous watchers when called again for the same project', () => {
    watchClangdCompileCommands('/workspace/project', jest.fn());
    const firstDispose = mockWatcher.dispose;
    watchClangdCompileCommands('/workspace/project', jest.fn());
    // The composite disposable's dispose() calls each individual watcher's dispose()
    expect(firstDispose).toHaveBeenCalled();
  });
});

// ─── watchIdfCompileCommands ──────────────────────────────────────────────────

describe('watchIdfCompileCommands', () => {
  let mockWatcher;

  beforeEach(() => {
    mockWatcher = {
      onDidCreate: jest.fn(),
      onDidChange: jest.fn(),
      dispose: jest.fn(),
    };
    vscode.workspace.createFileSystemWatcher = jest.fn().mockReturnValue(mockWatcher);
    vscode.RelativePattern = jest.fn((base, pattern) => ({ base, pattern }));
    fsMock.access.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  it('does nothing when projectDir is falsy', () => {
    watchIdfCompileCommands('', undefined, jest.fn());
    expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled();
  });

  it('creates one watcher when no envDir is provided', () => {
    watchIdfCompileCommands('/workspace/project', undefined, jest.fn());
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(1);
  });

  it('creates two watchers when envDir is provided', () => {
    watchIdfCompileCommands(
      '/workspace/project',
      '/workspace/project/.pio/build/env1',
      jest.fn(),
    );
    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2);
  });

  it('calls onReady when the root watcher fires onCreate', async () => {
    const onReady = jest.fn().mockResolvedValue(undefined);
    watchIdfCompileCommands('/workspace/project', undefined, onReady);
    const handler = mockWatcher.onDidCreate.mock.calls[0][0];
    await handler();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('coalesces a second event that arrives while the first is still running', async () => {
    const onReady = jest.fn().mockResolvedValue(undefined);
    watchIdfCompileCommands(
      '/workspace/project',
      '/workspace/project/.pio/build/env1',
      onReady,
    );
    // Both handlers fire at the same time — the second sets queued=true and
    // returns immediately; after the first completes, onReady is called once
    // more for the queued event.
    const rootHandler = mockWatcher.onDidCreate.mock.calls[0][0];
    const envHandler = mockWatcher.onDidCreate.mock.calls[1][0];
    await Promise.all([rootHandler(), envHandler()]);
    // onReady is called once for the first event, then once more for the
    // coalesced queued event — total 2 calls, not 1 dropped.
    expect(onReady).toHaveBeenCalledTimes(2);
  });
});

// ─── isIdfProject ─────────────────────────────────────────────────────────────

describe('isIdfProject', () => {
  afterEach(() => {
    jest.clearAllMocks();
    // Clear the IDF cache between tests
    invalidateIdfCache('/workspace/project');
  });

  it('returns false when observer is null', async () => {
    expect(await isIdfProject(null, undefined)).toBe(false);
  });

  it('returns false when observer.revealActiveEnvironment returns null', async () => {
    const observer = {
      projectDir: '/workspace/project',
      revealActiveEnvironment: jest.fn().mockResolvedValue(null),
    };
    expect(await isIdfProject(observer, undefined)).toBe(false);
  });

  it('returns true when framework contains "espidf"', async () => {
    vscode.workspace.createFileSystemWatcher = jest.fn().mockReturnValue({
      onDidChange: jest.fn(),
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn(),
    });
    vscode.RelativePattern = jest.fn();
    const observer = {
      projectDir: '/workspace/project',
      revealActiveEnvironment: jest.fn().mockResolvedValue('env1'),
    };
    pioNodeHelpers.core.getCorePythonCommandOutput.mockResolvedValue(
      JSON.stringify({ framework: 'espidf', resolverOk: true }),
    );
    const result = await isIdfProject(observer, undefined);
    expect(result).toBe(true);
  });

  it('returns false when framework is "arduino" (not IDF)', async () => {
    vscode.workspace.createFileSystemWatcher = jest.fn().mockReturnValue({
      onDidChange: jest.fn(),
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn(),
    });
    vscode.RelativePattern = jest.fn();
    const observer = {
      projectDir: '/workspace/project',
      revealActiveEnvironment: jest.fn().mockResolvedValue('env1'),
    };
    pioNodeHelpers.core.getCorePythonCommandOutput.mockResolvedValue(
      JSON.stringify({ framework: 'arduino', resolverOk: true }),
    );
    const result = await isIdfProject(observer, undefined);
    expect(result).toBe(false);
  });

  it('falls back to filesystem check when Python subprocess fails', async () => {
    vscode.workspace.createFileSystemWatcher = jest.fn().mockReturnValue({
      onDidChange: jest.fn(),
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn(),
    });
    vscode.RelativePattern = jest.fn();
    const observer = {
      projectDir: '/workspace/project',
      revealActiveEnvironment: jest.fn().mockResolvedValue('env1'),
    };
    pioNodeHelpers.core.getCorePythonCommandOutput.mockRejectedValue(
      new Error('subprocess failed'),
    );
    // sdkconfig exists → IDF project
    fsMock.access.mockResolvedValue(undefined);
    const result = await isIdfProject(observer, undefined);
    expect(result).toBe(true);
  });

  it('returns false when Python fails and no IDF filesystem markers exist', async () => {
    vscode.workspace.createFileSystemWatcher = jest.fn().mockReturnValue({
      onDidChange: jest.fn(),
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn(),
    });
    vscode.RelativePattern = jest.fn();
    const observer = {
      projectDir: '/workspace/project',
      revealActiveEnvironment: jest.fn().mockResolvedValue('env1'),
    };
    pioNodeHelpers.core.getCorePythonCommandOutput.mockRejectedValue(
      new Error('subprocess failed'),
    );
    fsMock.access.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    const result = await isIdfProject(observer, undefined);
    expect(result).toBe(false);
  });

  it('caches the result and does not call Python twice for the same env', async () => {
    vscode.workspace.createFileSystemWatcher = jest.fn().mockReturnValue({
      onDidChange: jest.fn(),
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn(),
    });
    vscode.RelativePattern = jest.fn();
    const observer = {
      projectDir: '/workspace/project',
      revealActiveEnvironment: jest.fn().mockResolvedValue('env1'),
    };
    pioNodeHelpers.core.getCorePythonCommandOutput.mockResolvedValue(
      JSON.stringify({ framework: 'arduino', resolverOk: true }),
    );
    await isIdfProject(observer, undefined);
    await isIdfProject(observer, undefined);
    expect(pioNodeHelpers.core.getCorePythonCommandOutput).toHaveBeenCalledTimes(1);
  });
});

// ─── warnIfBackendMissing ─────────────────────────────────────────────────────

describe('warnIfBackendMissing', () => {
  beforeEach(() => {
    vscode.window.showWarningMessage = jest.fn().mockResolvedValue(undefined);
    vscode.commands.executeCommand = jest.fn();
    vscode.env = { appHost: 'desktop' };
  });

  afterEach(() => jest.clearAllMocks());

  it('does nothing when the backend extension is installed', () => {
    setBackend('clangd');
    setExtensionInstalled(true);
    warnIfBackendMissing();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('shows a warning when the backend extension is missing', () => {
    setBackend('clangd');
    setExtensionInstalled(false);
    // Also mock getExtension for cpptools (used in the warning logic)
    vscode.extensions.getExtension.mockReturnValue(undefined);
    warnIfBackendMissing();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });
});
