/**
 * Unit tests for src/project/config.js
 */

import * as pioNodeHelpers from 'pioarduino-node-helpers';
import { ProjectConfigLanguageProvider } from './config';
import { listCoreSerialPorts } from '../utils';
import vscode from 'vscode';

jest.mock('vscode', () => jest.requireActual('../../__mocks__/vscode'));

jest.mock('pioarduino-node-helpers', () => ({
  core: {
    getCorePythonCommandOutput: jest.fn(),
  },
}));

jest.mock('../utils', () => ({
  disposeSubscriptions: jest.fn(),
  listCoreSerialPorts: jest.fn(),
}));

function makeDocument(lines, uriPath = '/workspace/project/platformio.ini') {
  const fullText = lines.join('\n');
  return {
    uri: vscode.Uri.file(uriPath),
    getText: jest.fn((range) => {
      if (!range) {
        return fullText;
      }
      const lineStarts = [];
      let offset = 0;
      for (const line of lines) {
        lineStarts.push(offset);
        offset += line.length + 1; // +1 for newline
      }
      const startOffset = lineStarts[range.start.line] + range.start.character;
      const endOffset = lineStarts[range.end.line] + range.end.character;
      return fullText.substring(startOffset, endOffset);
    }),
    lineAt: jest.fn((lineNum) => ({ text: lines[lineNum] || '' })),
    getWordRangeAtPosition: jest.fn((position) => {
      const line = lines[position.line] || '';
      const word = line.split(/\s|=/)[0];
      return new vscode.Range(position.line, 0, position.line, word.length);
    }),
  };
}

