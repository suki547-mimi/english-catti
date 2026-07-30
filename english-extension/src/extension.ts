import * as vscode from 'vscode';
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
  console.log('English CATTI extension activated.');
}

export function deactivate() {
  console.log('English CATTI extension deactivated.');
}
