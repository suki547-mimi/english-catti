/* eslint-disable no-restricted-globals */
// English CATTI — webview main script (M0 skeleton)
//
// Loads data from workspace /data/*.json via webview URIs.
// Tabs: browse / learn / review / stats
// Gate 1 demo integrates vscode.lm through extension host messages.

const vscode = acquireVsCodeApi();
const dataBase = document.body.dataset.base;

/** @type {Array<any>} */
let vocab = [];
/** @type {Map<string, any>} */
let vocabById = new Map();
/** @type {Array<any>} */
let sentences = [];
/** @type {Object<string, {hash:string, us:string, uk:string}>} */
let audioIndex = {};
/** @type {Object<string, {ipa:string, us:string, uk:string}>} */
let phonetics = {};

let state = {
  tab: 'browse',
  letter: 'A',
  search: '',
  topicFilter: '',
  learnQueue: null,
  reviewQueue: null,
};

// ------------ Boot ------------
async function loadJSON(name) {
  const url = `${dataBase}/${name}`;
  const r = await fetch(url);
  if (!r.ok) { throw new Error(`${name}: HTTP ${r.status}`); }
  return r.json();
}

async function boot() {
  try {
    const [v, s, a, p] = await Promise.all([
      loadJSON('unified_vocab.json'),
      loadJSON('unified_sentences.json').catch(() => []),
      loadJSON('audio_index.json').catch(() => ({})),
      loadJSON('phonetics.json').catch(() => ({})),
    ]);
    // Filter: keep only word/phrase, drop sentence-like entries (long, or classified as sentence)
    vocab = v.filter(isWordOrPhrase).map(cleanEntry).filter(isCleanEntry);
    vocabById = new Map(vocab.map((w) => [w.id, w]));
    sentences = s;
    audioIndex = a;
    phonetics = p;

    // Wire tabs
    for (const btn of document.querySelectorAll('.tab')) {
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        for (const b of document.querySelectorAll('.tab')) { b.classList.remove('active'); }
        btn.classList.add('active');
        render();
      });
    }
    // Set initial tab
    const initialTab = document.body.dataset.mode || 'browse';
    state.tab = initialTab === 'stats' ? 'stats' : initialTab === 'learn' ? 'learn' : initialTab === 'review' ? 'review' : 'browse';
    for (const b of document.querySelectorAll('.tab')) {
      if (b.dataset.tab === state.tab) { b.classList.add('active'); }
    }
    render();
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<div class="card"><p class="result-bad">加载失败：${e.message}</p>
       <p class="muted">请确保工作区根目录下存在 <code>data/unified_vocab.json</code> 等文件。</p></div>`;
  }
}

// ------------ Utils ------------
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** Keep only word / phrase-length entries (not sentences). */
function isWordOrPhrase(v) {
  if (!v || !v.en) { return false; }
  if (v.kind === 'sentence') { return false; }
  const en = v.en.trim();
  const wc = en.split(/\s+/).length;
  if (wc > 6) { return false; }
  // Drop entries containing sentence-ending punctuation
  if (/[.!?。！？]/.test(en)) { return false; }
  return true;
}

/** Extra quality filter — drop obvious junk. */
function isCleanEntry(v) {
  const en = String(v.en || '').trim();
  const zh = String(v.zh || '').trim();
  // Must have Chinese meaning (excludes google-10k skeletons for now)
  if (!zh) { return false; }
  // Full-width or half-width colon in en side ⇒ likely broken split (e.g. "AAMA：")
  if (/[:：]/.test(en)) { return false; }
  // Unbalanced parens ⇒ broken split (e.g. "AAMA (")
  const opens = (en.match(/[(（\[]/g) || []).length;
  const closes = (en.match(/[)）\]]/g) || []).length;
  if (opens !== closes) { return false; }
  // English side must actually contain letters (not just digits/symbols)
  if (!/[A-Za-z]{2,}/.test(en)) { return false; }
  // Chinese side must NOT start with English letters (broken split like "制 Dutch...")
  if (/^[A-Za-z]/.test(zh)) { return false; }
  // Very short en (single letter/abbr with no context)
  if (en.length < 2) { return false; }
  return true;
}

/** Strip leading numbering like "193.", "193．", "3、" from en and zh sides. */
function cleanEntry(v) {
  const out = { ...v };
  out.en = String(v.en || '').replace(/^\s*\d+\s*[\.\uFF0E、\)）]\s*/, '').trim();
  out.zh = String(v.zh || '').replace(/^\s*\d+\s*[\.\uFF0E、\)）]\s*/, '').trim();
  return out;
}

function playAudio(en, accent) {
  const idx = audioIndex[en];
  if (!idx) { return; }
  const rel = accent === 'uk' ? idx.uk : idx.us;
  const url = `${dataBase}/${rel}`;
  const a = new Audio(url);
  a.play().catch((err) => console.warn('audio play failed', err));
}

function audioBtns(en) {
  if (!audioIndex[en]) { return ''; }
  return `<button class="audio-btn" data-en="${escapeHtml(en)}" data-accent="us" title="美音">🇺🇸</button>
          <button class="audio-btn" data-en="${escapeHtml(en)}" data-accent="uk" title="英音">🇬🇧</button>`;
}

/** Look up phonetics for `en`. Only handles single-word entries (that's what our data has). */
function phoneticFor(en) {
  const key = String(en || '').trim().toLowerCase();
  if (!key.includes(' ')) {
    return phonetics[key] || null;
  }
  return null;
}

/** Render inline IPA badges for a word if data available. */
function phoneticBadges(en) {
  const p = phoneticFor(en);
  if (!p) { return ''; }
  const us = p.us || p.ipa;
  const uk = p.uk || p.ipa;
  const parts = [];
  if (us) { parts.push(`<span class="ipa" title="美音音标">🇺🇸 ${escapeHtml(us)}</span>`); }
  if (uk && uk !== us) { parts.push(`<span class="ipa" title="英音音标">🇬🇧 ${escapeHtml(uk)}</span>`); }
  return parts.length ? `<div class="ipa-line">${parts.join('')}</div>` : '';
}

function wireAudioButtons(root) {
  for (const b of root.querySelectorAll('.audio-btn')) {
    b.addEventListener('click', () => playAudio(b.dataset.en, b.dataset.accent));
  }
}

function cardHtml(v) {
  return `<div class="card">
    <div class="en">${escapeHtml(v.en)} ${audioBtns(v.en)}</div>
    ${phoneticBadges(v.en)}
    <div class="zh">${escapeHtml(v.zh) || '<em class="muted">暂无中文释义</em>'}</div>
    <div class="meta">${escapeHtml(v.topic || 'misc')} · ${escapeHtml(v.kind || '')} · ${escapeHtml((v.sources || []).join(', '))}</div>
  </div>`;
}

// ------------ Render dispatcher ------------
function render() {
  if (state.tab === 'browse') { renderBrowse(); }
  else if (state.tab === 'learn') { renderLearn(); }
  else if (state.tab === 'review') { renderReview(); }
  else if (state.tab === 'stats') { renderStats(); }
}

// ------------ Tab: Browse ------------
function renderBrowse() {
  const content = document.getElementById('content');
  const letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','#'];
  content.innerHTML = `
    <input class="search" placeholder="搜索英文或中文…（回车过滤）" value="${escapeHtml(state.search)}">
    <div class="letter-tabs">${letters.map(L => `<button data-letter="${L}" class="${L === state.letter ? 'active' : ''}">${L}</button>`).join('')}</div>
    <p class="muted" id="listMeta"></p>
    <div id="list"></div>
  `;
  content.querySelector('.search').addEventListener('input', (e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderList();
  });
  for (const b of content.querySelectorAll('.letter-tabs button')) {
    b.addEventListener('click', () => {
      state.letter = b.dataset.letter;
      for (const x of content.querySelectorAll('.letter-tabs button')) { x.classList.remove('active'); }
      b.classList.add('active');
      renderList();
    });
  }
  renderList();
}

function renderList() {
  const list = document.getElementById('list');
  const meta = document.getElementById('listMeta');
  let items;
  if (state.search) {
    items = vocab.filter((v) => v.en.toLowerCase().includes(state.search) || (v.zh || '').includes(state.search));
    meta.textContent = `匹配 ${items.length} 条（最多显示 200）`;
    items = items.slice(0, 200);
  } else {
    items = vocab.filter((v) => v.letter === state.letter);
    meta.textContent = `字母 ${state.letter} 共 ${items.length} 条（最多显示 500）`;
    items = items.slice(0, 500);
  }
  list.innerHTML = items.map(cardHtml).join('');
  wireAudioButtons(list);
}

// ------------ Tab: Learn ------------
async function renderLearn() {
  const content = document.getElementById('content');
  content.innerHTML = `<p class="muted">正在过滤已学词…</p>`;
  const learnedIds = await fetchLearnedIds();
  const unseen = vocab.filter((v) => v.zh && v.en.split(' ').length <= 5 && !learnedIds.has(v.id));
  content.innerHTML = `
    <h2>🌱 新词学习</h2>
    <p class="muted">
      从 <b>${unseen.length}</b> 个未学词里抽 10 个。你选"认识"就进入艾宾浩斯队列（1/2/4/7/15/30 天复习），选"不熟"下次可能再抽到。
    </p>
    <p>
      <button id="startLearn">开始学习 10 个新词</button>
    </p>
    <div id="learnArea"></div>
  `;
  content.querySelector('#startLearn').addEventListener('click', () => {
    const draw = [...unseen].sort(() => Math.random() - 0.5).slice(0, 10);
    if (draw.length === 0) {
      document.getElementById('learnArea').innerHTML = '<div class="card"><p>已经没有未学词了 🎉 —— 词库全部有基础释义的都被学过一次。</p></div>';
      return;
    }
    runLearnSession(draw);
  });
}

function runLearnSession(words) {
  let idx = 0;
  let known = 0, unknown = 0;
  const wordIds = words.map((w) => w.id);
  const area = document.getElementById('learnArea');

  function finish() {
    vscode.postMessage({ type: 'finishLearnSession', wordIds, known, unknown });
    area.innerHTML = `
      <div class="card">
        <h3>本轮结束 ✅</h3>
        <p>共学 ${words.length} 词，认识 ${known}，不熟 ${unknown}</p>
        <p class="muted">"认识"的词已进入艾宾浩斯队列（明天开始复习）。</p>
        <p><button id="againBtn">再来一轮</button></p>
      </div>
    `;
    document.getElementById('againBtn').addEventListener('click', () => renderLearn());
  }

  function showCard() {
    if (idx >= words.length) { finish(); return; }
    const w = words[idx];
    area.innerHTML = `
      <div class="card quiz-card">
        <div class="muted" style="margin-bottom:8px">${idx + 1} / ${words.length}</div>
        <div class="quiz-target">${escapeHtml(w.en)} ${audioBtns(w.en)}</div>
        ${phoneticBadges(w.en)}
        <div class="quiz-hint">先想想意思，再揭示答案</div>
        <p><button id="reveal">揭示答案</button></p>
        <div id="revealed" class="hidden">
          <div class="result-box">
            <div style="font-size:18px; margin-bottom:6px">${escapeHtml(w.zh)}</div>
            <div class="muted" style="font-size:12px">${escapeHtml(w.topic || 'misc')} · ${escapeHtml((w.sources || []).join(', '))}</div>
          </div>
          <p style="margin-top:12px">这个词你：</p>
          <p>
            <button id="btnKnown" class="secondary" style="color:#4caf50; border-color:#4caf50">✓ 认识</button>
            <button id="btnUnknown" class="secondary" style="color:#ff8b8b; border-color:#ff8b8b">✗ 不熟</button>
          </p>
        </div>
      </div>
    `;
    wireAudioButtons(area);
    document.getElementById('reveal').addEventListener('click', () => {
      document.getElementById('revealed').classList.remove('hidden');
      document.getElementById('btnKnown').focus();
    });
    document.getElementById('btnKnown').addEventListener('click', () => {
      known++;
      vscode.postMessage({ type: 'recordLearnResult', wordId: w.id, en: w.en, zh: w.zh, known: true });
      idx++; showCard();
    });
    document.getElementById('btnUnknown').addEventListener('click', () => {
      unknown++;
      vscode.postMessage({ type: 'recordLearnResult', wordId: w.id, en: w.en, zh: w.zh, known: false });
      idx++; showCard();
    });
  }
  showCard();
}

// ------------ Tab: Review (two sub-modes) ------------
let reviewMode = 'ebbinghaus';   // 'ebbinghaus' | 'score'

async function renderReview() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <h2>🔁 复习</h2>
    <div class="letter-tabs" style="border-bottom:none; margin-bottom:16px">
      <button data-mode="ebbinghaus" class="${reviewMode === 'ebbinghaus' ? 'active' : ''}">📅 艾宾浩斯（按记忆曲线）</button>
      <button data-mode="score" class="${reviewMode === 'score' ? 'active' : ''}">🎲 分数驱动（自适应大池）</button>
    </div>
    <div id="reviewBody"><p class="muted">加载中…</p></div>
  `;
  for (const b of content.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => {
      reviewMode = b.dataset.mode;
      renderReview();
    });
  }
  if (reviewMode === 'ebbinghaus') { renderEbbinghausOverview(); }
  else { renderScoreOverview(); }
}

