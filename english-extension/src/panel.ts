import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { gradeSemantic, gradeSentence } from './lm';

let panel: vscode.WebviewPanel | undefined;

export function openMainPanel(context: vscode.ExtensionContext, mode: string) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('English CATTI: please open the English workspace folder first.');
    return;
  }
  const wsRoot = workspaceFolder.uri.fsPath;

  if (panel) {
    panel.reveal();
    panel.webview.postMessage({ type: 'setMode', mode });
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'englishCatti',
    'English CATTI',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'webview')),
        vscode.Uri.file(path.join(wsRoot, 'data')),
      ],
    }
  );

  const webviewDir = vscode.Uri.file(path.join(context.extensionPath, 'webview'));
  const dataDir = vscode.Uri.file(path.join(wsRoot, 'data'));

  const htmlPath = path.join(context.extensionPath, 'webview', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const cssUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'webview', 'styles.css')));
  const jsUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'webview', 'main.js')));
  const dataBaseUri = panel.webview.asWebviewUri(dataDir);
  const cspSource = panel.webview.cspSource;

  html = html
    .replace(/{{CSS}}/g, cssUri.toString())
    .replace(/{{JS}}/g, jsUri.toString())
    .replace(/{{DATA_BASE}}/g, dataBaseUri.toString())
    .replace(/{{CSP_SOURCE}}/g, cspSource)
    .replace(/{{MODE}}/g, mode);

  panel.webview.html = html;

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!panel) { return; }
    switch (msg.type) {
      case 'gradeSemantic': {
        const result = await gradeSemantic(msg.userAnswer, msg.reference);
        panel.webview.postMessage({ type: 'gradeResult', requestId: msg.requestId, result });
        break;
      }
      case 'gradeSentence': {
        const result = await gradeSentence(msg.sentence, msg.targetWord, msg.chineseMeaning);
        panel.webview.postMessage({ type: 'sentenceResult', requestId: msg.requestId, result });
        break;
      }
      case 'showError': {
        vscode.window.showErrorMessage(msg.message);
        break;
      }
      case 'showInfo': {
        vscode.window.showInformationMessage(msg.message);
        break;
      }
    }
  });

  panel.onDidDispose(() => {
    panel = undefined;
  });
}
