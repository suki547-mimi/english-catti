import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { gradeSemantic, gradeSentence } from './lm';
import { UserStore } from './store';

let panel: vscode.WebviewPanel | undefined;
let store: UserStore | undefined;

/** Locate the folder that contains `data/unified_vocab.json`.
 *  Priority:
 *    1. Active workspace folder
 *    2. Parent of extension path (dev host case: extension lives in `<root>/english-extension`)
 *    3. Ask user to pick
 */
async function resolveDataRoot(context: vscode.ExtensionContext): Promise<string | undefined> {
  const candidates: string[] = [];
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (ws) { candidates.push(ws.uri.fsPath); }
  candidates.push(path.dirname(context.extensionPath));
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'data', 'unified_vocab.json'))) {
      return c;
    }
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: '选择包含 data/unified_vocab.json 的文件夹',
  });
  if (picked && picked[0] && fs.existsSync(path.join(picked[0].fsPath, 'data', 'unified_vocab.json'))) {
    return picked[0].fsPath;
  }
  return undefined;
}

export async function openMainPanel(context: vscode.ExtensionContext, mode: string) {
  const wsRoot = await resolveDataRoot(context);
  if (!wsRoot) {
    vscode.window.showErrorMessage('English CATTI: 找不到 data/unified_vocab.json，请把此扩展放在 English 工作区目录下，或打开该工作区。');
    return;
  }
  // Init user store rooted at the same data folder
  store = new UserStore(path.join(wsRoot, 'data'));

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
      // ---------- User store ----------
      case 'recordLearnResult': {
        if (store) { store.recordLearn(msg.wordId, msg.en, msg.zh, !!msg.known); }
        break;
      }
      case 'finishLearnSession': {
        if (store) { store.finishLearnSession(msg.wordIds || [], msg.known || 0, msg.unknown || 0); }
        break;
      }
      case 'recordEbbinghausReview': {
        if (store) { store.recordEbbinghausReview(msg.wordId, msg.en, msg.zh, msg.gate || 1, !!msg.pass); }
        break;
      }
      case 'finishEbbinghausSession': {
        if (store) { store.finishEbbinghausSession(msg.wordIds || [], msg.correct || 0, msg.incorrect || 0); }
        break;
      }
      case 'recordScoreReview': {
        if (store) { store.recordScoreReview(msg.wordId, msg.en, msg.zh, msg.gate || 1, !!msg.pass); }
        break;
      }
      case 'finishScoreSession': {
        if (store) { store.finishScoreSession(msg.wordIds || [], msg.correct || 0, msg.incorrect || 0); }
        break;
      }
      case 'getUserSummary': {
        const summary = store ? store.summary() : null;
        panel.webview.postMessage({ type: 'userSummary', requestId: msg.requestId, summary });
        break;
      }
      case 'getLearnedIds': {
        const ids = store ? store.learnedIds() : [];
        panel.webview.postMessage({ type: 'learnedIds', requestId: msg.requestId, ids });
        break;
      }
      case 'getEbbinghausDue': {
        const due = store ? store.getEbbinghausDue(msg.limit || 200) : [];
        panel.webview.postMessage({ type: 'ebbinghausDue', requestId: msg.requestId, due });
        break;
      }
      case 'getScorePool': {
        const pool = store ? store.getScorePool() : [];
        panel.webview.postMessage({ type: 'scorePool', requestId: msg.requestId, pool });
        break;
      }
      case 'getCalendar': {
        const cal = store ? store.calendarSummary(msg.pastDays || 30, msg.futureDays || 7) : { past: [], upcoming: [] };
        panel.webview.postMessage({ type: 'calendar', requestId: msg.requestId, ...cal });
        break;
      }
      case 'getDayDetail': {
        const detail = store ? store.dayDetail(msg.date) : null;
        panel.webview.postMessage({ type: 'dayDetail', requestId: msg.requestId, detail });
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
