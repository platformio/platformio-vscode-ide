/**
 * Unit tests for src/installer/manager.js
 */

import InstallationManager from './manager';
import PIOHome from '../home';
import vscode from 'vscode';

jest.mock('vscode', () => {
  const mock = jest.requireActual('../../__mocks__/vscode');
  const mockConfig = {
    get: jest.fn(),
  };
  mock.workspace.getConfiguration = jest.fn().mockReturnValue(mockConfig);
  mock.ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
  return mock;
});

jest.mock('../constants', () => ({
  PIO_CORE_VERSION_SPEC: '>=6.1.6',
}));

jest.mock('../home', () => ({
  __esModule: true,
  default: { shutdownAllServers: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../main', () => ({
  extension: {
    context: {
      globalState: {
        get: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      extensionPath: '/ext',
    },
  },
}));

jest.mock('./python-prompt', () => {
  const MockPythonPrompt = jest.fn().mockImplementation(() => ({}));
  return { __esModule: true, default: MockPythonPrompt };
});

// Lazy-loaded inside createStages() via require()
jest.mock('pioarduino-node-helpers', () => ({
  installer: {
    pioarduinoCoreStage: jest.fn().mockImplementation(() => ({
      check: jest.fn().mockResolvedValue(true),
      install: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
    })),
  },
}));

const mockGlobalState = require('../main').extension.context.globalState;

// ─── constructor ─────────────────────────────────────────────────────────────

describe('InstallationManager constructor', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('reads workspace configuration on construction', () => {
    const spy = jest.spyOn(vscode.workspace, 'getConfiguration');
    new InstallationManager();
    expect(spy).toHaveBeenCalledWith('platformio-ide');
  });

  it('sets disableAutoUpdates from the argument', () => {
    const mgr = new InstallationManager(true);
    expect(mgr.disableAutoUpdates).toBe(true);
  });

  it('defaults disableAutoUpdates to false', () => {
    const mgr = new InstallationManager();
    expect(mgr.disableAutoUpdates).toBe(false);
  });

  it('initialises stages as null (lazy)', () => {
    const mgr = new InstallationManager();
    expect(mgr.stages).toBeNull();
  });
});

// ─── lock / unlock / locked ───────────────────────────────────────────────────

describe('lock / unlock / locked', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('lock() writes the current timestamp to global state', async () => {
    const mgr = new InstallationManager();
    await mgr.lock();
    expect(mockGlobalState.update).toHaveBeenCalledWith(
      mgr.LOCK_KEY,
      expect.any(Number),
    );
  });

  it('unlock() writes undefined to global state', async () => {
    const mgr = new InstallationManager();
    await mgr.unlock();
    expect(mockGlobalState.update).toHaveBeenCalledWith(mgr.LOCK_KEY, undefined);
  });

  it('locked() returns false when no lock time is stored', () => {
    mockGlobalState.get.mockReturnValue(undefined);
    const mgr = new InstallationManager();
    expect(mgr.locked()).toBe(false);
  });

  it('locked() returns true when lock was acquired within the timeout', () => {
    mockGlobalState.get.mockReturnValue(new Date().getTime());
    const mgr = new InstallationManager();
    expect(mgr.locked()).toBe(true);
  });

  it('locked() returns false when the lock has expired', () => {
    const expired = new Date().getTime() - 2 * 60 * 1000; // 2 minutes ago
    mockGlobalState.get.mockReturnValue(expired);
    const mgr = new InstallationManager();
    expect(mgr.locked()).toBe(false);
  });
});

// ─── onDidStatusChange ────────────────────────────────────────────────────────

describe('onDidStatusChange', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('refreshes the lock when currently locked', async () => {
    mockGlobalState.get.mockReturnValue(new Date().getTime());
    const mgr = new InstallationManager();
    const lockSpy = jest.spyOn(mgr, 'lock');
    mgr.onDidStatusChange();
    expect(lockSpy).toHaveBeenCalledTimes(1);
  });

  it('does not refresh the lock when not locked', () => {
    mockGlobalState.get.mockReturnValue(undefined);
    const mgr = new InstallationManager();
    const lockSpy = jest.spyOn(mgr, 'lock');
    mgr.onDidStatusChange();
    expect(lockSpy).not.toHaveBeenCalled();
  });
});

// ─── createStages ─────────────────────────────────────────────────────────────