async function renderEbbinghausOverview() {
  const body = document.getElementById('reviewBody');
  const due = await fetchEbbinghausDue(200);
  const byGate = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const d of due) { byGate[d.gate] = (byGate[d.gate] || 0) + 1; }
  body.innerHTML = `
    <div class="card">
      <b>今日应复习：${due.length} 词</b>
      <p class="muted" style="margin-top:6px">按记忆曲线到期（含之前落下的补测）。</p>
      <div style="margin-top:12px; font-size:13px; color:var(--vscode-descriptionForeground)">
        关卡分布：
        ${[1,2,3,4,5].map(g => `<span style="margin-right:12px">关 ${g}: <b>${byGate[g]||0}</b></span>`).join('')}
      </div>
      <p style="margin-top:14px">
        <button id="startEbb" ${due.length === 0 ? 'disabled' : ''}>
          ${due.length === 0 ? '今日没有到期词' : `开始复习（最多 20 个 / 次）`}
        </button>
      </p>
    </div>
    <div id="reviewArea"></div>
  `;
  if (due.length > 0) {
    document.getElementById('startEbb').addEventListener('click', () => {
      const batch = due.slice(0, 20);
      runEbbinghausSession(batch);
    });
  }
}

async function renderScoreOverview() {
  const body = document.getElementById('reviewBody');
  const pool = await fetchScorePool();
  const avgScore = pool.length ? (pool.reduce((s, p) => s + p.score, 0) / pool.length) : 0;
  body.innerHTML = `
    <div class="card">
      <b>可复习池：${pool.length} 词</b>（已学过的词，今天未复习过的）
      <p class="muted" style="margin-top:6px">越低分/低 gate 的词权重越高；每次随机抽 10 个练关 1。</p>
      <p style="margin-top:8px">平均分：<b>${avgScore.toFixed(1)}</b>/100</p>
      <p style="margin-top:14px">
        <button id="startScore" ${pool.length === 0 ? 'disabled' : ''}>
          ${pool.length === 0 ? '池子空——先去学习一些词' : '开始复习 10 个'}
        </button>
      </p>
    </div>
    <div id="reviewArea"></div>
  `;
  if (pool.length > 0) {
    document.getElementById('startScore').addEventListener('click', () => {
      const batch = weightedSample(pool, 10);
      runScoreSession(batch);
    });
  }
}

