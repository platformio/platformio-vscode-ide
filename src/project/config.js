/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as pioNodeHelpers from 'platformio-node-helpers';

import { disposeSubscriptions, listCoreSerialPorts } from '../utils';
import vscode from 'vscode';

export class ProjectConfigLanguageProvider {
  static DOCUMENT_SELECTOR = { language: 'ini' };
  SCOPE_PLATFORMIO = 'platformio';
  SCOPE_ENV = 'env';

  constructor(projectDir) {
    this.projectDir = projectDir;
    this.subscriptions = [
      vscode.languages.registerHoverProvider(
        ProjectConfigLanguageProvider.DOCUMENT_SELECTOR,
        {
          provideHover: async (document, position) =>
            await this.provideHover(document, position),
        }
      ),
      vscode.languages.registerCompletionItemProvider(
        ProjectConfigLanguageProvider.DOCUMENT_SELECTOR,
        {
          provideCompletionItems: async (document, position, token, context) =>
            await this.provideCompletionItems(document, position, token, context),
        }
      ),
    ];
    // if (vscode.languages.registerInlineCompletionItemProvider) {
    //   this.subscriptions.push(
    //     vscode.languages.registerInlineCompletionItemProvider(
    //       ProjectConfigLanguageProvider.DOCUMENT_SELECTOR,
    //       {
    //         provideInlineCompletionItems: async (document, position) =>
    //           await this.provideCompletionItems(document, position, true),
    //       }
    //     )
    //   );
    // }
    this._options = undefined;
    this._ports = undefined;
  }

  dispose() {
    disposeSubscriptions(this.subscriptions);
  }

  async getOptions() {
    if (this._options) {
      return this._options;
    }
    const script = `
import json
try:
  from platformio.public import get_config_options_schema
except ImportError:
  from platformio.project.options import get_config_options_schema

print(json.dumps(get_config_options_schema()))
  `;
    const output = await pioNodeHelpers.core.getCorePythonCommandOutput(
      ['-c', script],
      { projectDir: this.projectDir }
    );
    this._options = JSON.parse(output.trim());
    return this._options;
  }

  renderOptionDocs(option) {
    const attrs = [
      ['Name', option.name],
      ['Group', option.group],
      ['Type', option.type],
      ['Multiple', option.multiple ? 'yes' : 'no'],
    ];
    if (option.sysenvvar) {
      attrs.push(['EnvironmentVariable', option.sysenvvar]);
    }
    if (option.type === 'choice') {
      attrs.push(['Choices', option.choices.join(', ')]);
    }
    if (option.min !== undefined) {
      attrs.push(['Minimum', option.min]);
    }
    if (option.max !== undefined) {
      attrs.push(['Maximum', option.max]);
    }
    if (option.default !== null || option.type === 'boolean') {
      let value = option.default;
      if (option.type === 'boolean') {
        value = option.default ? 'yes' : 'no';
      } else if (option.multiple && Array.isArray(option.default)) {
        value = option.default.join(', ');
      }
      attrs.push(['Default', value]);
    }
    const docs = new vscode.MarkdownString();
    docs.appendCodeblock(
      attrs.map(([name, value]) => `${name} = ${value}`).join('\n'),
      'ini'
    );
    docs.appendMarkdown(`
${option.description}

[View documentation](https://docs.platformio.org/en/latest/projectconf/sections/${option.scope}/options/${option.group}/${option.name}.html?utm_source=vscode&utm_medium=completion)
`);
    return docs;
  }

  getScopeAt(document, position) {
    const text = document.getText(
      new vscode.Range(new vscode.Position(0, 0), position)
    );
    for (const line of text.split('\n').reverse()) {
      if (line.startsWith('[platformio]')) {
        return this.SCOPE_PLATFORMIO;
      } else if (line.startsWith('[env]') || line.startsWith('[env:')) {
        return this.SCOPE_ENV;
      }
    }
    return undefined;
  }

  async getOptionAt(document, position) {
    for (let lineNum = position.line; lineNum > 0; lineNum--) {
      const line = document.lineAt(lineNum).text;
      if (line.startsWith(' ') || line.startsWith('\t')) {
        continue;
      }
      const optionName = line.split('=')[0].trim();
      return (await this.getOptions()).find((option) => option.name === optionName);
    }
  }

  isOptionValueLocation(document, position) {
    const line = document.lineAt(position.line).text;
    const sepPos = line.indexOf('=');
    return (
      line.startsWith(' ') ||
      line.startsWith('\t') ||
      (sepPos > 0 && position.character > sepPos)
    );
  }

