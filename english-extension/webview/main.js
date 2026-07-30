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
/** @type {Array<any>} */
let sentences = [];
/** @type {Object<string, {hash:string, us:string, uk:string}>} */
let audioIndex = {};

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
    const [v, s, a] = await Promise.all([
      loadJSON('unified_vocab.json'),
      loadJSON('unified_sentences.json').catch(() => []),
      loadJSON('audio_index.json').catch(() => ({})),
    ]);
    vocab = v;
    sentences = s;
    audioIndex = a;

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

function wireAudioButtons(root) {
  for (const b of root.querySelectorAll('.audio-btn')) {
    b.addEventListener('click', () => playAudio(b.dataset.en, b.dataset.accent));
  }
}

function cardHtml(v) {
  return `<div class="card">
    <div class="en">${escapeHtml(v.en)} ${audioBtns(v.en)}</div>
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

// ------------ Tab: Learn (M0 skeleton) ------------
function renderLearn() {
  const content = document.getElementById('content');
  const withZh = vocab.filter((v) => v.zh && v.en.split(' ').length <= 5);
  content.innerHTML = `
    <h2>🌱 新词学习</h2>
    <p class="muted">M0 骨架：随机抽 10 个"有中文释义、长度 ≤ 5 词"的词。之后会替换为 SRS 未见词队列。</p>
    <p><button id="draw10">抽 10 个新词</button></p>
    <div id="learnList"></div>
  `;
  content.querySelector('#draw10').addEventListener('click', () => {
    const draw = [...withZh].sort(() => Math.random() - 0.5).slice(0, 10);
    const learnList = document.getElementById('learnList');
    learnList.innerHTML = draw.map(cardHtml).join('');
    wireAudioButtons(learnList);
  });
}

// ------------ Tab: Review (Gate 1 demo) ------------
function renderReview() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <h2>🔁 复习：关 1 演示（EN → ZH，LLM 判分）</h2>
    <p class="muted">M0 骨架：随机抽 3 个词进入关 1 测试。判分调用 <code>vscode.lm</code>（GitHub Copilot）。</p>
    <p><button id="start">开始 3 词测试</button></p>
    <div id="quizArea"></div>
  `;
  content.querySelector('#start').addEventListener('click', () => {
    const pool = vocab.filter((v) => v.zh && v.en.split(' ').length <= 3);
    const words = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
    runGate1(words);
  });
}

let gradePending = new Map();
window.addEventListener('message', (evt) => {
  const m = evt.data;
  if (m.type === 'gradeResult' && gradePending.has(m.requestId)) {
    gradePending.get(m.requestId)(m.result);
    gradePending.delete(m.requestId);
  } else if (m.type === 'sentenceResult' && gradePending.has(m.requestId)) {
    gradePending.get(m.requestId)(m.result);
    gradePending.delete(m.requestId);
  } else if (m.type === 'setMode') {
    state.tab = m.mode;
    for (const b of document.querySelectorAll('.tab')) {
      b.classList.toggle('active', b.dataset.tab === m.mode);
    }
    render();
  }
});

function callLM(type, payload) {
  return new Promise((resolve) => {
    const requestId = String(Math.random()) + '-' + Date.now();
    gradePending.set(requestId, resolve);
    vscode.postMessage({ type, requestId, ...payload });
  });
}

function runGate1(words) {
  let idx = 0;
  const area = document.getElementById('quizArea');
  function show() {
    if (idx >= words.length) {
      area.innerHTML = `<div class="card"><p>关 1 完成 ✅</p></div>`;
      return;
    }
    const w = words[idx];
    area.innerHTML = `
      <div class="card quiz-card">
        <div class="quiz-target">${escapeHtml(w.en)} ${audioBtns(w.en)}</div>
        <div class="quiz-hint">请输入中文意思</div>
        <input class="quiz-input" id="ans" placeholder="任何合理的中文意思都算对（LLM 判分）">
        <p><button id="go">提交</button>
           <button class="secondary" id="skip">跳过</button></p>
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

// ------------ Tab: Stats ------------
function renderStats() {
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

  const cells = [
    { n: total, k: '总词条' },
    { n: withZh, k: '有中文释义' },
    { n: withoutZh, k: '待补释义（Google 10k）' },
    { n: withAudio, k: '有音频的词条' },
    { n: audioIndexed, k: 'audio_index 条目' },
    { n: sentences.length, k: '双语句对' },
  ];

  const sourceRows = Object.entries(bySource).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v}</td></tr>`).join('');
  const letterRows = Object.entries(byLetter).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v}</td></tr>`).join('');

  document.getElementById('content').innerHTML = `
    <h2>📊 统计</h2>
    <div class="stat-grid">
      ${cells.map(c => `<div class="stat-cell"><div class="n">${c.n}</div><div class="k">${c.k}</div></div>`).join('')}
    </div>
    <div class="card">
      <b>按来源：</b>
      <table style="width:100%; margin-top:8px"><tbody>${sourceRows}</tbody></table>
    </div>
    <div class="card">
      <b>按首字母：</b>
      <table style="width:100%; margin-top:8px"><tbody>${letterRows}</tbody></table>
    </div>
  `;
}

boot();