function weightedSample(pool, n) {
  const chosen = [];
  const remaining = pool.slice();
  while (chosen.length < n && remaining.length > 0) {
    const total = remaining.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < remaining.length; idx++) {
      r -= remaining[idx].weight;
      if (r <= 0) { break; }
    }
    if (idx >= remaining.length) { idx = remaining.length - 1; }
    chosen.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return chosen;
}

async function runEbbinghausSession(dueItems) {
  const wordEntries = dueItems.map((d) => ({ ...vocabById.get(d.wordId), _dueGate: d.gate })).filter((w) => w.id);
  runQuizSession('ebbinghaus', wordEntries);
}

async function runScoreSession(poolItems) {
  const wordEntries = poolItems.map((p) => ({ ...vocabById.get(p.wordId), _dueGate: 1 })).filter((w) => w.id);
  runQuizSession('score', wordEntries);
}

/**
 * Generic quiz runner. For M1 all gates route to Gate-1 style EN→ZH quiz
 * with LLM grading. Gates 2-5 will be implemented in a future pass.
 */
function runQuizSession(mode, words) {
  let idx = 0;
  let correct = 0, incorrect = 0;
  const wordIds = words.map((w) => w.id);
  const area = document.getElementById('reviewArea');

  function finish() {
    const finishMsg = mode === 'ebbinghaus' ? 'finishEbbinghausSession' : 'finishScoreSession';
    vscode.postMessage({ type: finishMsg, wordIds, correct, incorrect });
    area.innerHTML = `<div class="card">
      <h3>本轮结束 ✅</h3>
      <p>正确 ${correct} / 错 ${incorrect}</p>
      <p><button id="againBtn">再来一轮</button></p>
    </div>`;
    document.getElementById('againBtn').addEventListener('click', () => renderReview());
  }

  function show() {
    if (idx >= words.length) { finish(); return; }
    const w = words[idx];
    const gate = w._dueGate || 1;
    // For M1: all gates use the EN→ZH quiz style
    area.innerHTML = `
      <div class="card quiz-card">
        <div class="muted" style="margin-bottom:8px">${idx + 1} / ${words.length}　·　关 ${gate}</div>
        <div class="quiz-target">${escapeHtml(w.en)} ${audioBtns(w.en)}</div>
        ${phoneticBadges(w.en)}
        <div class="quiz-hint">请输入中文意思</div>
        <input class="quiz-input" id="ans" placeholder="任何合理的中文意思都算对（LLM 判分）">
        <p>
          <button id="go">提交</button>
          <button class="secondary" id="skip">跳过</button>
        </p>
        <div id="res"></div>
      </div>
    `;
    wireAudioButtons(area);
    document.getElementById('ans').focus();
    document.getElementById('skip').addEventListener('click', () => { idx++; show(); });
    const submit = async () => {
      const val = document.getElementById('ans').value.trim();
      if (!val) { return; }
      document.getElementById('res').innerHTML = '<p class="muted">LLM 判分中…</p>';
      const r = await callLM('gradeSemantic', { userAnswer: val, reference: w.zh });
      if (r.correct) { correct++; } else { incorrect++; }
      const recordMsg = mode === 'ebbinghaus' ? 'recordEbbinghausReview' : 'recordScoreReview';
      vscode.postMessage({ type: recordMsg, wordId: w.id, en: w.en, zh: w.zh, gate, pass: r.correct });
      document.getElementById('res').innerHTML = `
        <div class="result-box">
          <p class="${r.correct ? 'result-ok' : 'result-bad'}"><b>${r.correct ? '✓ 正确' : '✗ 需改进'}</b>：${escapeHtml(r.feedback)}</p>
          <p class="muted">参考：${escapeHtml(w.zh)}</p>
          <p><button id="next">下一个</button></p>
        </div>
      `;
      document.getElementById('next').addEventListener('click', () => { idx++; show(); });
    };
    document.getElementById('go').addEventListener('click', submit);
    document.getElementById('ans').addEventListener('keydown', (e) => { if (e.key === 'Enter') { submit(); } });
  }
  show();
}

