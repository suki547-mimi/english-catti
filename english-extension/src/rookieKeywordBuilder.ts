import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { curateRookieKeywordBatch } from './lm';

interface Candidate {
  phrase: string;
  freq: number;
  score: number;
  examples: Array<{ episode: string; en: string }>;
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
  droppedCount: number;
  startedAt: string;
  lastUpdatedAt: string;
}

const BATCH_SIZE = 30;
const CANDIDATES_JSON = 'rookie_keyword_candidates.json';
const CURATED_JSON = 'rookie_keywords_db.json';
const PROGRESS_JSON = 'rookie_keywords_build_progress.json';

export async function buildRookieKeywordDb(context: vscode.ExtensionContext, dataRoot: string | undefined) {
  if (!dataRoot) {
    vscode.window.showErrorMessage('English CATTI: 找不到工作区数据目录');
    return;
  }
  const rookieDir = path.join(dataRoot, 'data', 'rookie');
  const candPath = path.join(rookieDir, CANDIDATES_JSON);
  const outPath = path.join(rookieDir, CURATED_JSON);
  const progPath = path.join(rookieDir, PROGRESS_JSON);
  if (!fs.existsSync(candPath)) {
    vscode.window.showErrorMessage(`找不到候选文件：${candPath}\n先跑一次 tools/extract_rookie_keyword_candidates.py`);
    return;
  }

  const candidates: Candidate[] = JSON.parse(fs.readFileSync(candPath, 'utf8'));
  const capChoice = await promptCap(candidates.length);
  if (capChoice === undefined) { return; }
  const cleanFirst = capChoice < 0;
  const cap = Math.abs(capChoice);
  const batchLimit = Math.min(cap, candidates.length);

  if (cleanFirst) {
    try { if (fs.existsSync(outPath)) { fs.unlinkSync(outPath); } } catch { /* ignore */ }
    try { if (fs.existsSync(progPath)) { fs.unlinkSync(progPath); } } catch { /* ignore */ }
  }

  let curated: Record<string, CuratedEntry> = {};
  if (fs.existsSync(outPath)) {
    try { curated = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { curated = {}; }
  }
  let progress: ProgressState = {
    processed: 0, keptCount: Object.keys(curated).length, droppedCount: 0,
    startedAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(),
  };
  if (fs.existsSync(progPath)) {
    try { progress = { ...progress, ...JSON.parse(fs.readFileSync(progPath, 'utf8')) }; } catch { /* ignore */ }
  }

  const startIdx = progress.processed;
  const endIdx = Math.min(batchLimit, candidates.length);
  const totalBatches = Math.ceil((endIdx - startIdx) / BATCH_SIZE);

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Rookie 关键词库 · LLM 分析中',
    cancellable: true,
  }, async (uiProgress, token) => {
    let batchNum = 0;
    for (let i = startIdx; i < endIdx; i += BATCH_SIZE) {
      if (token.isCancellationRequested) { break; }
      batchNum++;
      const slice = candidates.slice(i, i + BATCH_SIZE);
      uiProgress.report({
        message: `批次 ${batchNum}/${totalBatches} · 已处理 ${i}/${endIdx} · 保留 ${progress.keptCount}`,
        increment: 100 / totalBatches,
      });
      const results = await curateRookieKeywordBatch(slice.map((c) => ({ phrase: c.phrase, exampleLine: c.examples[0]?.en || '' })));
      if (!results) {
        // Skip this batch on error; move on
        progress.processed = i + slice.length;
        writeProgress(progPath, progress);
        await sleep(500);
        continue;
      }
      for (let j = 0; j < slice.length; j++) {
        const cand = slice[j];
        const r = results[j];
        if (r && r.keep) {
          const entry: CuratedEntry = {
            en: cand.phrase,
            zh: r.zh || '',
            tier: (r.tier === 'high' || r.tier === 'mid' || r.tier === 'low') ? r.tier : 'mid',
            note: r.note || '',
            freq: cand.freq,
            examples: cand.examples,
            addedAt: new Date().toISOString(),
          };
          curated[cand.phrase] = entry;
          progress.keptCount++;
        } else {
          progress.droppedCount++;
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
    `完成 · 已处理 ${progress.processed} 候选 · 保留 ${total} 词条 · 存放：${outPath}`,
  );
}

async function promptCap(totalCandidates: number): Promise<number | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: '🧹 清空重跑（前 200 个，全新一轮）', value: -200 },
      { label: '快速试跑 · 前 200 个（续跑，接着已有进度）', value: 200 },
      { label: '中等 · 前 1000 个', value: 1000 },
      { label: '全量 · 全部 ' + totalCandidates + ' 个', value: totalCandidates },
    ],
    { placeHolder: 'LLM 分析候选词数量（可随时取消，进度会保存）' },
  );
  return pick ? pick.value : undefined;
}

function writeProgress(p: string, s: ProgressState) {
  try { fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf8'); } catch { /* ignore */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
