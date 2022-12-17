/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { extension } from '../main';
import fs from 'fs';
import path from 'path';
import vscode from 'vscode';

export function isPIOProjectSync(projectDir) {
  try {
    fs.accessSync(path.join(projectDir, 'platformio.ini'));
    return true;
  } catch (err) {}
  return false;
}

export function getPIOProjectDirs() {
  return (vscode.workspace.workspaceFolders || [])
    .map((folder) => folder.uri.fsPath)
    .filter((projectDir) => isPIOProjectSync(projectDir));
}

export function getActiveEditorProjectDir() {
  const pioProjectDirs = getPIOProjectDirs();
  if (pioProjectDirs.length < 1) {
    return undefined;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const resource = editor.document.uri;
  if (resource.scheme !== 'file') {
    return undefined;
  }
  const folder = vscode.workspace.getWorkspaceFolder(resource);
  if (!folder || !isPIOProjectSync(folder.uri.fsPath)) {
    // outside workspace
    return undefined;
  }
  return folder.uri.fsPath;
}

export function getProjectItemState(projectDir, key) {
  const state = extension.context.globalState.get('projects', {})[projectDir];
  return (state || {})[key];
}

export function updateProjectItemState(projectDir, key, value) {
  const projects = extension.context.globalState.get('projects', {});
  if (!projects[projectDir]) {
    projects[projectDir] = {};
  }
  projects[projectDir][key] = value;

  // cleanup removed project
  for (const item of Object.keys(projects)) {
    if (!isPIOProjectSync(item)) {
      delete projects[item];
    }
  }

  extension.context.globalState.update('projects', projects);
  extension.context.globalState.update('lastProjectDir', projectDir);
}

export function getLastProjectDir() {
  return extension.context.globalState.get('lastProjectDir');
}