let gradePending = new Map();
window.addEventListener('message', (evt) => {
  const m = evt.data;
  if (m.requestId && gradePending.has(m.requestId)) {
    // Generic response dispatcher — return the entire message except requestId+type
    gradePending.get(m.requestId)(m);
    gradePending.delete(m.requestId);
    return;
  }
  if (m.type === 'setMode') {
    state.tab = m.mode;
    for (const b of document.querySelectorAll('.tab')) {
      b.classList.toggle('active', b.dataset.tab === m.mode);
    }
    render();
  }
});

/** Send a message and await a matching response (with requestId). */
function callHost(type, payload = {}) {
  return new Promise((resolve) => {
    const requestId = String(Math.random()) + '-' + Date.now();
    gradePending.set(requestId, resolve);
    vscode.postMessage({ type, requestId, ...payload });
  });
}

async function callLM(type, payload) {
  const m = await callHost(type, payload);
  return m.result;
}

async function fetchUserSummary() {
  const m = await callHost('getUserSummary');
  return m.summary;
}
async function fetchLearnedIds() {
  const m = await callHost('getLearnedIds');
  return new Set(m.ids || []);
}
async function fetchEbbinghausDue(limit = 200) {
  const m = await callHost('getEbbinghausDue', { limit });
  return m.due || [];
}
async function fetchScorePool() {
  const m = await callHost('getScorePool');
  return m.pool || [];
}
async function fetchCalendar(pastDays = 30, futureDays = 7) {
  const m = await callHost('getCalendar', { pastDays, futureDays });
  return { past: m.past || [], upcoming: m.upcoming || [] };
}
async function fetchDayDetail(date) {
  const m = await callHost('getDayDetail', { date });
  return m.detail;
}

