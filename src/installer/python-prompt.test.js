/**
 * Unit tests for src/installer/python-prompt.js
 */

import PythonPrompt from './python-prompt';
import fs from 'fs-plus';
import vscode from 'vscode';

jest.mock('vscode', () => jest.requireActual('../../__mocks__/vscode'));

jest.mock('fs-plus', () => {
  const isFileSync = jest.fn();
  return { __esModule: true, default: { isFileSync }, isFileSync };
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function makePrompt() {
  return new PythonPrompt();
}

// ─── status constants ─────────────────────────────────────────────────────────

describe('PythonPrompt status constants', () => {
  it('defines STATUS_TRY_AGAIN as 0', () => {
    expect(makePrompt().STATUS_TRY_AGAIN).toBe(0);
  });

  it('defines STATUS_ABORT as 1', () => {
    expect(makePrompt().STATUS_ABORT).toBe(1);
  });

  it('defines STATUS_CUSTOMEXE as 2', () => {
    expect(makePrompt().STATUS_CUSTOMEXE).toBe(2);
  });
});

// ─── prompt — user dismisses / closes ────────────────────────────────────────

describe('PythonPrompt.prompt — dismiss / close', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns STATUS_TRY_AGAIN when the dialog is dismissed (undefined)', async () => {
    vscode.window.showInformationMessage = jest.fn().mockResolvedValue(undefined);
    const result = await makePrompt().prompt();
    expect(result).toEqual({ status: 0 });
  });

  it('returns STATUS_TRY_AGAIN when "Try again" is selected', async () => {
    vscode.window.showInformationMessage = jest
      .fn()
      .mockResolvedValue({ title: 'Try again' });
    const result = await makePrompt().prompt();
    expect(result).toEqual({ status: 0 });
  });
});

// ─── prompt — Install Python ──────────────────────────────────────────────────

describe('PythonPrompt.prompt — Install Python', () => {
  afterEach(() => jest.clearAllMocks());

  it('opens the Python install URL and returns STATUS_TRY_AGAIN', async () => {
    vscode.window.showInformationMessage = jest
      .fn()
      .mockResolvedValue({ title: 'Install Python' });
    vscode.commands.executeCommand = jest.fn();
    vscode.Uri.parse = jest.fn((url) => ({ toString: () => url }));

    const result = await makePrompt().prompt();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      expect.anything(),
    );
    // Falls through to default → STATUS_TRY_AGAIN
    expect(result).toEqual({ status: 0 });
  });
});

// ─── prompt — Abort ───────────────────────────────────────────────────────────

describe('PythonPrompt.prompt — Abort', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns STATUS_ABORT when "Abort pioarduino IDE Installation" is selected', async () => {
    vscode.window.showInformationMessage = jest
      .fn()
      .mockResolvedValue({ title: 'Abort pioarduino IDE Installation' });
    const result = await makePrompt().prompt();
    expect(result).toEqual({ status: 1 });
  });
});

// ─── prompt — I have Python ───────────────────────────────────────────────────

describe('PythonPrompt.prompt — I have Python', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns STATUS_CUSTOMEXE with the entered path when a valid path is given', async () => {
    vscode.window.showInformationMessage = jest
      .fn()
      .mockResolvedValue({ title: 'I have Python' });
    vscode.window.showInputBox = jest.fn().mockResolvedValue('/usr/bin/python3');
    fs.isFileSync.mockReturnValue(true);

    const result = await makePrompt().prompt();

    expect(result).toEqual({
      status: 2,
      pythonExecutable: '/usr/bin/python3',
    });
  });

  it('returns STATUS_TRY_AGAIN when the input box is cancelled (undefined)', async () => {
    vscode.window.showInformationMessage = jest
      .fn()
      .mockResolvedValue({ title: 'I have Python' });
    vscode.window.showInputBox = jest.fn().mockResolvedValue(undefined);

    const result = await makePrompt().prompt();

    expect(result).toEqual({ status: 0 });
  });

  it('returns STATUS_TRY_AGAIN when the input box is cancelled (empty string)', async () => {
    vscode.window.showInformationMessage = jest
      .fn()
      .mockResolvedValue({ title: 'I have Python' });
    vscode.window.showInputBox = jest.fn().mockResolvedValue('');

    const result = await makePrompt().prompt();

    expect(result).toEqual({ status: 0 });
  });

  it('passes a validateInput function that rejects invalid paths', async () => {
    vscode.window.showInformationMessage = jest
      .fn()
      .mockResolvedValue({ title: 'I have Python' });
    vscode.window.showInputBox = jest.fn().mockResolvedValue(undefined);
    fs.isFileSync.mockReturnValue(false);

    await makePrompt().prompt();

    const { validateInput } = vscode.window.showInputBox.mock.calls[0][0];
    expect(validateInput('/bad/path')).toBe('Invalid path to Python Interpreter');
  });

  it('passes a validateInput function that accepts valid paths', async () => {
    vscode.window.showInformationMessage = jest
      .fn()
      .mockResolvedValue({ title: 'I have Python' });
    vscode.window.showInputBox = jest.fn().mockResolvedValue(undefined);
    fs.isFileSync.mockReturnValue(true);

    await makePrompt().prompt();

    const { validateInput } = vscode.window.showInputBox.mock.calls[0][0];
    expect(validateInput('/usr/bin/python3')).toBeNull();
  });
});
