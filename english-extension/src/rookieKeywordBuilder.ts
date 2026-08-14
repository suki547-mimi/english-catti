import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { extractRookiePhrasesFromLinesBatch } from './lm';

interface DialogueLine {
  episode: string;
  en: string;
}

interface CuratedEntry {
  en: string;
  zh: string;
  tier: 'high' | 'mid' | 'low';
  note: string;
  freq: number;
  examples: Array<{ episode: string; en: string }>;
  addedAt: string;
}

interface ProgressState {
  processed: number;
  keptCount: number;
  startedAt: string;
  lastUpdatedAt: string;
}

const BATCH_SIZE = 20;
const LINES_SRC = 'rookie_lines_filtered.json';
const CURATED_JSON = 'rookie_keywords_db.json';
const PROGRESS_JSON = 'rookie_keywords_build_progress.json';

/** Build Rookie keyword DB by asking LLM to pull phrases directly from full
 *  lines (not from pre-cut n-grams). LLM chooses natural phrase boundaries. */
export async function buildRookieKeywordDb(context: vscode.ExtensionContext, dataRoot: string | undefined) {
  if (!dataRoot) {
    vscode.window.showErrorMessage('English CATTI: 找不到工作区数据目录');
    return;
  }
  const rookieDir = path.join(dataRoot, 'data', 'rookie');
  const subsDir = path.join(dataRoot, 'data', 'subs', 'rookie');
  const linesPath = path.join(subsDir, LINES_SRC);
  const outPath = path.join(rookieDir, CURATED_JSON);
  const progPath = path.join(rookieDir, PROGRESS_JSON);
  if (!fs.existsSync(linesPath)) {
    vscode.window.showErrorMessage(`找不到台词文件：${linesPath}`);
    return;
  }
  fs.mkdirSync(rookieDir, { recursive: true });

  const lines: DialogueLine[] = JSON.parse(fs.readFileSync(linesPath, 'utf8'));
  const capChoice = await promptCap(lines.length);
  if (capChoice === undefined) { return; }
  const cleanFirst = capChoice < 0;
  const cap = Math.abs(capChoice);
  const batchLimit = Math.min(cap, lines.length);

  if (cleanFirst) {
    try { if (fs.existsSync(outPath)) { fs.unlinkSync(outPath); } } catch { /* ignore */ }
    try { if (fs.existsSync(progPath)) { fs.unlinkSync(progPath); } } catch { /* ignore */ }
  }

  let curated: Record<string, CuratedEntry> = {};
  if (fs.existsSync(outPath)) {
    try { curated = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { curated = {}; }
  }
  let progress: ProgressState = {
    processed: 0, keptCount: Object.keys(curated).length,
    startedAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(),
  };
  if (fs.existsSync(progPath) && !cleanFirst) {
    try { progress = { ...progress, ...JSON.parse(fs.readFileSync(progPath, 'utf8')) }; } catch { /* ignore */ }
  }

  const startIdx = cleanFirst ? 0 : progress.processed;
  const endIdx = Math.min(batchLimit, lines.length);
  const totalBatches = Math.max(1, Math.ceil((endIdx - startIdx) / BATCH_SIZE));

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Rookie 关键词库 · LLM 从台词提取短语',
    cancellable: true,
  }, async (uiProgress, token) => {
    let batchNum = 0;
    for (let i = startIdx; i < endIdx; i += BATCH_SIZE) {
      if (token.isCancellationRequested) { break; }
      batchNum++;
      const slice = lines.slice(i, i + BATCH_SIZE);
      uiProgress.report({
        message: `批次 ${batchNum}/${totalBatches} · 已扫 ${i}/${endIdx} 句 · 收录 ${progress.keptCount} 短语`,
        increment: 100 / totalBatches,
      });
      const batchInput = slice.map((ln, j) => ({ id: `L${i + j}`, en: ln.en }));
      const results = await extractRookiePhrasesFromLinesBatch(batchInput);
      if (!results) {
        progress.processed = i + slice.length;
        writeProgress(progPath, progress);
        await sleep(500);
        continue;
      }
      for (let j = 0; j < slice.length; j++) {
        const line = slice[j];
        const lineId = batchInput[j].id;
        const hits = results[lineId] || [];
        for (const hit of hits) {
          const key = normalizePhraseKey(hit.phrase);
          if (!key) { continue; }
          if (!validateHitAgainstLine(hit.phrase, line.en)) { continue; }
          const existing = curated[key];
          if (existing) {
            existing.freq += 1;
            if (existing.examples.length < 3) {
              existing.examples.push({ episode: line.episode, en: line.en });
            }
          } else {
            curated[key] = {
              en: hit.phrase.toLowerCase().trim(),
              zh: hit.zh,
              tier: hit.tier,
              note: hit.note,
              freq: 1,
              examples: [{ episode: line.episode, en: line.en }],
              addedAt: new Date().toISOString(),
            };
            progress.keptCount++;
          }
        }
      }
      progress.processed = i + slice.length;
      progress.lastUpdatedAt = new Date().toISOString();
      fs.writeFileSync(outPath, JSON.stringify(curated, null, 2), 'utf8');
      writeProgress(progPath, progress);
      await sleep(300);
    }
  });

  const total = Object.keys(curated).length;
  vscode.window.showInformationMessage(
    `完成 · 已扫描 ${progress.processed} 句 · 收录 ${total} 个短语 · ${outPath}`,
  );
}

async function promptCap(totalLines: number): Promise<number | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: '🧹 清空重跑（前 200 行，全新一轮）', value: -200 },
      { label: '🧹 清空重跑（前 500 行，全新一轮）', value: -500 },
      { label: '快速试跑 · 前 200 行（续跑）', value: 200 },
      { label: '中等 · 前 2000 行', value: 2000 },
      { label: '全量 · 全部 ' + totalLines + ' 行', value: totalLines },
    ],
    { placeHolder: 'LLM 分析多少行台词（可随时取消，进度会保存）' },
  );
  return pick ? pick.value : undefined;
}

function normalizePhraseKey(phrase: string): string {
  return String(phrase || '')
    .toLowerCase()
    .replace(/[^a-z' \-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reject hallucinated phrases: every token in the extracted phrase must
 *  appear in the source line (allowing simple inflection suffixes). */
function validateHitAgainstLine(phrase: string, line: string): boolean {
  const key = normalizePhraseKey(phrase);
  if (!key) { return false; }
  const tokens = key.split(' ').filter(Boolean);
  if (tokens.length === 0) { return false; }
  const lineLc = ' ' + line.toLowerCase().replace(/[^a-z' \-]/g, ' ').replace(/\s+/g, ' ') + ' ';
  for (const t of tokens) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^| )${escaped}[a-z']{0,4}( |$)`);
    if (!re.test(lineLc)) { return false; }
  }
  return true;
}

function writeProgress(p: string, s: ProgressState) {
  try { fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf8'); } catch { /* ignore */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
