/**
 * Mock for the vscode module used in unit tests.
 */

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(a, b, c, d) {
    if (typeof a === 'object' && typeof b === 'object' && c === undefined) {
      this.start = a;
      this.end = b;
    } else {
      this.start = new Position(a, b);
      this.end = new Position(c, d);
    }
  }
}

class Uri {
  static file(path) {
    return { fsPath: path, scheme: 'file' };
  }
  static parse(uri) {
    return { fsPath: uri, scheme: 'file' };
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}
ThemeIcon.Folder = new ThemeIcon('folder');

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
};

const TaskGroup = {
  Build: { id: 'build' },
  Clean: { id: 'clean' },
  Test: { id: 'test' },
};

const TaskPanelKind = {
  Shared: 1,
  Dedicated: 2,
  New: 3,
};

const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

const ProgressLocation = {
  Notification: 15,
  Window: 10,
};

const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

const TestRunProfileKind = {
  Run: 1,
  Debug: 2,
  Coverage: 3,
};

class MarkdownString {
  constructor(value = '') {
    this.value = value;
  }
  appendCodeblock(value, language) {
    this.value += '```' + language + '\n' + value + '\n```\n';
  }
  appendMarkdown(value) {
    this.value += value;
  }
}

class Hover {
  constructor(contents) {
    this.contents = contents;
  }
}

class Location {
  constructor(uri, range) {
    this.uri = uri;
    this.range = range;
  }
}

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

class InlineCompletionItem {
  constructor(text) {
    this.text = text;
  }
}

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

class TestMessage {
  constructor(message) {
    this.message = message;
  }
}

class TestController {
  constructor() {
    this.items = {
      replace: jest.fn(),
      add: jest.fn(),
      forEach: jest.fn(),
    };
    this.createTestItem = jest.fn((id, label, uri) => ({ id, label, uri, children: { replace: jest.fn(), add: jest.fn(), forEach: jest.fn() } }));
    this.createTestRun = jest.fn(() => ({
      started: jest.fn(),
      skipped: jest.fn(),
      failed: jest.fn(),
      passed: jest.fn(),
      appendOutput: jest.fn(),
      end: jest.fn(),
    }));
  }
}

const languages = {
  createDiagnosticCollection: jest.fn(() => ({ clear: jest.fn(), set: jest.fn() })),
  registerHoverProvider: jest.fn(() => ({ dispose: jest.fn() })),
  registerCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
};

const workspace = {
  workspaceFolders: undefined,
  onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidSaveTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
  onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
  createFileSystemWatcher: jest.fn(() => ({ dispose: jest.fn() })),
  getWorkspaceFolder: jest.fn(),
};

const window = {
  activeTextEditor: undefined,
  visibleTextEditors: [],
  showTextDocument: jest.fn(),
  showErrorMessage: jest.fn(),
  showQuickPick: jest.fn(),
  showInputBox: jest.fn(),
  withProgress: jest.fn(async (options, task) => {
    const progress = { report: jest.fn() };
    const token = { isCancellationRequested: false };
    return task(progress, token);
  }),
  createOutputChannel: jest.fn(() => ({ append: jest.fn(), appendLine: jest.fn(), clear: jest.fn() })),
  createStatusBarItem: jest.fn(() => ({ show: jest.fn(), hide: jest.fn(), dispose: jest.fn() })),
  createTreeView: jest.fn(() => ({ dispose: jest.fn(), onDidExpandElement: jest.fn(() => ({ dispose: jest.fn() })) })),
};

const commands = {
  registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
  executeCommand: jest.fn(),
};

const tests = {
  createTestController: jest.fn(() => new TestController()),
};

const extensions = {
  getExtension: jest.fn(),
};

module.exports = {
  Position,
  Range,
  Uri,
  Location,
  TreeItem,
  ThemeIcon,
  TreeItemCollapsibleState,
  CompletionItemKind,
  TaskGroup,
  TaskPanelKind,
  StatusBarAlignment,
  ProgressLocation,
  DiagnosticSeverity,
  TestRunProfileKind,
  MarkdownString,
  Hover,
  CompletionItem,
  InlineCompletionItem,
  Diagnostic,
  TestMessage,
  languages,
  workspace,
  window,
  commands,
  tests,
  extensions,
  version: '1.95.0',
};