  async provideHover(document, position) {
    const word = document.getText(document.getWordRangeAtPosition(position));
    const option = (await this.getOptions()).find((option) => option.name === word);
    if (option) {
      return new vscode.Hover(this.renderOptionDocs(option));
    }
    return this.providePackageHover(document, position);
  }

  async providePackageHover(document, position) {
    const line = document.lineAt(position.line).text;
    let rawValue = undefined;
    if (line.startsWith(' ') || line.startsWith('\t')) {
      rawValue = line;
    } else if (line.includes('=')) {
      rawValue = line.split('=', 2)[1];
    }
    if (!rawValue) {
      return;
    }
    const pkgRegExp = /^(([a-z\d_\-]+)\/)?([a-z\d\_\- ]+)/i;
    const matches = pkgRegExp.exec(rawValue.trim());
    if (!matches) {
      return;
    }

    const option = await this.getOptionAt(document, position);
    if (!['platform', 'lib_deps'].includes(option.name)) {
      return;
    }

    const pkgOwner = matches[2];
    const pkgName = matches[3];
    const pkgUrlParts = ['https://registry.platformio.org'];
    if (pkgOwner) {
      pkgUrlParts.push(option.name === 'platform' ? 'platforms' : 'libraries');
      pkgUrlParts.push(pkgOwner.trim(), encodeURIComponent(pkgName.trim()));
    } else {
      const qs = new URLSearchParams();
      qs.set('t', option.group);
      qs.set('q', `name:"${pkgName.trim()}"`);
      pkgUrlParts.push(`search?${qs.toString()}`);
    }

    return new vscode.Hover(
      new vscode.MarkdownString(
        `[Open in PlatformIO Registry](${pkgUrlParts.join('/')})`
      )
    );
  }

  async provideCompletionItems(document, position, token, context, isInline = false) {
    if (token.isCancellationRequested) {
      return;
    }
    return await (this.isOptionValueLocation(document, position)
      ? this.provideCompletionValues(document, position, isInline)
      : this.provideCompletionOptions(document, position, isInline));
  }

  async provideCompletionOptions(document, position, isInline = false) {
    const scope = this.getScopeAt(document, position);
    if (!scope) {
      return;
    }
    const options = await this.getOptions();
    return options
      .filter((option) => option.scope === scope)
      .map((option) => {
        if (isInline) {
          return new vscode.InlineCompletionItem(option.name);
        }
        const item = new vscode.CompletionItem(
          option.name,
          vscode.CompletionItemKind.Field
        );
        item.documentation = this.renderOptionDocs(option);
        return item;
      });
  }

  async provideCompletionValues(document, position) {
    const option = await this.getOptionAt(document, position);
    if (!option) {
      return;
    }
    switch (option.name) {
      case 'upload_port':
      case 'monitor_port':
      case 'test_port':
        return await this.provideCompletionPorts();

      case 'upload_speed':
      case 'monitor_speed':
      case 'test_speed':
        return await this.provideCompletionBaudrates(option);
    }
    return this.provideTypedCompletionValues(option);
  }

  async provideTypedCompletionValues(option) {
    const values = [];
    let defaultValue = option.default;
    switch (option.type) {
      case 'boolean':
        values.push('yes', 'no');
        defaultValue = option.default ? 'yes' : 'no';
        break;
      case 'choice':
        option.choices.forEach((item) => values.push(item));
        break;

      case 'integer range':
        for (let i = option.min; i <= option.max; i++) {
          values.push(i);
        }
        break;
    }
    return values.map((value) => {
      const item = new vscode.CompletionItem(
        value.toString(),
        vscode.CompletionItemKind.EnumMember
      );
      item.preselect = defaultValue === value;
      return item;
    });
  }

  createCustomCompletionValueItem() {
    const item = new vscode.CompletionItem('Custom', vscode.CompletionItemKind.Value);
    item.insertText = '';
    item.sortText = 'Z';
    return item;
  }

  async provideCompletionPorts() {
    if (!this._ports) {
      this._ports = await listCoreSerialPorts();
      setTimeout(() => (this._ports = undefined), 3000);
    }
    const items = (this._ports || []).map((port) => {
      const item = new vscode.CompletionItem(
        port.port,
        vscode.CompletionItemKind.Value
      );
      item.detail = port.description;
      item.documentation = port.hwid;
      return item;
    });
    items.push(this.createCustomCompletionValueItem());
    return items;
  }

  async provideCompletionBaudrates(option) {
    const values = [
      600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 115200, 230400,
    ];
    const items = values.map((value, index) => {
      const item = new vscode.CompletionItem(
        value.toString(),
        vscode.CompletionItemKind.Value
      );
      item.sortText = String.fromCharCode(index + 65);
      item.preselect = option.default === value;
      return item;
    });
    items.push(this.createCustomCompletionValueItem());
    return items;
  }
}