describe('createStages', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('populates this.stages on first call', () => {
    const mgr = new InstallationManager();
    mgr.createStages();
    expect(mgr.stages).not.toBeNull();
    expect(mgr.stages).toHaveLength(1);
  });

  it('does not recreate stages on subsequent calls', () => {
    const pioNodeHelpers = require('pioarduino-node-helpers');
    const mgr = new InstallationManager();
    mgr.createStages();
    mgr.createStages();
    expect(pioNodeHelpers.installer.pioarduinoCoreStage).toHaveBeenCalledTimes(1);
  });
});

// ─── check ────────────────────────────────────────────────────────────────────

describe('check', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('returns true when all stages pass', async () => {
    const mgr = new InstallationManager();
    expect(await mgr.check()).toBe(true);
  });

  it('returns false when a stage returns false', async () => {
    const pioNodeHelpers = require('pioarduino-node-helpers');
    pioNodeHelpers.installer.pioarduinoCoreStage.mockImplementationOnce(() => ({
      check: jest.fn().mockResolvedValue(false),
      install: jest.fn(),
      destroy: jest.fn(),
    }));
    const mgr = new InstallationManager();
    expect(await mgr.check()).toBe(false);
  });

  it('returns false and logs a warning when a stage throws', async () => {
    const pioNodeHelpers = require('pioarduino-node-helpers');
    pioNodeHelpers.installer.pioarduinoCoreStage.mockImplementationOnce(() => ({
      check: jest.fn().mockRejectedValue(new Error('network error')),
      install: jest.fn(),
      destroy: jest.fn(),
    }));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mgr = new InstallationManager();
    expect(await mgr.check()).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ─── install ──────────────────────────────────────────────────────────────────

describe('install', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('shuts down PIO Home servers before installing', async () => {
    const mgr = new InstallationManager();
    const progress = { report: jest.fn() };
    await mgr.install(progress);
    expect(PIOHome.shutdownAllServers).toHaveBeenCalledTimes(1);
  });

  it('calls install on each stage with a progress adapter', async () => {
    const pioNodeHelpers = require('pioarduino-node-helpers');
    const mockInstall = jest.fn().mockResolvedValue(undefined);
    pioNodeHelpers.installer.pioarduinoCoreStage.mockImplementationOnce(() => ({
      check: jest.fn().mockResolvedValue(true),
      install: mockInstall,
      destroy: jest.fn(),
    }));
    const mgr = new InstallationManager();
    const progress = { report: jest.fn() };
    await mgr.install(progress);
    expect(mockInstall).toHaveBeenCalledTimes(1);
  });

  it('reports a "Finished" message at the end', async () => {
    const mgr = new InstallationManager();
    const progress = { report: jest.fn() };
    await mgr.install(progress);
    expect(progress.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Finished') }),
    );
  });

  it('scales stage increment relative to the number of stages', async () => {
    const pioNodeHelpers = require('pioarduino-node-helpers');
    pioNodeHelpers.installer.pioarduinoCoreStage.mockImplementationOnce(() => ({
      check: jest.fn().mockResolvedValue(true),
      install: jest.fn().mockImplementation(async (cb) => {
        cb('Downloading', 50);
      }),
      destroy: jest.fn(),
    }));
    const mgr = new InstallationManager();
    const progress = { report: jest.fn() };
    await mgr.install(progress);
    // With 1 stage, stageIncrementTotal = 100; 50% of that = 50
    expect(progress.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Downloading', increment: 50 }),
    );
  });
});

// ─── destroy ──────────────────────────────────────────────────────────────────

describe('destroy', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('calls destroy on each stage', () => {
    const pioNodeHelpers = require('pioarduino-node-helpers');
    const mockDestroy = jest.fn();
    pioNodeHelpers.installer.pioarduinoCoreStage.mockImplementationOnce(() => ({
      check: jest.fn().mockResolvedValue(true),
      install: jest.fn(),
      destroy: mockDestroy,
    }));
    const mgr = new InstallationManager();
    mgr.createStages();
    mgr.destroy();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('sets stages back to null after destroy', () => {
    const mgr = new InstallationManager();
    mgr.createStages();
    mgr.destroy();
    expect(mgr.stages).toBeNull();
  });

  it('does not throw when stages is null (never initialised)', () => {
    const mgr = new InstallationManager();
    expect(() => mgr.destroy()).not.toThrow();
  });

  it('does not throw when a stage has no destroy method', () => {
    const pioNodeHelpers = require('pioarduino-node-helpers');
    pioNodeHelpers.installer.pioarduinoCoreStage.mockImplementationOnce(() => ({
      check: jest.fn().mockResolvedValue(true),
      install: jest.fn(),
      // no destroy method
    }));
    const mgr = new InstallationManager();
    mgr.createStages();
    expect(() => mgr.destroy()).not.toThrow();
  });
});
