import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { openMainPanel } from './panel';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('englishCatti.open', () => {
      openMainPanel(context, 'browse');
    }),
    vscode.commands.registerCommand('englishCatti.learn', () => {
      openMainPanel(context, 'learn');
    }),
    vscode.commands.registerCommand('englishCatti.review', () => {
      openMainPanel(context, 'review');
    }),
    vscode.commands.registerCommand('englishCatti.stats', () => {
      openMainPanel(context, 'stats');
    }),
  );

  // Status bar item — one-click open.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(book) CATTI';
  statusBar.tooltip = 'English CATTI: Open Vocabulary Trainer (Ctrl+Alt+E)';
  statusBar.command = 'englishCatti.open';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Auto-open panel if this workspace has our data files.
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (ws && fs.existsSync(path.join(ws.uri.fsPath, 'data', 'unified_vocab.json'))) {
    // Delay slightly so it doesn't clash with restore-panel-state
    setTimeout(() => openMainPanel(context, 'learn'), 800);
  }

  console.log('English CATTI extension activated.');
}

export function deactivate() {
  console.log('English CATTI extension deactivated.');
}
