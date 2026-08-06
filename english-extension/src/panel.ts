import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { gradeSemantic, gradeSentence, generateContext, deepStudy, chatWithWord, generateReadingArticles, ReadingArticle, gradeReverseSemantic, generateCollocationCloze, gradeCollocation, gradeContextCloze, chatFreeform, generateStoryContext, generateFunContext, explainWordFromTutor } from './lm';
import { UserStore } from './store';

let panel: vscode.WebviewPanel | undefined;
let store: UserStore | undefined;
let currentDataRoot: string | undefined;

/** Background reading-corner generation status shared with the webview. */
let readingGenState: { state: 'idle' | 'running' | 'done' | 'failed'; startedAt?: string; error?: string } = { state: 'idle' };

const VOICE_MAP: Record<string, string> = {
  us: 'en-US-AriaNeural',
  uk: 'en-GB-SoniaNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
};

/** In-flight generation dedupe (key: `${accent}:${hash}`). */
const genPromises: Map<string, Promise<string | null>> = new Map();

function sentenceHash(text: string): string {
  return crypto.createHash('sha1').update(text.trim().toLowerCase()).digest('hex').slice(0, 16);
}

/** Remove emoji / pictographic characters that edge-tts cannot voice and
 *  that occasionally crash the underlying websockets stream. Also collapse
 *  runs of whitespace so multi-line 小红书 posts become a single voiced line. */
