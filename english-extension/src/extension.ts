import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { openMainPanel, maybeAutoGenerateReading } from './panel';
import { refreshAlarms, configureAlarmsInteractive, installOSAlarms } from './alarms';

export function activate(context: vscode.ExtensionContext) {
  const ws = vscode.workspace.workspaceFolders?.[0];
  const dataRoot = ws?.uri.fsPath;

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
    vscode.commands.registerCommand('englishCatti.reading', () => {
      openMainPanel(context, 'reading');
    }),
    vscode.commands.registerCommand('englishCatti.configureAlarms', () => {
      configureAlarmsInteractive(context, dataRoot);
    }),
    vscode.commands.registerCommand('englishCatti.installOSAlarms', () => {
      installOSAlarms(dataRoot);
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
  if (ws && fs.existsSync(path.join(ws.uri.fsPath, 'data', 'unified_vocab.json'))) {
    // Delay slightly so it doesn't clash with restore-panel-state
    setTimeout(() => openMainPanel(context, 'learn'), 800);
    // Kick off background reading-corner generation so articles are ready
    // by the time the user opens the tab. Delay ~3s to let workspace settle.
    setTimeout(() => {
      maybeAutoGenerateReading(context, ws.uri.fsPath).catch((e) =>
        console.warn('maybeAutoGenerateReading failed:', e));
    }, 3000);
  }

  // Schedule daily VS Code-internal alarms. Refires whenever the user changes
  // englishCatti.alarms.* settings.
  refreshAlarms(context, dataRoot);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('englishCatti.alarms')) {
        refreshAlarms(context, dataRoot);
      }
    })
  );

  console.log('English CATTI extension activated.');
}

export function deactivate() {
  console.log('English CATTI extension deactivated.');
}