// ------------ Tab: Stats ------------
async function renderStats() {
  const total = vocab.length;
  const withZh = vocab.filter((v) => v.zh).length;
  const withoutZh = total - withZh;
  const withAudio = vocab.filter((v) => audioIndex[v.en]).length;
  const audioIndexed = Object.keys(audioIndex).length;

  const bySource = {};
  for (const v of vocab) {
    for (const s of (v.sources || [])) {
      bySource[s] = (bySource[s] || 0) + 1;
    }
  }
  const byLetter = {};
  for (const v of vocab) { byLetter[v.letter || '#'] = (byLetter[v.letter || '#'] || 0) + 1; }

  document.getElementById('content').innerHTML = `
    <h2>📊 统计</h2>
    <div id="daily"></div>
    <h3 style="margin-top:20px">词库总览（过滤后）</h3>
    <div class="stat-grid">
      ${[
        { n: total, k: '可学词条' },
        { n: withZh, k: '有中文释义' },
        { n: withoutZh, k: '待补释义' },
        { n: withAudio, k: '有音频的词条' },
        { n: audioIndexed, k: '音频索引数' },
        { n: sentences.length, k: '双语句对' },
      ].map(c => `<div class="stat-cell"><div class="n">${c.n}</div><div class="k">${c.k}</div></div>`).join('')}
    </div>
    <div class="card"><b>按来源：</b>
      <table style="width:100%; margin-top:8px"><tbody>
        ${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="card"><b>按首字母：</b>
      <table style="width:100%; margin-top:8px"><tbody>
        ${Object.entries(byLetter).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v}</td></tr>`).join('')}
      </tbody></table>
    </div>
  `;

  // Load and render user learning summary asynchronously
  const summary = await fetchUserSummary();
  const dailyDiv = document.getElementById('daily');
  if (!summary) {
    dailyDiv.innerHTML = '<div class="card"><p class="muted">尚未记录学习数据。做完一轮学习/复习后再看这里。</p></div>';
    return;
  }
  const t = summary.today_stats;
  const cells = [
    { n: summary.streak_days, k: '连续学习天数 🔥' },
    { n: t.new_words, k: '今日新词' },
    { n: t.reviewed, k: '今日复习' },
    { n: summary.due_today, k: '今日待复习' },
    { n: summary.total_learned, k: '累计学过' },
    { n: summary.total_mastered, k: '已完成 30 天计划' },
  ];
  const byLevelRows = summary.by_level.map((n, i) =>
    `<tr><td>${i === 0 ? '未学 (gate 0)' : 'gate ' + i}</td><td style="text-align:right">${n}</td></tr>`
  ).join('');
  dailyDiv.innerHTML = `
    <h3>📅 每日学习记录</h3>
    <div class="stat-grid">
      ${cells.map(c => `<div class="stat-cell"><div class="n">${c.n}</div><div class="k">${c.k}</div></div>`).join('')}
    </div>
    <div id="calendarWrap"></div>
    <div class="card">
      <b>词按熟练度（gate）分布：</b>
      <table style="width:100%; margin-top:8px"><tbody>${byLevelRows}</tbody></table>
    </div>
  `;
  await renderCalendar();
}

async function renderCalendar() {
  const wrap = document.getElementById('calendarWrap');
  wrap.innerHTML = '<div class="card"><p class="muted">加载日历中…</p></div>';
  const { past, upcoming } = await fetchCalendar(30, 7);
  const maxPast = Math.max(1, ...past.map((d) => d.new_words + d.reviewed));
  const maxUpcoming = Math.max(1, ...upcoming.map((d) => d.due));

  const pastGrid = past.map((d) => {
    const total = d.new_words + d.reviewed;
    const intensity = total === 0 ? 0 : Math.min(1, 0.15 + 0.85 * total / maxPast);
    const bg = intensity === 0
      ? 'var(--vscode-input-background)'
      : `rgba(76, 175, 80, ${intensity.toFixed(2)})`;
    const dayNum = d.date.slice(-2);
    return `<div class="cal-cell" data-date="${d.date}" data-kind="past"
      style="background:${bg}"
      title="${d.date}: 新学 ${d.new_words} · 复习 ${d.reviewed} · 正确 ${d.correct} / 错 ${d.incorrect}">
      <div class="cal-day">${dayNum}</div>
      ${total > 0 ? `<div class="cal-count">${total}</div>` : ''}
    </div>`;
  }).join('');

  const upcomingGrid = upcoming.map((d) => {
    const intensity = d.due === 0 ? 0 : Math.min(1, 0.15 + 0.85 * d.due / maxUpcoming);
    const bg = intensity === 0
      ? 'var(--vscode-input-background)'
      : `rgba(255, 152, 0, ${intensity.toFixed(2)})`;
    const dayNum = d.date.slice(-2);
    return `<div class="cal-cell" data-date="${d.date}" data-kind="upcoming"
      style="background:${bg}"
      title="${d.date}: 待复习 ${d.due} 词">
      <div class="cal-day">${dayNum}</div>
      ${d.due > 0 ? `<div class="cal-count">${d.due}</div>` : ''}
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="card">
      <b>近 30 天活跃度</b>
      <p class="muted" style="font-size:12px; margin:4px 0 12px">
        绿色格 = 已复习。颜色越深活动越多。
      </p>
      <div class="cal-grid">${pastGrid}</div>
    </div>
    <div class="card">
      <b>接下来 7 天复习计划</b>
      <p class="muted" style="font-size:12px; margin:4px 0 12px">
        橙色格 = 待复习。今日格包含之前落下的补测。
      </p>
      <div class="cal-grid">${upcomingGrid}</div>
    </div>
    <div id="dayDetail"></div>
  `;
  for (const cell of wrap.querySelectorAll('.cal-cell')) {
    cell.addEventListener('click', async () => {
      const date = cell.dataset.date;
      const detail = await fetchDayDetail(date);
      renderDayDetail(detail);
    });
  }
}

function renderDayDetail(detail) {
  const div = document.getElementById('dayDetail');
  if (!detail) { div.innerHTML = ''; return; }
  const revRows = detail.reviewed.map((w) =>
    `<tr><td>${escapeHtml(w.en)}</td><td>${escapeHtml(w.zh)}</td><td style="text-align:right">gate ${w.gate}</td><td style="text-align:right">${w.score}</td></tr>`
  ).join('');
  const schedRows = detail.scheduled.map((w) =>
    `<tr><td>${escapeHtml(w.en)}</td><td>${escapeHtml(w.zh)}</td><td style="text-align:right">关 ${w.gate}</td></tr>`
  ).join('');
  div.innerHTML = `
    <div class="card">
      <h3>📆 ${escapeHtml(detail.date)}</h3>
      <p class="muted">复习了 ${detail.reviewed_count} 词　·　该日待复习 ${detail.scheduled_count} 词</p>
      ${detail.reviewed.length > 0 ? `<h4>已复习：</h4>
        <table style="width:100%"><thead><tr><th style="text-align:left">EN</th><th style="text-align:left">ZH</th><th style="text-align:right">Gate</th><th style="text-align:right">分数</th></tr></thead><tbody>${revRows}</tbody></table>` : ''}
      ${detail.scheduled.length > 0 ? `<h4 style="margin-top:14px">待/曾复习：</h4>
        <table style="width:100%"><thead><tr><th style="text-align:left">EN</th><th style="text-align:left">ZH</th><th style="text-align:right">下一关</th></tr></thead><tbody>${schedRows}</tbody></table>` : ''}
      ${detail.reviewed.length === 0 && detail.scheduled.length === 0 ? '<p class="muted">这一天没有活动。</p>' : ''}
    </div>
  `;
}

boot();