function cleanForTts(text: string): string {
  return String(text || '')
    // Strip extended pictographs, dingbats, misc symbols, variation selectors.
    .replace(/[\p{Extended_Pictographic}\u2600-\u27BF\uFE0F]/gu, '')
    // Strip leftover surrogate halves just in case.
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Max characters edge-tts will accept per call in one request. edge-tts itself
 *  handles a few thousand fine; keep a safety cap to avoid pathological blobs. */
const TTS_MAX_CHARS = 3000;

/** Locate a Python executable that can run edge-tts. */
function findPython(): string {
  // Prefer the known install location; fall back to PATH.
  const known = 'C:\\Python314\\python.exe';
  if (fs.existsSync(known)) { return known; }
  return 'python';
}

// ---------- Reading Corner storage ----------
function readingRoot(): string | null {
  if (!currentDataRoot) { return null; }
  const dir = path.join(currentDataRoot, 'data', 'reading_corner');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'daily'), { recursive: true });
  return dir;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadTodayArticles(): ReadingArticle[] {
  const root = readingRoot();
  if (!root) { return []; }
  const p = path.join(root, 'daily', `${todayKey()}.json`);
  if (!fs.existsSync(p)) { return []; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

function saveTodayArticles(items: ReadingArticle[]) {
  const root = readingRoot();
  if (!root) { return; }
  const p = path.join(root, 'daily', `${todayKey()}.json`);
  fs.writeFileSync(p, JSON.stringify(items, null, 2), 'utf8');
}

function loadFavorites(): ReadingArticle[] {
  const root = readingRoot();
  if (!root) { return []; }
  const p = path.join(root, 'favorites.json');
  if (!fs.existsSync(p)) { return []; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

function saveFavorites(items: ReadingArticle[]) {
  const root = readingRoot();
  if (!root) { return; }
  const p = path.join(root, 'favorites.json');
  fs.writeFileSync(p, JSON.stringify(items, null, 2), 'utf8');
}

/** Fire background TTS generation for every English sentence in every article,
 *  both US and UK accents. Uses `generateSentenceAudio` which is cached and dedup-safe.
 *  Runs with a bounded concurrency queue so we don't hammer edge-tts. */
function prefetchArticleAudio(items: ReadingArticle[]) {
  if (!items || items.length === 0) { return; }
  const jobs: Array<{ text: string; accent: 'us' | 'uk' }> = [];
  for (const a of items) {
    for (const s of a.sentences || []) {
      const t = cleanForTts(s.en || '');
      if (t && t.length <= TTS_MAX_CHARS) {
        jobs.push({ text: t, accent: 'us' });
        jobs.push({ text: t, accent: 'uk' });
      }
    }
  }
  const CONCURRENCY = 3;
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const idx = cursor++;
      const job = jobs[idx];
      try { await generateSentenceAudio(job.text, job.accent); } catch { /* ignore */ }
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) { workers.push(worker()); }
  Promise.all(workers).then(() => {
    console.log(`[reading] prefetched audio for ${items.length} articles (${jobs.length} tts jobs)`);
  }).catch(() => { /* ignore */ });
}

/** Kick off background generation if today's file doesn't exist yet.
 *  Called on extension activation so articles are ready when the user opens the tab. */
export async function maybeAutoGenerateReading(context: vscode.ExtensionContext, wsRoot?: string) {
  const root = wsRoot || currentDataRoot;
  if (!root) { return; }
  // Ensure store is available so we can pull review words
  const localStore = store || new UserStore(path.join(root, 'data'));
  currentDataRoot = root;
  const dailyDir = path.join(root, 'data', 'reading_corner', 'daily');
  fs.mkdirSync(dailyDir, { recursive: true });
  const p = path.join(dailyDir, `${todayKey()}.json`);
  if (fs.existsSync(p)) {
    readingGenState = { state: 'done' };
    return;
  }
  if (readingGenState.state === 'running') { return; }
  readingGenState = { state: 'running', startedAt: new Date().toISOString() };

  // Pull vocab pool the same way the webview would (via store + local unified_vocab)
  const vocabPath = path.join(root, 'data', 'unified_vocab.json');
  let vocabById: Record<string, { en: string; zh: string }> = {};
  try {
    const raw = fs.readFileSync(vocabPath, 'utf8');
    const arr = JSON.parse(raw) as Array<{ id: string; en: string; zh: string }>;
    for (const w of arr) { vocabById[w.id] = { en: w.en, zh: w.zh }; }
  } catch { /* ignore */ }
  const due = localStore.getEbbinghausDue(50);
  const reviewWords = due.map((d) => vocabById[d.wordId]).filter((w) => w && w.en && /^[a-zA-Z\s\-']+$/.test(w.en));
  const learnedIds = localStore.learnedIds().slice(0, 20);
  const extraWords = learnedIds.map((id) => vocabById[id]).filter((w) => w && w.en && /^[a-zA-Z\s\-']+$/.test(w.en));

  // Fire and forget — result cached to disk regardless
  (async () => {
    try {
      const result = await generateReadingArticles(reviewWords, extraWords, 4);
      if (result.items.length > 0) {
        fs.writeFileSync(p, JSON.stringify(result.items, null, 2), 'utf8');
        readingGenState = { state: 'done' };
        // Immediately start pre-generating US/UK audio for every sentence.
        prefetchArticleAudio(result.items);
      } else {
        readingGenState = { state: 'failed', error: result.error || '未生成任何文章' };
      }
      // Poke the webview if it's open
      if (panel) { panel.webview.postMessage({ type: 'readingAutoGenDone', status: readingGenState }); }
    } catch (e: any) {
      readingGenState = { state: 'failed', error: e?.message || String(e) };
      if (panel) { panel.webview.postMessage({ type: 'readingAutoGenDone', status: readingGenState }); }
    }
  })();
}

/** Generate one sentence mp3 with edge-tts and cache under
 *  data/audio/sentences/dynamic/<accent>/<hash>.mp3.
 *  Returns the relative path (posix-style) that the webview can join with dataBase. */
async function generateSentenceAudio(text: string, accent: string): Promise<string | null> {
  const voice = VOICE_MAP[accent];
  if (!voice || !currentDataRoot) {
    console.warn('[edge-tts] skip: voice/root missing', { accent, hasRoot: !!currentDataRoot });
    return null;
  }
  const clean = cleanForTts(text);
  if (!clean) {
    console.warn('[edge-tts] skip: empty text after clean');
    return null;
  }
  if (clean.length > TTS_MAX_CHARS) {
    console.warn('[edge-tts] skip: text too long', clean.length);
    return null;
  }
  const hash = sentenceHash(clean);
  const relDir = `audio/sentences/dynamic/${accent}`;
  const relPath = `${relDir}/${hash}.mp3`;
  const absDir = path.join(currentDataRoot, 'data', relDir);
  const absPath = path.join(absDir, `${hash}.mp3`);
  if (fs.existsSync(absPath) && fs.statSync(absPath).size > 500) {
    return relPath;
  }
  const key = `${accent}:${hash}`;
  const existing = genPromises.get(key);
  if (existing) { return existing; }
  fs.mkdirSync(absDir, { recursive: true });
  const python = findPython();
  // Scale timeout with text length: ~50 chars/sec synthesis + 10s network overhead,
  // capped so a stuck request eventually gives up. Long 小红书 posts (~700 chars)
  // legitimately need 25-30s.
  const timeoutMs = Math.min(90000, 10000 + Math.ceil(clean.length / 50) * 1000);
  const promise = new Promise<string | null>((resolve) => {
    const proc = spawn(python, ['-m', 'edge_tts', '-t', clean, '-v', voice, '--write-media', absPath], {
      windowsHide: true,
    });
    let stderr = '';
    let killed = false;
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => {
      console.warn('[edge-tts] spawn error', e);
      resolve(null);
    });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(absPath) && fs.statSync(absPath).size > 500) {
        resolve(relPath);
      } else {
        if (fs.existsSync(absPath)) { try { fs.unlinkSync(absPath); } catch { /* ignore */ } }
        console.warn('[edge-tts] failed', { code, killed, len: clean.length, stderr: stderr.slice(0, 400) });
        resolve(null);
      }
    });
    setTimeout(() => { killed = true; try { proc.kill(); } catch { /* ignore */ } resolve(null); }, timeoutMs);
  }).finally(() => { genPromises.delete(key); });
  genPromises.set(key, promise);
  return promise;
}

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
  currentDataRoot = wsRoot;

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
      case 'gradeReverseSemantic': {
        const result = await gradeReverseSemantic(msg.userEn, msg.targetEn, msg.zhHint);
        panel.webview.postMessage({ type: 'gradeResult', requestId: msg.requestId, result });
        break;
      }
      case 'generateCollocationCloze': {
        const result = await generateCollocationCloze(msg.en, msg.zh);
        panel.webview.postMessage({ type: 'collocationCloze', requestId: msg.requestId, result });
        break;
      }
      case 'gradeCollocation': {
        const result = await gradeCollocation(msg.userAnswer, msg.expected, msg.stem);
        panel.webview.postMessage({ type: 'gradeResult', requestId: msg.requestId, result });
        break;
      }
      case 'gradeContextCloze': {
        const result = await gradeContextCloze(msg.userAnswer, msg.expected, msg.sentence);
        panel.webview.postMessage({ type: 'gradeResult', requestId: msg.requestId, result });
        break;
      }
      case 'chatFreeform': {
        const sessionId: string | undefined = msg.sessionId;
        const question: string = msg.question || '';
        // Ensure a tutor-mode session exists so words the user later adds via
        // “➕ 加入词本” can link back to this conversation.
        if (store && sessionId && !store.getAiSession(sessionId)) {
          store.startAiSession({ id: sessionId, mode: 'tutor' });
        }
        if (store && sessionId && question) {
          store.appendAiMessage(sessionId, 'user', question);
        }
        const reply = await chatFreeform(msg.history || [], question);
        if (store && sessionId && reply) {
          store.appendAiMessage(sessionId, 'assistant', reply);
        }
        panel.webview.postMessage({ type: 'chatReply', requestId: msg.requestId, reply, sessionId });
        break;
      }
      case 'toggleFavoriteWord': {
        const favorited = store ? store.toggleFavoriteWord(msg.wordId) : false;
        panel.webview.postMessage({ type: 'favoriteWordToggled', requestId: msg.requestId, favorited, wordId: msg.wordId });
        break;
      }
      case 'getFavoriteWords': {
        const ids = store ? store.getFavoriteWords() : [];
        panel.webview.postMessage({ type: 'favoriteWords', requestId: msg.requestId, ids });
        break;
      }
      case 'generateContext': {
        const result = await generateContext(msg.en, msg.zh);
        panel.webview.postMessage({ type: 'contextResult', requestId: msg.requestId, result });
        break;
      }
      case 'generateStoryContext': {
        const result = await generateStoryContext(msg.en, msg.zh);
        panel.webview.postMessage({ type: 'contextResult', requestId: msg.requestId, result });
        break;
      }
      case 'generateFunContext': {
        const result = await generateFunContext(msg.en, msg.zh);
        panel.webview.postMessage({ type: 'contextResult', requestId: msg.requestId, result });
        break;
      }
      case 'deepStudy': {
        const en: string = msg.en || '';
        const zh: string = msg.zh || '';
        const wordId: string | undefined = msg.wordId;
        const sessionId: string | undefined = msg.sessionId;
        // If a wordId + sessionId are supplied, this is a fresh deep-study session
        // (the webview generated the id). Register it before generating so the
        // markdown gets stored as the first assistant message.
        if (store && wordId && sessionId && !store.getAiSession(sessionId)) {
          store.startAiSession({ id: sessionId, mode: 'deepStudy', wordId, en, zh });
        }
        const markdown = await deepStudy(en, zh);
        if (store && sessionId && store.getAiSession(sessionId) && markdown) {
          store.appendAiMessage(sessionId, 'assistant', markdown);
        }
        panel.webview.postMessage({ type: 'deepStudyResult', requestId: msg.requestId, markdown, sessionId });
        break;
      }
      case 'chatWithWord': {
        const sessionId: string | undefined = msg.sessionId;
        const question: string = msg.question || '';
        if (store && sessionId && store.getAiSession(sessionId) && question) {
          store.appendAiMessage(sessionId, 'user', question);
        }
        const reply = await chatWithWord(msg.en, msg.zh, msg.history || [], question);
        if (store && sessionId && store.getAiSession(sessionId) && reply) {
          store.appendAiMessage(sessionId, 'assistant', reply);
        }
        panel.webview.postMessage({ type: 'chatReply', requestId: msg.requestId, reply, sessionId });
        break;
      }
      case 'getQueriedWords': {
        const items = store ? store.getQueriedWords() : [];
        panel.webview.postMessage({ type: 'queriedWords', requestId: msg.requestId, items });
        break;
      }
      case 'getAiSession': {
        const session = store && msg.sessionId ? store.getAiSession(msg.sessionId) : null;
        panel.webview.postMessage({ type: 'aiSession', requestId: msg.requestId, session });
        break;
      }
      case 'registerAiSession': {
        // Used when the webview already has the deep-study markdown cached from
        // a background prefetch — no need to spend another LLM call, just
        // persist the session so it shows up in 🤖 AI 查询过.
        if (store && msg.sessionId && msg.wordId && !store.getAiSession(msg.sessionId)) {
          store.startAiSession({
            id: msg.sessionId,
            mode: msg.mode || 'deepStudy',
            wordId: msg.wordId,
            en: msg.en,
            zh: msg.zh,
          });
          if (msg.markdown) {
            store.appendAiMessage(msg.sessionId, 'assistant', String(msg.markdown));
          }
        }
        panel.webview.postMessage({ type: 'aiSessionRegistered', requestId: msg.requestId, sessionId: msg.sessionId });
        break;
      }
      case 'addUserVocab': {
        const en = String(msg.en || '').trim();
        if (!store || !en) {
          panel.webview.postMessage({ type: 'userVocabAdded', requestId: msg.requestId, entry: null, error: 'invalid input' });
          break;
        }
        // Ask the LM for a short zh + note, falling back to whatever the caller
        // supplied if the LM is unavailable.
        let zh = String(msg.zh || '').trim();
        let note: string | undefined = msg.note ? String(msg.note).trim() : undefined;
        if (!zh) {
          const guess = await explainWordFromTutor(en, msg.contextText);
          if (guess) { zh = guess.zh; if (!note) { note = guess.note; } }
        }
        if (!zh) { zh = ''; }
        const entry = store.addCustomWord({
          en, zh, note,
          source: msg.source === 'manual' ? 'manual' : 'tutor',
          tutorSessionId: msg.tutorSessionId,
        });
        panel.webview.postMessage({ type: 'userVocabAdded', requestId: msg.requestId, entry });
        break;
      }
      case 'getUserVocab': {
        const items = store ? store.getCustomWords() : [];
        panel.webview.postMessage({ type: 'userVocab', requestId: msg.requestId, items });
        break;
      }
      case 'openInCopilotChat': {
        try {
          await vscode.commands.executeCommand('workbench.action.chat.open', { query: msg.query });
        } catch (e) {
          try {
            await vscode.commands.executeCommand('workbench.action.chat.newChat');
          } catch { /* ignore */ }
          vscode.env.clipboard.writeText(msg.query || '');
          vscode.window.showInformationMessage('已复制提问到剪贴板，请粘贴到 Copilot Chat。');
        }
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
      case 'saveLearnSession': {
        if (store) { store.saveLearnSession(msg.session || null); }
        break;
      }
      case 'getLearnSession': {
        const s = store ? store.getLearnSession() : null;
        panel.webview.postMessage({ type: 'learnSession', requestId: msg.requestId, session: s });
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
        const due = store ? store.getEbbinghausDue(msg.limit || 200, !!msg.capped) : [];
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
      case 'generateSentenceAudio': {
        const rel = await generateSentenceAudio(msg.text || '', msg.accent || 'us');
        panel.webview.postMessage({ type: 'sentenceAudioReady', requestId: msg.requestId, path: rel, accent: msg.accent });
        break;
      }
      // ---------- Reading Corner ----------
      case 'getTodayArticles': {
        const items = loadTodayArticles();
        const status = readingGenState;
        panel.webview.postMessage({ type: 'todayArticles', requestId: msg.requestId, items, status });
        break;
      }
      case 'generateTodayArticles': {
        const result = await generateReadingArticles(msg.reviewWords || [], msg.extraWords || [], msg.count || 4);
        if (result.items.length > 0) {
          saveTodayArticles(result.items);
          prefetchArticleAudio(result.items);
        }
        panel.webview.postMessage({
          type: 'todayArticles',
          requestId: msg.requestId,
          items: result.items,
          error: result.error,
          status: { state: result.items.length > 0 ? 'done' : 'failed', error: result.error },
        });
        break;
      }
      case 'getFavoriteArticles': {
        const items = loadFavorites();
        panel.webview.postMessage({ type: 'favoriteArticles', requestId: msg.requestId, items });
        break;
      }
      case 'toggleFavoriteArticle': {
        const favs = loadFavorites();
        const idx = favs.findIndex((a) => a.id === msg.article.id);
        let favorited: boolean;
        if (idx >= 0) { favs.splice(idx, 1); favorited = false; }
        else { favs.unshift(msg.article); favorited = true; }
        saveFavorites(favs);
        panel.webview.postMessage({ type: 'favoriteToggled', requestId: msg.requestId, favorited, id: msg.article.id });
        break;
      }
    }
  });

  panel.onDidDispose(() => {
    panel = undefined;
  });
}