describe('ProjectConfigLanguageProvider', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('registers providers and creates diagnostic collection', () => {
      const provider = new ProjectConfigLanguageProvider();
      expect(vscode.languages.createDiagnosticCollection).toHaveBeenCalledWith(
        'PlatformIO',
      );
      expect(vscode.languages.registerHoverProvider).toHaveBeenCalled();
      expect(vscode.languages.registerCompletionItemProvider).toHaveBeenCalled();
      expect(vscode.workspace.onDidOpenTextDocument).toHaveBeenCalled();
      expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalled();
      expect(provider.subscriptions).toHaveLength(5);
      expect(provider._optionsCache instanceof Map).toBe(true);
    });
  });

  describe('dispose', () => {
    it('clears subscriptions and cache', () => {
      const provider = new ProjectConfigLanguageProvider();
      provider.dispose();
      expect(provider._optionsCache.size).toBe(0);
    });
  });

  describe('getOptions', () => {
    it('fetches options from PIO and caches the result', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const options = [{ name: 'board', scope: 'env' }];
      pioNodeHelpers.core.getCorePythonCommandOutput.mockResolvedValue(
        JSON.stringify(options),
      );
      const doc = makeDocument(['[env]', 'board = uno']);
      const result1 = await provider.getOptions(doc);
      const result2 = await provider.getOptions(doc);
      expect(result1).toEqual(options);
      expect(result2).toBe(result1); // same reference — cache hit
      expect(pioNodeHelpers.core.getCorePythonCommandOutput).toHaveBeenCalledTimes(1);
    });

    it('uses a separate cache entry per document path', async () => {
      const provider = new ProjectConfigLanguageProvider();
      pioNodeHelpers.core.getCorePythonCommandOutput.mockResolvedValue(
        JSON.stringify([]),
      );
      const doc1 = makeDocument(['[env]'], '/workspace/proj1/platformio.ini');
      const doc2 = makeDocument(['[env]'], '/workspace/proj2/platformio.ini');
      await provider.getOptions(doc1);
      await provider.getOptions(doc2);
      expect(pioNodeHelpers.core.getCorePythonCommandOutput).toHaveBeenCalledTimes(2);
    });
  });

  describe('renderOptionDocs', () => {
    it('renders basic option attributes', () => {
      const provider = new ProjectConfigLanguageProvider();
      const option = {
        name: 'upload_port',
        group: 'upload',
        type: 'string',
        multiple: false,
        description: 'Upload port description',
        scope: 'env',
      };
      const docs = provider.renderOptionDocs(option);
      expect(docs.value).toContain('Name = upload_port');
      expect(docs.value).toContain('Group = upload');
      expect(docs.value).toContain('Type = string');
      expect(docs.value).toContain('Multiple = no');
      expect(docs.value).toContain('Upload port description');
    });

    it('renders choice options with choices', () => {
      const provider = new ProjectConfigLanguageProvider();
      const option = {
        name: 'board',
        group: 'env',
        type: 'choice',
        choices: ['uno', 'nano'],
        multiple: false,
        description: 'Board',
        scope: 'env',
        default: 'uno',
      };
      const docs = provider.renderOptionDocs(option);
      expect(docs.value).toContain('Choices = uno, nano');
      expect(docs.value).toContain('Default = uno');
    });

    it('renders boolean option with yes/no default', () => {
      const provider = new ProjectConfigLanguageProvider();
      const option = {
        name: 'build_flags',
        group: 'build',
        type: 'boolean',
        multiple: false,
        description: 'Build flags',
        scope: 'env',
        default: true,
      };
      const docs = provider.renderOptionDocs(option);
      expect(docs.value).toContain('Default = yes');
    });

    it('renders integer range with min/max', () => {
      const provider = new ProjectConfigLanguageProvider();
      const option = {
        name: 'upload_speed',
        group: 'upload',
        type: 'integer range',
        multiple: false,
        description: 'Speed',
        scope: 'env',
        min: 9600,
        max: 115200,
      };
      const docs = provider.renderOptionDocs(option);
      expect(docs.value).toContain('Minimum = 9600');
      expect(docs.value).toContain('Maximum = 115200');
    });

    it('includes sysenvvar when present', () => {
      const provider = new ProjectConfigLanguageProvider();
      const option = {
        name: 'custom_path',
        group: 'env',
        type: 'string',
        multiple: false,
        description: 'Path',
        scope: 'env',
        sysenvvar: 'PLATFORMIO_PATH',
      };
      const docs = provider.renderOptionDocs(option);
      expect(docs.value).toContain('EnvironmentVariable = PLATFORMIO_PATH');
    });
  });

  describe('getScopeAt', () => {
    it('returns platformio scope inside [platformio] section', () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument(['[platformio]', 'default_envs = dev']);
      const pos = new vscode.Position(1, 0);
      expect(provider.getScopeAt(doc, pos)).toBe(provider.SCOPE_PLATFORMIO);
    });

    it('returns env scope inside [env] section', () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument(['[env]', 'board = uno']);
      const pos = new vscode.Position(1, 0);
      expect(provider.getScopeAt(doc, pos)).toBe(provider.SCOPE_ENV);
    });

    it('returns env scope inside [env:myenv] section', () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument(['[env:myenv]', 'board = uno']);
      const pos = new vscode.Position(1, 0);
      expect(provider.getScopeAt(doc, pos)).toBe(provider.SCOPE_ENV);
    });

    it('returns undefined before any section', () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument(['; comment', '']);
      const pos = new vscode.Position(1, 0);
      expect(provider.getScopeAt(doc, pos)).toBeUndefined();
    });
  });

  describe('getOptionAt', () => {
    it('returns the option whose name matches the key on the current line', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const options = [
        { name: 'board', scope: 'env' },
        { name: 'upload_port', scope: 'env' },
      ];
      provider.getOptions = jest.fn().mockResolvedValue(options);
      const doc = makeDocument(['[env]', 'board = uno']);
      const pos = new vscode.Position(1, 5);
      const result = await provider.getOptionAt(doc, pos);
      expect(result.name).toBe('board');
    });

    it('walks back past continuation lines to find the option key', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const options = [{ name: 'lib_deps', scope: 'env' }];
      provider.getOptions = jest.fn().mockResolvedValue(options);
      // Line 0: section header, line 1: key, line 2: continuation (starts with space)
      // getOptionAt loops from position.line down to lineNum > 0, so the key
      // must be on line >= 1 for the loop to reach it.
      const doc = makeDocument(['[env]', 'lib_deps =', '  SomeLib']);
      const pos = new vscode.Position(2, 2);
      const result = await provider.getOptionAt(doc, pos);
      expect(result.name).toBe('lib_deps');
    });
  });

  describe('isOptionValueLocation', () => {
    it('returns true when line starts with space', () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument([' board = uno']);
      const pos = new vscode.Position(0, 5);
      expect(provider.isOptionValueLocation(doc, pos)).toBe(true);
    });

    it('returns true when line starts with tab', () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument(['\tboard = uno']);
      const pos = new vscode.Position(0, 5);
      expect(provider.isOptionValueLocation(doc, pos)).toBe(true);
    });

    it('returns true when cursor is after =', () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument(['board = uno']);
      const pos = new vscode.Position(0, 8);
      expect(provider.isOptionValueLocation(doc, pos)).toBe(true);
    });

    it('returns false when cursor is before =', () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument(['board = uno']);
      const pos = new vscode.Position(0, 3);
      expect(provider.isOptionValueLocation(doc, pos)).toBe(false);
    });
  });

  describe('provideHover', () => {
    it('returns Hover when word matches an option', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const options = [
        {
          name: 'upload_port',
          group: 'upload',
          type: 'string',
          multiple: false,
          description: 'Port',
          scope: 'env',
        },
      ];
      provider.getOptions = jest.fn().mockResolvedValue(options);
      const doc = makeDocument(['[env]', 'upload_port = /dev/ttyUSB0']);
      const pos = new vscode.Position(1, 0);
      const result = await provider.provideHover(doc, pos);
      expect(result).toBeInstanceOf(vscode.Hover);
      expect(result.contents.value).toContain('upload_port');
    });

    it('falls through to package hover for unmatched words', async () => {
      const provider = new ProjectConfigLanguageProvider();
      provider.getOptions = jest.fn().mockResolvedValue([]);
      provider.getOptionAt = jest
        .fn()
        .mockResolvedValue({ name: 'upload_port', group: 'upload' });
      const doc = makeDocument(['[env]', 'platform = espressif32']);
      const pos = new vscode.Position(1, 0);
      const result = await provider.provideHover(doc, pos);
      // providePackageHover returns undefined because upload_port is not a package option
      expect(result).toBeUndefined();
    });
  });

  describe('providePackageHover', () => {
    it('returns undefined for non-package options', async () => {
      const provider = new ProjectConfigLanguageProvider();
      provider.getOptionAt = jest
        .fn()
        .mockResolvedValue({ name: 'upload_port', group: 'upload' });
      const doc = makeDocument(['[env]', 'upload_port = /dev/ttyUSB0']);
      const pos = new vscode.Position(1, 5);
      const result = await provider.providePackageHover(doc, pos);
      expect(result).toBeUndefined();
    });

    it('returns registry link for platform option with owner/name', async () => {
      const provider = new ProjectConfigLanguageProvider();
      provider.getOptionAt = jest
        .fn()
        .mockResolvedValue({ name: 'platform', group: 'platform' });
      const doc = makeDocument(['[env]', 'platform = espressif32']);
      const pos = new vscode.Position(1, 5);
      const result = await provider.providePackageHover(doc, pos);
      expect(result).toBeInstanceOf(vscode.Hover);
      expect(result.contents.value).toContain('registry.platformio.org');
    });

    it('returns registry link for lib_deps with owner/name', async () => {
      const provider = new ProjectConfigLanguageProvider();
      provider.getOptionAt = jest
        .fn()
        .mockResolvedValue({ name: 'lib_deps', group: 'lib' });
      const doc = makeDocument(['[env]', 'lib_deps = knolleary/PubSubClient']);
      const pos = new vscode.Position(1, 5);
      const result = await provider.providePackageHover(doc, pos);
      expect(result).toBeInstanceOf(vscode.Hover);
      expect(result.contents.value).toContain('libraries');
      expect(result.contents.value).toContain('knolleary');
    });

    it('returns search link for platform without owner', async () => {
      const provider = new ProjectConfigLanguageProvider();
      provider.getOptionAt = jest
        .fn()
        .mockResolvedValue({ name: 'platform', group: 'platform' });
      const doc = makeDocument(['[env]', 'platform = some-platform']);
      const pos = new vscode.Position(1, 5);
      const result = await provider.providePackageHover(doc, pos);
      expect(result).toBeInstanceOf(vscode.Hover);
      expect(result.contents.value).toContain('search?');
    });

    it('returns undefined when line has no value', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument(['[env]', 'platform']);
      const pos = new vscode.Position(1, 0);
      const result = await provider.providePackageHover(doc, pos);
      expect(result).toBeUndefined();
    });
  });

  describe('provideCompletionItems', () => {
    it('returns undefined immediately when cancellation is requested', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument(['[env]', 'board = uno']);
      const pos = new vscode.Position(1, 0);
      const token = { isCancellationRequested: true };
      const result = await provider.provideCompletionItems(doc, pos, token, {});
      expect(result).toBeUndefined();
    });

    it('delegates to provideCompletionValues when at a value location', async () => {
      const provider = new ProjectConfigLanguageProvider();
      provider.isOptionValueLocation = jest.fn().mockReturnValue(true);
      provider.provideCompletionValues = jest.fn().mockResolvedValue([]);
      const doc = makeDocument(['[env]', 'board = uno']);
      const pos = new vscode.Position(1, 8);
      const token = { isCancellationRequested: false };
      await provider.provideCompletionItems(doc, pos, token, {});
      expect(provider.provideCompletionValues).toHaveBeenCalled();
    });

    it('delegates to provideCompletionOptions when at a key location', async () => {
      const provider = new ProjectConfigLanguageProvider();
      provider.isOptionValueLocation = jest.fn().mockReturnValue(false);
      provider.provideCompletionOptions = jest.fn().mockResolvedValue([]);
      const doc = makeDocument(['[env]', 'board']);
      const pos = new vscode.Position(1, 3);
      const token = { isCancellationRequested: false };
      await provider.provideCompletionItems(doc, pos, token, {});
      expect(provider.provideCompletionOptions).toHaveBeenCalled();
    });
  });

  describe('provideCompletionOptions', () => {
    it('returns completion items scoped to current section', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const options = [
        {
          name: 'upload_port',
          group: 'upload',
          type: 'string',
          multiple: false,
          description: 'Port',
          scope: 'env',
        },
        {
          name: 'description',
          group: 'platformio',
          type: 'string',
          multiple: false,
          description: 'Desc',
          scope: 'platformio',
        },
      ];
      provider.getOptions = jest.fn().mockResolvedValue(options);
      const doc = makeDocument(['[env]', '']);
      const pos = new vscode.Position(1, 0);
      const result = await provider.provideCompletionOptions(doc, pos);
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('upload_port');
    });

    it('returns inline completion items when isInline is true', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const options = [
        {
          name: 'upload_port',
          group: 'upload',
          type: 'string',
          multiple: false,
          description: 'Port',
          scope: 'env',
        },
      ];
      provider.getOptions = jest.fn().mockResolvedValue(options);
      const doc = makeDocument(['[env]', '']);
      const pos = new vscode.Position(1, 0);
      const result = await provider.provideCompletionOptions(doc, pos, true);
      expect(result[0].text).toBe('upload_port');
    });

    it('returns undefined when outside any section', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const doc = makeDocument(['; comment', '']);
      const pos = new vscode.Position(1, 0);
      const result = await provider.provideCompletionOptions(doc, pos);
      expect(result).toBeUndefined();
    });
  });

  describe('provideCompletionValues', () => {
    it('routes upload_port to provideCompletionPorts', async () => {
      const provider = new ProjectConfigLanguageProvider();
      provider.getOptionAt = jest.fn().mockResolvedValue({ name: 'upload_port' });
      provider.provideCompletionPorts = jest.fn().mockResolvedValue([]);
      const doc = makeDocument(['[env]', 'upload_port = ']);
      const pos = new vscode.Position(1, 13);
      await provider.provideCompletionValues(doc, pos);
      expect(provider.provideCompletionPorts).toHaveBeenCalled();
    });

    it('routes monitor_speed to provideCompletionBaudrates', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const option = { name: 'monitor_speed', default: 115200 };
      provider.getOptionAt = jest.fn().mockResolvedValue(option);
      provider.provideCompletionBaudrates = jest.fn().mockResolvedValue([]);
      const doc = makeDocument(['[env]', 'monitor_speed = ']);
      const pos = new vscode.Position(1, 15);
      await provider.provideCompletionValues(doc, pos);
      expect(provider.provideCompletionBaudrates).toHaveBeenCalledWith(option);
    });

    it('routes other options to provideTypedCompletionValues', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const option = {
        name: 'build_type',
        type: 'choice',
        choices: ['release', 'debug'],
        default: 'release',
      };
      provider.getOptionAt = jest.fn().mockResolvedValue(option);
      provider.provideTypedCompletionValues = jest.fn().mockResolvedValue([]);
      const doc = makeDocument(['[env]', 'build_type = ']);
      const pos = new vscode.Position(1, 12);
      await provider.provideCompletionValues(doc, pos);
      expect(provider.provideTypedCompletionValues).toHaveBeenCalledWith(option);
    });

    it('returns undefined when no option is found at position', async () => {
      const provider = new ProjectConfigLanguageProvider();
      provider.getOptionAt = jest.fn().mockResolvedValue(undefined);
      const doc = makeDocument(['[env]', '']);
      const pos = new vscode.Position(1, 0);
      const result = await provider.provideCompletionValues(doc, pos);
      expect(result).toBeUndefined();
    });
  });

  describe('provideTypedCompletionValues', () => {
    it('returns yes/no for boolean type', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const result = await provider.provideTypedCompletionValues({
        type: 'boolean',
        default: true,
      });
      const labels = result.map((item) => item.label);
      expect(labels).toEqual(['yes', 'no']);
      expect(result.find((i) => i.label === 'yes').preselect).toBe(true);
    });

    it('returns choices for choice type', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const result = await provider.provideTypedCompletionValues({
        type: 'choice',
        choices: ['uno', 'nano'],
        default: 'uno',
      });
      const labels = result.map((item) => item.label);
      expect(labels).toEqual(['uno', 'nano']);
      expect(result.find((i) => i.label === 'uno').preselect).toBe(true);
    });

    it('returns integer range values', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const result = await provider.provideTypedCompletionValues({
        type: 'integer range',
        min: 1,
        max: 3,
      });
      const labels = result.map((item) => item.label);
      expect(labels).toEqual(['1', '2', '3']);
    });

    it('returns empty array for unknown type', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const result = await provider.provideTypedCompletionValues({
        type: 'string',
      });
      expect(result).toEqual([]);
    });
  });

  describe('createCustomCompletionValueItem', () => {
    it('returns Custom completion item', () => {
      const provider = new ProjectConfigLanguageProvider();
      const item = provider.createCustomCompletionValueItem();
      expect(item.label).toBe('Custom');
      expect(item.insertText).toBe('');
      expect(item.sortText).toBe('Z');
    });
  });

  describe('provideCompletionBaudrates', () => {
    it('returns baud rate items with preselect', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const result = await provider.provideCompletionBaudrates({ default: 115200 });
      expect(result.length).toBe(13); // 12 rates + Custom
      expect(result[0].label).toBe('600');
      expect(result.find((i) => i.label === '115200').preselect).toBe(true);
      expect(result[result.length - 1].label).toBe('Custom');
    });
  });

  describe('provideCompletionPorts', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns port items with custom entry', async () => {
      const provider = new ProjectConfigLanguageProvider();
      listCoreSerialPorts.mockResolvedValue([
        { port: 'COM3', description: 'USB Serial', hwid: '1234' },
      ]);
      const result = await provider.provideCompletionPorts();
      expect(result).toHaveLength(2);
      expect(result[0].label).toBe('COM3');
      expect(result[0].detail).toBe('USB Serial');
      expect(result[1].label).toBe('Custom');
    });

    it('caches ports for 3 seconds', async () => {
      const provider = new ProjectConfigLanguageProvider();
      listCoreSerialPorts.mockResolvedValue([
        { port: 'COM3', description: 'USB Serial', hwid: '1234' },
      ]);
      await provider.provideCompletionPorts();
      await provider.provideCompletionPorts();
      expect(listCoreSerialPorts).toHaveBeenCalledTimes(1);
    });
  });

  describe('lintConfig', () => {
    it('ignores non-platformio.ini files', async () => {
      const provider = new ProjectConfigLanguageProvider();
      const uri = vscode.Uri.file('/workspace/project/other.ini');
      const result = await provider.lintConfig(uri);
      expect(result).toBeUndefined();
    });

    it('sets warnings and errors on diagnostics', async () => {
      const provider = new ProjectConfigLanguageProvider();
      pioNodeHelpers.core.getCorePythonCommandOutput.mockResolvedValue(
        JSON.stringify({
          errors: [{ message: 'Missing env', lineno: 2 }],
          warnings: ['Old syntax'],
        }),
      );
      const uri = vscode.Uri.file('/workspace/project/platformio.ini');
      const result = await provider.lintConfig(uri);
      expect(result).toBe(false);
      expect(provider.diagnosticCollection.set).toHaveBeenCalledTimes(2);
    });

    it('returns true when no errors', async () => {
      const provider = new ProjectConfigLanguageProvider();
      pioNodeHelpers.core.getCorePythonCommandOutput.mockResolvedValue(
        JSON.stringify({ errors: [], warnings: [] }),
      );
      const uri = vscode.Uri.file('/workspace/project/platformio.ini');
      const result = await provider.lintConfig(uri);
      expect(result).toBe(true);
    });

    it('maps errors to absolute source file path when provided', async () => {
      const provider = new ProjectConfigLanguageProvider();
      pioNodeHelpers.core.getCorePythonCommandOutput.mockResolvedValue(
        JSON.stringify({
          errors: [{ message: 'Bad value', lineno: 5, source: '/abs/path/extra.ini' }],
          warnings: [],
        }),
      );
      const uri = vscode.Uri.file('/workspace/project/platformio.ini');
      await provider.lintConfig(uri);
      const calls = provider.diagnosticCollection.set.mock.calls;
      // Should have been called with the absolute source URI
      const sourceCall = calls.find(([u]) => u.fsPath === '/abs/path/extra.ini');
      expect(sourceCall).toBeDefined();
    });

    it('maps errors to relative source file resolved against projectDir', async () => {
      const provider = new ProjectConfigLanguageProvider();
      pioNodeHelpers.core.getCorePythonCommandOutput.mockResolvedValue(
        JSON.stringify({
          errors: [{ message: 'Bad value', lineno: 5, source: 'extra.ini' }],
          warnings: [],
        }),
      );
      const uri = vscode.Uri.file('/workspace/project/platformio.ini');
      await provider.lintConfig(uri);
      expect(provider.diagnosticCollection.set).toHaveBeenCalled();
    });
  });
});
