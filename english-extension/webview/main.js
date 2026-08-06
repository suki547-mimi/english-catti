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
/** @type {Object<string, {us?:string, uk?:string, zh?:string}>} */
let sentenceAudioIndex = {};
/** Set of wordIds the user has starred as favorite. */
let favoriteWordIds = new Set();

let state = {
  tab: 'browse',
  letter: 'A',
  search: '',
  topicFilter: '',
  favOnly: false,
  learnSession: null,          // { wordIds:[], idx, known, unknown, startedAt }
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
    const [v, s, a, p, sa] = await Promise.all([
      loadJSON('unified_vocab.json'),
      loadJSON('unified_sentences.json').catch(() => []),
      loadJSON('audio_index.json').catch(() => ({})),
      loadJSON('phonetics.json').catch(() => ({})),
      loadJSON('sentence_audio_index.json').catch(() => ({})),
    ]);
    // Filter: keep only word/phrase, drop sentence-like entries (long, or classified as sentence)
    vocab = v.filter(isWordOrPhrase).map(cleanEntry).filter(isCleanEntry);
    vocabById = new Map(vocab.map((w) => [w.id, w]));
    sentences = s;
    audioIndex = a;
    phonetics = p;
    sentenceAudioIndex = sa;

    // Merge user-added vocab (from AI 助教) into the browse list.
    try {
      const uv = await callHost('getUserVocab');
      const items = (uv && uv.items) || [];
      for (const it of items) { mergeUserVocabEntry(it); }
    } catch { /* ignore */ }

    // Restore any in-progress learn session from disk (survives Reload Window).
    try {
      const m = await callHost('getLearnSession');
      if (m && m.session && m.session.wordIds && m.session.idx < m.session.wordIds.length) {
        state.learnSession = m.session;
      }
    } catch { /* ignore */ }

    // Load favorite words
    try {
      const fm = await callHost('getFavoriteWords');
      favoriteWordIds = new Set(fm.ids || []);
    } catch { /* ignore */ }

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

/** Insert (or update in place) a user-added word into the browse-time vocab
 *  array. Called at boot (batch) and after the tutor adds a new one. */
function mergeUserVocabEntry(uw) {
  if (!uw || !uw.id || !uw.en) { return; }
  const firstLetter = (String(uw.en).match(/[A-Za-z]/) || ['#'])[0].toUpperCase();
  const entry = {
    id: uw.id,
    en: uw.en,
    zh: uw.zh || '',
    letter: firstLetter,
    kind: 'user',
    topic: 'user',
    sources: [uw.source === 'tutor' ? 'AI 助教' : '手工添加'],
    note: uw.note || '',
    userAdded: true,
  };
  const existing = vocabById.get(uw.id);
  if (existing) {
    // Update in-place (keeps object identity for anything that cached refs).
    Object.assign(existing, entry);
  } else {
    vocab.unshift(entry);
    vocabById.set(uw.id, entry);
  }
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
  if (audioIndex[en]) {
    return `<button class="audio-btn" data-en="${escapeHtml(en)}" data-accent="us" title="美音">🇺🇸</button>
            <button class="audio-btn" data-en="${escapeHtml(en)}" data-accent="uk" title="英音">🇬🇧</button>`;
  }
  // Fallback for user-added words that have no prebuilt mp3: use the
  // sentence-audio pipeline (edge-tts on demand, cached under
  // audio/sentences/dynamic/<accent>/<hash>.mp3).
  const enText = encodeURIComponent(en);
  return `<button class="audio-btn sent-audio" data-text="${enText}" data-accent="us" title="美音（首次点击会生成）">🇺🇸</button>
          <button class="audio-btn sent-audio" data-text="${enText}" data-accent="uk" title="英音（首次点击会生成）">🇬🇧</button>`;
}

/** Look up phonetics for `en`. Only handles single-word entries (that's what our data has). */
function phoneticFor(en) {
  const key = String(en || '').trim().toLowerCase();
  if (!key.includes(' ')) {
    return phonetics[key] || null;
  }
  return null;
}

/** Split a phrase into content tokens (drop stopwords). */
const IPA_STOP = new Set(['a','an','the','to','of','in','on','for','with','by','at','and','or','not','no','as','be','is','are','was','were','this','that','these','those','from','into','upon','which','who','whom','what','when','where','how','why','its','his','her','their','our','my','your','him','them']);
function contentTokens(en) {
  const raw = String(en || '').match(/[a-zA-Z][a-zA-Z\-']+/g) || [];
  return raw.map((t) => t.toLowerCase()).filter((t) => !IPA_STOP.has(t) && t.length >= 2);
}

/** Render inline IPA badges. For single word: US + UK line.
 *  For phrase: one line per word showing that word's IPA. */
function phoneticBadges(en) {
  const tokens = contentTokens(en);
  if (tokens.length === 0) { return ''; }
  if (tokens.length === 1) {
    const p = phonetics[tokens[0]];
    if (!p || !p.ipa) { return ''; }
    const us = p.us || p.ipa;
    const uk = p.uk || p.ipa;
    const parts = [];
    if (us) { parts.push(`<span class="ipa" title="美音">🇺🇸 ${escapeHtml(us)}</span>`); }
    if (uk && uk !== us) { parts.push(`<span class="ipa" title="英音">🇬🇧 ${escapeHtml(uk)}</span>`); }
    return parts.length ? `<div class="ipa-line">${parts.join('')}</div>` : '';
  }
  // Multi-word phrase: per-word row
  const rows = [];
  for (const t of tokens) {
    const p = phonetics[t];
    if (!p || !p.ipa) { continue; }
    const us = p.us || p.ipa;
    const uk = p.uk || p.ipa;
    const usPart = us ? `🇺🇸 ${escapeHtml(us)}` : '';
    const ukPart = (uk && uk !== us) ? `🇬🇧 ${escapeHtml(uk)}` : '';
    rows.push(`<div class="ipa-word">
      <span class="ipa-w-en">${escapeHtml(t)}</span>
      <span class="ipa-w-p">${usPart}${usPart && ukPart ? ' · ' : ''}${ukPart}</span>
    </div>`);
  }
  return rows.length ? `<div class="ipa-phrase">${rows.join('')}</div>` : '';
}

function wireAudioButtons(root) {
  for (const b of root.querySelectorAll('.audio-btn')) {
    if (b.classList.contains('sent-audio')) {
      // Fallback path: user-added words with no prebuilt mp3 — use the
      // sentence-audio pipeline (edge-tts on demand).
      b.addEventListener('click', () => playSentenceAudio(b));
    } else {
      b.addEventListener('click', () => playAudio(b.dataset.en, b.dataset.accent));
    }
  }
}

function cardHtml(v) {
  const isFav = favoriteWordIds.has(v.id);
  return `<div class="card" data-word-id="${v.id}">
    <div class="en">${escapeHtml(v.en)} ${audioBtns(v.en)}
      <button class="word-fav-btn" data-word-fav="${v.id}" title="${isFav ? '取消收藏' : '收藏'}">${isFav ? '★' : '☆'}</button>
    </div>
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
  else if (state.tab === 'reading') { renderReading(); }
  else if (state.tab === 'tutor') { renderTutor(); }
  else if (state.tab === 'queried') { renderQueriedWords(); }
  else if (state.tab === 'stats') { renderStats(); }
}

// ------------ Tab: Browse ------------
function renderBrowse() {
  const content = document.getElementById('content');
  const letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','#'];
  content.innerHTML = `
    <input class="search" placeholder="搜索英文或中文…（回车过滤）" value="${escapeHtml(state.search)}">
    <div class="browse-filters">
      <button class="filter-chip ${state.favOnly ? 'active' : ''}" id="favToggle">
        ★ 只看收藏 (<b>${favoriteWordIds.size}</b>)
      </button>
    </div>
    <div class="letter-tabs">${letters.map(L => `<button data-letter="${L}" class="${L === state.letter ? 'active' : ''}">${L}</button>`).join('')}</div>
    <p class="muted" id="listMeta"></p>
    <div id="list"></div>
  `;
  content.querySelector('.search').addEventListener('input', (e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderList();
  });
  document.getElementById('favToggle').addEventListener('click', () => {
    state.favOnly = !state.favOnly;
    renderBrowse();
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
  const favFilter = state.favOnly ? (v) => favoriteWordIds.has(v.id) : () => true;
  if (state.search) {
    items = vocab.filter((v) => favFilter(v) && (v.en.toLowerCase().includes(state.search) || (v.zh || '').includes(state.search)));
    meta.textContent = `${state.favOnly ? '收藏中 ' : ''}匹配 ${items.length} 条（最多显示 200）`;
    items = items.slice(0, 200);
  } else if (state.favOnly) {
    items = vocab.filter((v) => favoriteWordIds.has(v.id));
    meta.textContent = `已收藏 ${items.length} 个词`;
  } else {
    items = vocab.filter((v) => v.letter === state.letter);
    meta.textContent = `字母 ${state.letter} 共 ${items.length} 条（最多显示 500）`;
    items = items.slice(0, 500);
  }
  list.innerHTML = items.map(cardHtml).join('');
  wireAudioButtons(list);
  wireFavoriteButtons(list);
}

function wireFavoriteButtons(root) {
  for (const b of root.querySelectorAll('[data-word-fav]')) {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.dataset.wordFav;
      const resp = await callHost('toggleFavoriteWord', { wordId: id });
      if (resp.favorited) {
        favoriteWordIds.add(id); b.textContent = '★'; b.title = '取消收藏';
      } else {
        favoriteWordIds.delete(id); b.textContent = '☆'; b.title = '收藏';
      }
    });
  }
}

// ------------ Tab: Learn ------------
async function renderLearn() {
  const content = document.getElementById('content');

  // If there's an unfinished session from today, offer to resume
  const s = state.learnSession;
  const today = new Date().toISOString().slice(0, 10);
  const hasUnfinished = s && s.startedAt.slice(0, 10) === today && s.idx < s.wordIds.length;

  content.innerHTML = `<p class="muted">加载中…</p>`;
  const learnedIds = await fetchLearnedIds();
  const summary = await fetchUserSummary();
  const unseen = vocab.filter((v) => v.zh && v.en.split(' ').length <= 5 && !learnedIds.has(v.id));
  const totalCandidates = vocab.filter((v) => v.zh && v.en.split(' ').length <= 5).length;
  const knownTotal = learnedIds.size;
  const dueToday = summary?.due_today || 0;
  const todayNew = summary?.today_stats?.new_words || 0;
  const DAILY_TARGET = 10;
  const remaining = Math.max(0, DAILY_TARGET - todayNew);
  const batchSize = remaining > 0 ? remaining : DAILY_TARGET;   // 补目标；已达标就再来一轮

  content.innerHTML = `
    <h2>🌱 新词学习</h2>
    <div class="progress-strip">
      <span class="chip-num chip-num-ok">🎯 今日新学 <b>${todayNew}</b> / ${DAILY_TARGET}</span>
      <span class="chip-num chip-num-warn">🔁 今日待复习 <b>${dueToday}</b></span>
      <span class="chip-num">📖 累计认识 <b>${knownTotal}</b></span>
      <span class="chip-num">📚 词库 <b>${totalCandidates}</b></span>
    </div>
    <p class="muted">
      ${remaining > 0
        ? `今日目标还剩 <b>${remaining}</b> 个。选"认识"进艾宾浩斯队列（1/2/4/7/15/30 天），选"不熟"下次可能再抽到。`
        : `今日目标已完成 🎉 想加练也行，再抽 ${DAILY_TARGET} 个。`}
    </p>
    <p>
      ${hasUnfinished ? `
        <button id="continueLearn">▶ 继续上次（${s.idx + 1} / ${s.wordIds.length}）</button>
        <button class="secondary" id="abandonLearn">放弃这轮，重新抽</button>
      ` : `
        <button id="startLearn">${remaining > 0 ? `开始学习 ${batchSize} 个新词` : `再学 ${batchSize} 个（加练）`}</button>
      `}
    </p>
    <div id="learnArea"></div>
  `;

  if (hasUnfinished) {
    document.getElementById('continueLearn').addEventListener('click', () => {
      const words = s.wordIds.map((id) => vocabById.get(id)).filter(Boolean);
      resumeLearnSession(words);
    });
    document.getElementById('abandonLearn').addEventListener('click', () => {
      state.learnSession = null;
      vscode.postMessage({ type: 'saveLearnSession', session: null });
      renderLearn();
    });
  } else {
    document.getElementById('startLearn').addEventListener('click', () => {
      const draw = [...unseen].sort(() => Math.random() - 0.5).slice(0, batchSize);
      if (draw.length === 0) {
        document.getElementById('learnArea').innerHTML = '<div class="card"><p>已经没有未学词了 🎉</p></div>';
        return;
      }
      state.learnSession = {
        wordIds: draw.map((w) => w.id),
        idx: 0, known: 0, unknown: 0,
        startedAt: new Date().toISOString(),
      };
      vscode.postMessage({ type: 'saveLearnSession', session: state.learnSession });
      runLearnSession(draw);
    });
  }
}

function resumeLearnSession(words) {
  runLearnSession(words);
}

function runLearnSession(words) {
  const session = state.learnSession;
  const area = document.getElementById('learnArea');
  const wordIds = session.wordIds;

  function finish() {
    vscode.postMessage({ type: 'finishLearnSession', wordIds, known: session.known, unknown: session.unknown });
    vscode.postMessage({ type: 'saveLearnSession', session: null });
    const doneKnown = session.known, doneUnknown = session.unknown, doneTotal = words.length;
    state.learnSession = null;
    // Re-render the whole learn tab so header chips ("今日新学 X/10") and the
    // "继续上次" button update. Then overlay the celebration inside learnArea.
    renderLearn().then(() => {
      const a = document.getElementById('learnArea');
      if (!a) { return; }
      a.innerHTML = `
        <div class="card">
          <h3>本轮结束 ✅</h3>
          <p>共学 ${doneTotal} 词，认识 ${doneKnown}，不熟 ${doneUnknown}</p>
          <p class="muted">"认识"的词已进入艾宾浩斯队列（明天开始复习）。</p>
        </div>
      `;
    });
  }

  async function showCard() {
    if (session.idx >= words.length) { finish(); return; }
    const w = words[session.idx];
    area.innerHTML = `
      <div class="card quiz-card">
        <div class="muted" style="margin-bottom:8px">${session.idx + 1} / ${words.length}</div>
        <div class="quiz-target">${escapeHtml(w.en)} ${audioBtns(w.en)}</div>
        ${phoneticBadges(w.en)}
        <div id="contextBox" class="context-box hidden"></div>
        <div class="quiz-hint">先想想意思，再揭示答案</div>
        <p><button id="reveal">揭示答案</button></p>
        <div id="revealed" class="hidden">
          <div class="result-box">
            <div style="font-size:18px; margin-bottom:6px">${escapeHtml(w.zh)}</div>
            <div class="muted" style="font-size:12px">${escapeHtml(w.topic || 'misc')} · ${escapeHtml((w.sources || []).join(', '))}</div>
          </div>
          <p style="margin-top:12px">这个词你：</p>
          <p>
            <button id="btnKnown" class="secondary chip-btn chip-ok" data-choice="known">✓ 认识</button>
            <button id="btnUnknown" class="secondary chip-btn chip-bad" data-choice="unknown">✗ 不熟</button>
            <button id="btnDeep" class="secondary chip-btn" style="margin-left:12px">🔍 深度学习</button>
          </p>
          <div id="deepArea"></div>
          <div class="advance-row">
            <span id="advanceHint" class="muted advance-hint">
              还需要：
              <span id="hintAssess" class="hint-need">选择 认识/不熟</span>
              <span class="muted">·</span>
              <span id="hintDeep" class="hint-need">打开一次深度学习</span>
            </span>
            <button id="btnNext" disabled title="需要先做上面两件事">下一个 →</button>
          </div>
        </div>
      </div>
    `;
    wireAudioButtons(area);
    // Load context sentence in background (default: 短句 mode)
    loadContextInto(document.getElementById('contextBox'), w);
    // Kick off prefetches for current + next 2 words in background:
    //   - Deep-study (LLM markdown)
    //   - Story mode context (LLM narrative)
    //   - Fun mode context (LLM social-media style)
    // By the time the user clicks the button / switches tab, results are cached.
    prefetchDeepStudy(w);
    prefetchContextMode(w, 'story');
    prefetchContextMode(w, 'fun');
    if (words[session.idx + 1]) {
      prefetchDeepStudy(words[session.idx + 1]);
      prefetchContextMode(words[session.idx + 1], 'story');
      prefetchContextMode(words[session.idx + 1], 'fun');
    }
    if (words[session.idx + 2]) {
      prefetchDeepStudy(words[session.idx + 2]);
    }

    // Local per-card state
    const cardState = {
      assessment: null,   // 'known' | 'unknown' | null
      deepOpened: false,
      recorded: false,    // whether we have posted to host yet
    };

    function updateNextButton() {
      const btn = document.getElementById('btnNext');
      const hintAssess = document.getElementById('hintAssess');
      const hintDeep = document.getElementById('hintDeep');
      if (cardState.assessment) { hintAssess.classList.add('done'); }
      else { hintAssess.classList.remove('done'); }
      if (cardState.deepOpened) { hintDeep.classList.add('done'); }
      else { hintDeep.classList.remove('done'); }
      const ready = !!cardState.assessment && cardState.deepOpened;
      btn.disabled = !ready;
      btn.title = ready ? '' : '需要先选择 认识/不熟，且至少打开一次深度学习';
      document.getElementById('advanceHint').classList.toggle('hidden', ready);
    }

    function pickAssessment(choice) {
      // Save immediately on first pick — records are persisted even if user
      // reloads before clicking 下一个.
      if (cardState.assessment === choice) { return; }
      const wasFirstPick = cardState.assessment === null;
      cardState.assessment = choice;
      const known = choice === 'known';
      if (wasFirstPick) {
        if (known) { session.known++; } else { session.unknown++; }
      }
      vscode.postMessage({ type: 'recordLearnResult', wordId: w.id, en: w.en, zh: w.zh, known });
      // Visual toggle
      document.getElementById('btnKnown').classList.toggle('chip-active', choice === 'known');
      document.getElementById('btnUnknown').classList.toggle('chip-active', choice === 'unknown');
      updateNextButton();
    }

    document.getElementById('reveal').addEventListener('click', () => {
      document.getElementById('revealed').classList.remove('hidden');
      document.getElementById('btnKnown').focus();
      updateNextButton();
    });
    document.getElementById('btnKnown').addEventListener('click', () => pickAssessment('known'));
    document.getElementById('btnUnknown').addEventListener('click', () => pickAssessment('unknown'));
    document.getElementById('btnDeep').addEventListener('click', () => {
      openDeepStudy(w);
      cardState.deepOpened = true;
      document.getElementById('btnDeep').classList.add('chip-active');
      updateNextButton();
    });
    document.getElementById('btnNext').addEventListener('click', () => {
      if (!cardState.assessment) { return; }
      // Record was already saved when assessment was picked.
      session.idx++;
      vscode.postMessage({ type: 'saveLearnSession', session: state.learnSession });
      showCard();
    });
  }
  showCard();
}

// ------------ Deep study panel ------------
const deepCache = new Map();   // wordId -> markdown
const deepInFlight = new Map(); // wordId -> Promise<string|null> (dedupe)
const chatHistories = new Map(); // wordId -> [{role, text}]

/** Generate a random session id. Uses crypto.randomUUID when available, else a
 *  timestamp-random fallback. Kept in sync between webview and store so a click
 *  in 🤖 AI 查询过 can restore the exact same transcript. */
function newSessionId() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
  } catch { /* ignore */ }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Warm the deep-study cache in the background so 🔍 深度学习 opens instantly.
 *  Prefetch is view-only — it does NOT create a persisted AI session; the real
 *  session is opened by openDeepStudy() when the user actually clicks. */
function prefetchDeepStudy(w) {
  if (!w || !w.id) { return; }
  if (deepCache.has(w.id) || deepInFlight.has(w.id)) { return; }
  const p = callHost('deepStudy', { en: w.en, zh: w.zh })
    .then((m) => {
      const md = m && m.markdown;
      if (md) { deepCache.set(w.id, md); }
      return md || null;
    })
    .catch(() => null)
    .finally(() => { deepInFlight.delete(w.id); });
  deepInFlight.set(w.id, p);
}

/** Open the deep-study modal for word `w`.
 *  `opts.sessionId` — replay an existing stored session (from the 🤖 AI 查询过 tab);
 *                    do NOT re-run deepStudy, do NOT bump query count.
 *  Otherwise a fresh sessionId is generated and the session is persisted so it
 *  shows up in 🤖 AI 查询过. */
async function openDeepStudy(w, opts) {
  opts = opts || {};
  const replaySessionId = opts.sessionId || null;
  const deep = document.getElementById('deepArea');
  if (!deep) { return; }
  deep.innerHTML = `
    <div class="deep-card">
      <div class="deep-header">
        <h4>🔍 深度学习：${escapeHtml(w.en)}</h4>
        <div class="deep-actions">
          <button class="secondary" id="deepChatBtn">💬 在 Copilot Chat 里继续问</button>
          <button class="secondary" id="deepClose">收起</button>
        </div>
      </div>
      <div id="deepBody" class="deep-body">
        <div class="deep-loading">⏳ 正在生成…（英英释义 / 常用度 / 近义词 / 影视名场面 / 高频搭配）</div>
      </div>
      <div class="deep-chat">
        <div id="chatLog" class="chat-log"></div>
        <div class="chat-input-row">
          <input id="chatInput" placeholder="继续问一个关于这个词的问题（例：跟 X 有什么区别？）">
          <button id="chatSend">发送</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('deepClose').addEventListener('click', () => { deep.innerHTML = ''; });
  document.getElementById('deepChatBtn').addEventListener('click', () => {
    vscode.postMessage({
      type: 'openInCopilotChat',
      query: `请帮我深入讲解英语单词 "${w.en}"（中文意思：${w.zh}）。包括英英释义、常用度、近义词辨析、美剧/英剧中的经典用例、高频搭配。`
    });
  });

  const body = document.getElementById('deepBody');

  // Decide the session: replay an existing one, or start a fresh persisted one.
  let sessionId;
  let history;
  let md = null;
  if (replaySessionId) {
    // History mode: pull the stored transcript and don't call deepStudy again.
    sessionId = replaySessionId;
    const resp = await callHost('getAiSession', { sessionId });
    const session = resp && resp.session;
    if (session && session.messages) {
      // The first assistant message of a deepStudy session is the study markdown.
      const first = session.messages.find((m) => m.role === 'assistant');
      md = first ? first.text : null;
      // The chat log = every message AFTER the initial study markdown.
      const rest = first ? session.messages.slice(session.messages.indexOf(first) + 1) : session.messages.slice();
      history = rest.map((m) => ({ role: m.role, text: m.text }));
      chatHistories.set(w.id, history);
    } else {
      body.innerHTML = '<div class="result-bad">⚠️ 找不到这段对话（可能已被清除）</div>';
      return;
    }
  } else {
    // Fresh session: generate an id, register with host + persist.
    sessionId = newSessionId();
    md = deepCache.get(w.id);
    if (!md) {
      const inflight = deepInFlight.get(w.id);
      if (inflight) { md = await inflight; }
    }
    if (md) {
      // Prefetch already produced the markdown — just persist the session; do
      // NOT spend another LLM call. Persistence is fire-and-forget.
      callHost('registerAiSession', { sessionId, mode: 'deepStudy', wordId: w.id, en: w.en, zh: w.zh, markdown: md })
        .catch(() => { /* ignore */ });
    } else {
      const m = await callHost('deepStudy', { en: w.en, zh: w.zh, wordId: w.id, sessionId });
      md = m && m.markdown;
      if (md) { deepCache.set(w.id, md); }
    }
    history = chatHistories.get(w.id) || [];
    chatHistories.set(w.id, history);
  }

  body.innerHTML = md ? renderMarkdown(md) : '<div class="result-bad">⚠️ 生成失败</div>';

  // Wire chat
  const chatLog = document.getElementById('chatLog');
  renderChat(chatLog, history);
  const chatInput = document.getElementById('chatInput');
  const send = async () => {
    const q = chatInput.value.trim();
    if (!q) { return; }
    chatInput.value = '';
    history.push({ role: 'user', text: q });
    renderChat(chatLog, history);
    const placeholder = { role: 'assistant', text: '⏳ …' };
    history.push(placeholder);
    renderChat(chatLog, history);
    const m = await callHost('chatWithWord', {
      en: w.en, zh: w.zh, wordId: w.id, sessionId,
      history: history.slice(0, -2), question: q,
    });
    // replace placeholder
    history[history.length - 1] = { role: 'assistant', text: (m && m.reply) || '⚠️ 无回复' };
    renderChat(chatLog, history);
  };
  document.getElementById('chatSend').addEventListener('click', send);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}

function renderChat(root, history) {
  if (!history.length) { root.innerHTML = ''; return; }
  root.innerHTML = history.map((t) => {
    const cls = t.role === 'user' ? 'chat-turn-user' : 'chat-turn-ai';
    return `<div class="${cls}">${renderMarkdown(t.text)}</div>`;
  }).join('');
  root.scrollTop = root.scrollHeight;
}

/** Tiny Markdown renderer: headings, bold, italic, code, lists, paragraphs, links.
 *  Not a spec-compliant parser — enough for structured LLM output. */
function renderMarkdown(md) {
  if (!md) { return ''; }
  // Escape HTML first
  let s = String(md).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // Code fences
  s = s.replace(/```([\s\S]*?)```/g, (m, code) => `<pre><code>${code}</code></pre>`);
  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Headings
  s = s.replace(/^###### (.*)$/gm, '<h6>$1</h6>')
       .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
       .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
       .replace(/^### (.*)$/gm, '<h3>$1</h3>')
       .replace(/^## (.*)$/gm, '<h4 class="md-h2">$1</h4>')
       .replace(/^# (.*)$/gm, '<h3 class="md-h1">$1</h3>');
  // Bold + italic
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  s = s.replace(/(?<!_)_([^_]+)_(?!_)/g, '<i>$1</i>');
  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Lists (basic — group consecutive `- ` lines into <ul>)
  s = s.replace(/((?:^- .+\n?)+)/gm, (m) => {
    const items = m.trim().split(/\n/).map(line => `<li>${line.replace(/^- /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  // Numbered lists
  s = s.replace(/((?:^\d+\. .+\n?)+)/gm, (m) => {
    const items = m.trim().split(/\n/).map(line => `<li>${line.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  // Paragraphs from blank-line-separated blocks
  s = s.split(/\n{2,}/).map(block => {
    block = block.trim();
    if (!block) { return ''; }
    if (/^<(h[1-6]|ul|ol|pre|blockquote|table)/.test(block)) { return block; }
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return s;
}

// ------------ Context sentence lookup ------------
const contextCache = new Map();  // wordId -> {en, zh, source}

/** Find a bilingual example sentence that ACTUALLY contains the target word/phrase.
 *  Strategy:
 *    1. For phrases (≥ 2 tokens): require the FULL phrase in the sentence
 *       (allow hyphen ↔ space, optional inflection tail). If not found, go LLM.
 *    2. For single words: require exact word (word-boundary match). If not found, go LLM.
 *  This avoids the old bug where "Cross retaliation" matched any sentence with "cross". */
async function findContextForWord(w) {
  if (contextCache.has(w.id)) { return contextCache.get(w.id); }
  const tokens = contentTokens(w.en);
  const primary = tokens[0] || w.en.toLowerCase();
  const isPhrase = tokens.length >= 2;

  let hit = null;
  let target = w.en;

  if (isPhrase) {
    // Build a flexible regex: words separated by whitespace OR hyphen, optional inflection tail
    // e.g. "Cross retaliation" → /\bcross[-\s]+retaliation[a-z]*\b/i
    const escapedTokens = tokens.map((t) => escapeRegex(t));
    const phrasePattern = new RegExp(`\\b${escapedTokens.join('[-\\s]+')}[a-z]*\\b`, 'i');
    hit = sentences.find((s) => phrasePattern.test(s.en || ''));
    target = w.en;
  } else {
    // Single word: strict word-boundary match with allowed inflection tail
    const singlePattern = new RegExp(`\\b${escapeRegex(primary)}[a-z]*\\b`, 'i');
    hit = sentences.find((s) => singlePattern.test(s.en || ''));
    target = primary;
  }

  if (hit) {
    const ctx = {
      en: hit.en, zh: hit.zh,
      source: hit.source || (hit.sources && hit.sources.join(',')) || 'corpus',
      target,
    };
    contextCache.set(w.id, ctx);
    return ctx;
  }

  // LLM fallback — for a phrase, tell the LLM explicitly it's a phrase
  try {
    const m = await callHost('generateContext', { en: w.en, zh: w.zh });
    if (m && m.result && m.result.en && m.result.zh) {
      const ctx = { ...m.result, source: 'llm', target };
      contextCache.set(w.id, ctx);
      return ctx;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cache LLM-generated modes separately: contextModeCache[wordId][mode] = {en, zh}
const contextModeCache = new Map();
const contextModeInFlight = new Map();  // key `${wordId}:${mode}` -> Promise
function getCachedMode(wordId, mode) {
  const m = contextModeCache.get(wordId);
  return m ? m[mode] : null;
}
function setCachedMode(wordId, mode, ctx) {
  let m = contextModeCache.get(wordId);
  if (!m) { m = {}; contextModeCache.set(wordId, m); }
  m[mode] = ctx;
}

/** Warm the story/fun context cache in background — called from showCard()
 *  so switching to 📖 故事 / 🌸 小红书 is instant. */
function prefetchContextMode(w, mode) {
  if (!w || !w.id || (mode !== 'story' && mode !== 'fun')) { return; }
  if (getCachedMode(w.id, mode)) { return; }
  const key = `${w.id}:${mode}`;
  if (contextModeInFlight.has(key)) { return; }
  const msgType = mode === 'story' ? 'generateStoryContext' : 'generateFunContext';
  const p = callHost(msgType, { en: w.en, zh: w.zh })
    .then((resp) => {
      if (resp && resp.result && resp.result.en) {
        setCachedMode(w.id, mode, {
          en: resp.result.en,
          zh: resp.result.zh,
          source: mode === 'story' ? 'llm-story' : 'llm-fun',
          target: w.en,
        });
      }
    })
    .catch(() => { /* ignore */ })
    .finally(() => { contextModeInFlight.delete(key); });
  contextModeInFlight.set(key, p);
}

/** Load context box with mode selector: 短句 / 故事 / 小红书. Chinese is hidden by default; click 👁 to reveal. */
async function loadContextInto(box, w, mode = 'short') {
  if (!box) { return; }
  box.classList.remove('hidden');
  const tabsHtml = `
    <div class="context-mode-tabs">
      <button class="ctx-mode ${mode === 'short' ? 'active' : ''}" data-mode="short">📝 短句</button>
      <button class="ctx-mode ${mode === 'story' ? 'active' : ''}" data-mode="story">📖 故事</button>
      <button class="ctx-mode ${mode === 'fun' ? 'active' : ''}" data-mode="fun">🌸 小红书</button>
    </div>
  `;
  box.innerHTML = `${tabsHtml}<div class="context-loading">🌀 加载${mode === 'short' ? '短句' : mode === 'story' ? '故事' : '小红书笔记'}中…</div>`;
  // Wire mode-switching tabs immediately (so user can click even while loading)
  for (const b of box.querySelectorAll('.ctx-mode')) {
    b.addEventListener('click', () => loadContextInto(box, w, b.dataset.mode));
  }

  let ctx;
  if (mode === 'short') {
    ctx = await findContextForWord(w);
  } else {
    // Check cache first
    ctx = getCachedMode(w.id, mode);
    if (!ctx) {
      // If a background prefetch is already running, wait for it (don't spawn duplicate)
      const key = `${w.id}:${mode}`;
      const inflight = contextModeInFlight.get(key);
      if (inflight) {
        await inflight;
        ctx = getCachedMode(w.id, mode);
      }
      if (!ctx) {
        const msgType = mode === 'story' ? 'generateStoryContext' : 'generateFunContext';
        const resp = await callHost(msgType, { en: w.en, zh: w.zh });
        if (resp && resp.result && resp.result.en) {
          ctx = { en: resp.result.en, zh: resp.result.zh, source: mode === 'story' ? 'llm-story' : 'llm-fun', target: w.en };
          setCachedMode(w.id, mode, ctx);
        }
      }
    }
  }

  if (!ctx) {
    box.innerHTML = `${tabsHtml}<div class="result-bad" style="padding:12px">⚠️ 生成失败，请重试或切别的模式</div>`;
    for (const b of box.querySelectorAll('.ctx-mode')) {
      b.addEventListener('click', () => loadContextInto(box, w, b.dataset.mode));
    }
    return;
  }

  const highlighted = highlightWord(ctx.en, ctx.target || w.en);
  const enText = encodeURIComponent(ctx.en);
  const zhText = encodeURIComponent(ctx.zh);
  const sourceLabel = ctx.source === 'llm-story' ? '故事 · LLM'
                    : ctx.source === 'llm-fun' ? '小红书 · LLM'
                    : ctx.source === 'llm' ? '短句 · LLM'
                    : `短句 · ${ctx.source}`;
  box.innerHTML = `
    ${tabsHtml}
    <div class="context-tag">📖 ${escapeHtml(sourceLabel)}</div>
    <div class="context-en">${highlighted}
      <span class="sent-audio-group">
        <button class="audio-btn sent-audio" data-text="${enText}" data-accent="us" title="美音">🇺🇸</button>
        <button class="audio-btn sent-audio" data-text="${enText}" data-accent="uk" title="英音">🇬🇧</button>
      </span>
    </div>
    <div class="context-zh-wrapper">
      <button class="ctx-reveal-zh" id="ctxRevealZh">👁 显示中文翻译</button>
      <div class="context-zh hidden" id="ctxZh">${escapeHtml(ctx.zh)}
        <button class="audio-btn sent-audio" data-text="${zhText}" data-accent="zh" title="中文朗读">🔊</button>
      </div>
    </div>
  `;
  // Re-wire mode tabs (they were replaced by innerHTML)
  for (const b of box.querySelectorAll('.ctx-mode')) {
    b.addEventListener('click', () => loadContextInto(box, w, b.dataset.mode));
  }
  // Reveal-Chinese toggle
  const revealBtn = document.getElementById('ctxRevealZh');
  const zhEl = document.getElementById('ctxZh');
  revealBtn.addEventListener('click', () => {
    zhEl.classList.toggle('hidden');
    revealBtn.classList.toggle('hidden');
  });
  // Audio buttons
  for (const b of box.querySelectorAll('.sent-audio')) {
    b.addEventListener('click', () => playSentenceAudio(b));
  }
}

async function playSentenceAudio(btn) {
  const text = decodeURIComponent(btn.dataset.text || '');
  const accent = btn.dataset.accent;
  if (!text) { return; }
  const hash = sentenceHash(text);
  // 1. Try static index (batch-generated)
  let relPath = findSentenceAudio(hash, accent);
  // 2. Try dynamic cache location (predictable path)
  if (!relPath) {
    relPath = `audio/sentences/dynamic/${accent}/${hash}.mp3`;
  }
  const play = (p) => {
    const a = new Audio(`${dataBase}/${p}`);
    a.play().catch(() => {
      // Not cached → request generation
      requestSentenceGen(text, accent, btn);
    });
  };
  // Optimistic play; onerror path triggers generation
  const audio = new Audio(`${dataBase}/${relPath}`);
  audio.play().catch(() => requestSentenceGen(text, accent, btn));
}

const sentenceGenCache = new Map(); // key `${accent}:${hash}` -> Promise<string|null>

function requestSentenceGen(text, accent, btn) {
  const hash = sentenceHash(text);
  const key = `${accent}:${hash}`;
  const original = btn.textContent;
  btn.textContent = '🔄';
  btn.disabled = true;
  let p = sentenceGenCache.get(key);
  if (!p) {
    p = callHost('generateSentenceAudio', { text, accent }).then((m) => m && m.path);
    sentenceGenCache.set(key, p);
  }
  p.then((relPath) => {
    btn.textContent = original;
    btn.disabled = false;
    if (relPath) {
      new Audio(`${dataBase}/${relPath}`).play().catch((e) => console.warn('gen play failed', e));
    } else {
      btn.textContent = '⚠️';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  });
}

/** Compute the same hash used by generate_sentence_audio.py. */
function sentenceHash(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) { return ''; }
  return sha1(t).slice(0, 16);
}

/** Find the audio path for a sentence hash. Also matches by full-index scan. */
function findSentenceAudio(hash, kind) {
  if (!hash) { return null; }
  // Direct scan through index for matching kind path containing hash
  for (const entry of Object.values(sentenceAudioIndex)) {
    if (entry[kind] && entry[kind].includes(hash)) { return entry[kind]; }
  }
  return null;
}

/** Minimal SHA1 implementation for WebView (no crypto module). */
function sha1(str) {
  function rotl(n, s) { return (n << s) | (n >>> (32 - s)); }
  function toHex(n) {
    let s = '';
    for (let i = 7; i >= 0; i--) { s += ((n >>> (i * 4)) & 0xf).toString(16); }
    return s;
  }
  const utf8 = new TextEncoder().encode(str);
  const msg = new Uint8Array(Math.ceil((utf8.length + 9) / 64) * 64);
  msg.set(utf8);
  msg[utf8.length] = 0x80;
  const bitLen = utf8.length * 8;
  const view = new DataView(msg.buffer);
  view.setUint32(msg.length - 4, bitLen);
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  for (let chunk = 0; chunk < msg.length; chunk += 64) {
    const w = new Array(80);
    for (let i = 0; i < 16; i++) { w[i] = view.getUint32(chunk + i * 4); }
    for (let i = 16; i < 80; i++) { w[i] = rotl(w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16], 1); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return toHex(h0 >>> 0) + toHex(h1 >>> 0) + toHex(h2 >>> 0) + toHex(h3 >>> 0) + toHex(h4 >>> 0);
}

function highlightWord(text, target) {
  if (!target) { return escapeHtml(text); }
  const safe = escapeHtml(text);
  const tokens = String(target).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) { return safe; }
  // Build a pattern matching the full phrase (allow hyphen or whitespace between tokens)
  // and optional inflection tail on each end token.
  const escapedTokens = tokens.map((t) => escapeRegex(t));
  const pattern = escapedTokens.length === 1
    ? new RegExp(`\\b(${escapedTokens[0]}[a-z]*)`, 'gi')
    : new RegExp(`\\b(${escapedTokens.join('[-\\s]+')}[a-z]*)\\b`, 'gi');
  return safe.replace(pattern, '<mark>$1</mark>');
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
  const due = await fetchEbbinghausDue(200, true);   // capped at DAILY_REVIEW_CAP (20)
  const summary = await fetchUserSummary();
  const totalLearned = summary?.total_learned || 0;
  const backlog = summary?.review_backlog || due.length;
  const cap = summary?.daily_review_cap || 20;
  const overflow = Math.max(0, backlog - due.length);
  const byGate = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const d of due) { byGate[d.gate] = (byGate[d.gate] || 0) + 1; }
  const emptyHint = totalLearned === 0
    ? '还没有已学的词。请先去"学习" tab 学几个新词。'
    : '✨ 今天你新学的词按艾宾浩斯曲线安排在 <b>明天</b> 复习（间隔 1 天）。已到期的词会自动出现在这里。';
  const backlogLine = overflow > 0
    ? `<p class="muted" style="margin-top:4px">📦 累计逾期 <b>${backlog}</b> 词，为保障学习质量今天只推 ${cap} 个，剩下的 ${overflow} 个明天优先。</p>`
    : '';
  body.innerHTML = `
    <div class="card">
      <b>今日应复习：${due.length} 词</b>
      <p class="muted" style="margin-top:6px">按记忆曲线到期（含之前落下的补测）。</p>
      ${backlogLine}
      <div style="margin-top:12px; font-size:13px; color:var(--vscode-descriptionForeground)">
        关卡分布：
        ${[1,2,3,4,5].map(g => `<span style="margin-right:12px">关 ${g}: <b>${byGate[g]||0}</b></span>`).join('')}
      </div>
      ${due.length === 0 ? `<p class="muted" style="margin-top:10px">${emptyHint}</p>` : ''}
      <p style="margin-top:14px">
        <button id="startEbb" ${due.length === 0 ? 'disabled' : ''}>
          ${due.length === 0 ? '今日没有到期词' : `开始复习（${due.length} 个）`}
        </button>
      </p>
    </div>
    <div id="reviewArea"></div>
  `;
  if (due.length > 0) {
    document.getElementById('startEbb').addEventListener('click', () => {
      runEbbinghausSession(due);
    });
  }
}

async function renderScoreOverview() {
  const body = document.getElementById('reviewBody');
  const pool = await fetchScorePool();
  const summary = await fetchUserSummary();
  const totalLearned = summary?.total_learned || 0;
  const avgScore = pool.length ? (pool.reduce((s, p) => s + p.score, 0) / pool.length) : 0;
  const emptyHint = totalLearned === 0
    ? '还没有已学的词。请先去"学习" tab 学几个新词。'
    : `你已学 <b>${totalLearned}</b> 个词，但今天已经全部接触过一遍了 ✨ 明天回来可以接着练。`;
  body.innerHTML = `
    <div class="card">
      <b>可复习池：${pool.length} 词</b>（已学过的词，今天未复习过的）
      <p class="muted" style="margin-top:6px">越低分/低 gate 的词权重越高；每次随机抽 10 个练关 1。</p>
      <p style="margin-top:8px">平均分：<b>${avgScore.toFixed(1)}</b>/100</p>
      ${pool.length === 0 ? `<p class="muted" style="margin-top:10px">${emptyHint}</p>` : ''}
      <p style="margin-top:14px">
        <button id="startScore" ${pool.length === 0 ? 'disabled' : ''}>
          ${pool.length === 0 ? '今日没可练的' : '开始复习 10 个'}
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
 * Generic quiz runner. Dispatches to a gate-specific renderer based on w._dueGate.
 *   Gate 1: EN → ZH (semantic LLM grade)                             — done
 *   Gate 2: ZH → EN (semantic LLM grade)                             — done
 *   Gate 3: Collocation cloze (LLM-generated fill-in-the-blank)      — done
 *   Gate 4: Sentence writing (grammar + usage LLM grade)             — done
 *   Gate 5: Context cloze from corpus sentence (fallback: LLM-gen)   — done
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

  function submitResult(w, gate, pass, feedback) {
    if (pass) { correct++; } else { incorrect++; }
    const recordMsg = mode === 'ebbinghaus' ? 'recordEbbinghausReview' : 'recordScoreReview';
    vscode.postMessage({ type: recordMsg, wordId: w.id, en: w.en, zh: w.zh, gate, pass });
    document.getElementById('res').innerHTML = `
      <div class="result-box">
        <p class="${pass ? 'result-ok' : 'result-bad'}"><b>${pass ? '✓ 正确' : '✗ 需改进'}</b>：${escapeHtml(feedback || '')}</p>
        <p class="muted">参考：${escapeHtml(w.en)} — ${escapeHtml(w.zh)} ${audioBtns(w.en)}</p>
        <div class="review-post-actions">
          <button id="reviewDeep" class="secondary chip-btn">🔍 深度学习</button>
          <button id="reviewCtxShort" class="secondary chip-btn" data-mode="short">📝 短句</button>
          <button id="reviewCtxStory" class="secondary chip-btn" data-mode="story">📖 故事</button>
          <button id="reviewCtxFun" class="secondary chip-btn" data-mode="fun">🌸 小红书</button>
          <button id="next" class="chip-btn" style="margin-left:auto">下一个 →</button>
        </div>
        <div id="deepArea"></div>
        <div id="contextBox" class="context-box hidden"></div>
      </div>
    `;
    wireAudioButtons(document.getElementById('res'));
    document.getElementById('next').addEventListener('click', () => { idx++; show(); });
    document.getElementById('reviewDeep').addEventListener('click', () => {
      openDeepStudy(w);
      document.getElementById('reviewDeep').classList.add('chip-active');
    });
    const ctxBox = document.getElementById('contextBox');
    for (const id of ['reviewCtxShort', 'reviewCtxStory', 'reviewCtxFun']) {
      const btn = document.getElementById(id);
      btn.addEventListener('click', () => {
        loadContextInto(ctxBox, w, btn.dataset.mode);
        for (const other of ['reviewCtxShort', 'reviewCtxStory', 'reviewCtxFun']) {
          document.getElementById(other).classList.toggle('chip-active', other === id);
        }
      });
    }
  }

  function show() {
    if (idx >= words.length) { finish(); return; }
    const w = words[idx];
    const gate = w._dueGate || 1;
    switch (gate) {
      case 2: renderGate2(w, gate); break;
      case 3: renderGate3(w, gate); break;
      case 4: renderGate4(w, gate); break;
      case 5: renderGate5(w, gate); break;
      default: renderGate1(w, gate);
    }
  }

  function gateHeader(w, gate, label) {
    return `<div class="muted" style="margin-bottom:8px">${idx + 1} / ${words.length}　·　<span class="gate-badge gate-${gate}">关 ${gate}</span> · ${label}</div>`;
  }

  // ---------- Gate 1: EN → ZH ----------
  function renderGate1(w, gate) {
    area.innerHTML = `
      <div class="card quiz-card">
        ${gateHeader(w, gate, '看英文，说中文')}
        <div class="quiz-target">${escapeHtml(w.en)} ${audioBtns(w.en)}</div>
        ${phoneticBadges(w.en)}
        <div class="quiz-hint">请输入中文意思</div>
        <input class="quiz-input" id="ans" placeholder="任何合理的中文意思都算对（LLM 判分）">
        <p><button id="go">提交</button> <button class="secondary" id="skip">跳过</button></p>
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
      submitResult(w, gate, r.correct, r.feedback);
    };
    document.getElementById('go').addEventListener('click', submit);
    document.getElementById('ans').addEventListener('keydown', (e) => { if (e.key === 'Enter') { submit(); } });
  }

  // ---------- Gate 2: ZH → EN ----------
  function renderGate2(w, gate) {
    area.innerHTML = `
      <div class="card quiz-card">
        ${gateHeader(w, gate, '看中文，写英文')}
        <div class="quiz-target" style="font-size:20px">${escapeHtml(w.zh)}</div>
        <div class="quiz-hint">请写出对应的英文单词/短语</div>
        <input class="quiz-input" id="ans" placeholder="同义词、词形变化也算对">
        <p><button id="go">提交</button> <button class="secondary" id="skip">跳过</button></p>
        <div id="res"></div>
      </div>
    `;
    document.getElementById('ans').focus();
    document.getElementById('skip').addEventListener('click', () => { idx++; show(); });
    const submit = async () => {
      const val = document.getElementById('ans').value.trim();
      if (!val) { return; }
      document.getElementById('res').innerHTML = '<p class="muted">LLM 判分中…</p>';
      const r = await callLM('gradeReverseSemantic', { userEn: val, targetEn: w.en, zhHint: w.zh });
      submitResult(w, gate, r.correct, r.feedback);
    };
    document.getElementById('go').addEventListener('click', submit);
    document.getElementById('ans').addEventListener('keydown', (e) => { if (e.key === 'Enter') { submit(); } });
  }

  // ---------- Gate 3: Collocation cloze ----------
  async function renderGate3(w, gate) {
    // Do NOT reveal w.en (that IS the answer) and don't spoon-feed w.zh either
    // — the LLM-generated hint below is enough. The reference is revealed in
    // the result box after submit.
    area.innerHTML = `
      <div class="card quiz-card">
        ${gateHeader(w, gate, '搭配填空')}
        <div id="clozeArea"><p class="muted" style="margin-top:12px">🌀 生成题目中…</p></div>
      </div>
    `;
    const cloze = await callHost('generateCollocationCloze', { en: w.en, zh: w.zh });
    const c = cloze.result;
    if (!c) {
      // Fallback: skip gracefully
      document.getElementById('clozeArea').innerHTML = `<p class="result-bad">⚠️ 生成失败，跳过此题</p>
        <p><button id="skipG3">下一个</button></p>`;
      document.getElementById('skipG3').addEventListener('click', () => { idx++; show(); });
      return;
    }
    // Safety net: if the LLM forgot to blank the target word inside the stem
    // (which would defeat the whole point), mask any lingering occurrence.
    let stem = String(c.stem || '');
    const enRaw = String(w.en || '').trim();
    if (enRaw) {
      try {
        const rx = new RegExp(`\\b${escapeRegex(enRaw)}\\b`, 'gi');
        stem = stem.replace(rx, '_____');
      } catch { /* ignore bad regex */ }
    }
    document.getElementById('clozeArea').innerHTML = `
      <div class="cloze-stem">${escapeHtml(stem)}</div>
      <div class="quiz-hint">${escapeHtml(c.hint || '填入合适的词')}</div>
      <input class="quiz-input" id="ans" placeholder="填空">
      <p><button id="go">提交</button> <button class="secondary" id="skip">跳过</button></p>
      <div id="res"></div>
    `;
    document.getElementById('ans').focus();
    document.getElementById('skip').addEventListener('click', () => { idx++; show(); });
    const submit = async () => {
      const val = document.getElementById('ans').value.trim();
      if (!val) { return; }
      document.getElementById('res').innerHTML = '<p class="muted">LLM 判分中…</p>';
      const r = await callLM('gradeCollocation', { userAnswer: val, expected: c.answer, stem: c.stem });
      submitResult(w, gate, r.correct, `${r.feedback} · 期待: ${c.answer}`);
    };
    document.getElementById('go').addEventListener('click', submit);
    document.getElementById('ans').addEventListener('keydown', (e) => { if (e.key === 'Enter') { submit(); } });
  }

  // ---------- Gate 4: Sentence writing ----------
  function renderGate4(w, gate) {
    area.innerHTML = `
      <div class="card quiz-card">
        ${gateHeader(w, gate, '用这个词造句')}
        <div class="quiz-target">${escapeHtml(w.en)} ${audioBtns(w.en)}</div>
        ${phoneticBadges(w.en)}
        <div class="muted">意思：${escapeHtml(w.zh)}</div>
        <div class="quiz-hint">写一个英文句子，用到这个词，考察语法和用词是否地道</div>
        <textarea class="quiz-input" id="ans" rows="3" placeholder="例如：After the meeting, we decided to..."></textarea>
        <p><button id="go">提交</button> <button class="secondary" id="skip">跳过</button></p>
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
      const r = await callLM('gradeSentence', { sentence: val, targetWord: w.en, chineseMeaning: w.zh });
      submitResult(w, gate, r.correct, r.feedback);
    };
    document.getElementById('go').addEventListener('click', submit);
  }

  // ---------- Gate 5: Context cloze from real corpus sentence ----------
  function renderGate5(w, gate) {
    // Try to find a corpus sentence containing the target word
    const tokens = contentTokens(w.en);
    const primary = tokens[0] || w.en.toLowerCase();
    const rx = new RegExp(`\\b(${escapeRegex(primary)}[a-z]*)`, 'i');
    const hit = sentences.find((s) => rx.test(s.en || ''));
    if (!hit) {
      // Fallback: use LLM-generated context (via generateContext) then blank the word
      area.innerHTML = `
        <div class="card quiz-card">
          ${gateHeader(w, gate, '语境填空')}
          <div class="muted">意思：${escapeHtml(w.zh)}</div>
          <p class="muted" style="margin-top:12px">🌀 从语料库找不到，用 LLM 现场生成…</p>
        </div>
      `;
      (async () => {
        const m = await callHost('generateContext', { en: w.en, zh: w.zh });
        const ctx = m && m.result;
        if (!ctx || !ctx.en) {
          area.innerHTML = `<div class="card"><p class="result-bad">⚠️ 无法生成语境题</p>
            <p><button id="skipG5">下一个</button></p></div>`;
          document.getElementById('skipG5').addEventListener('click', () => { idx++; show(); });
          return;
        }
        showClozeSentence(w, gate, ctx.en, primary);
      })();
      return;
    }
    showClozeSentence(w, gate, hit.en, primary);
  }

  function showClozeSentence(w, gate, enSentence, primary) {
    const match = enSentence.match(new RegExp(`\\b(${escapeRegex(primary)}[a-z]*)`, 'i'));
    const actualWord = match ? match[1] : primary;
    const blanked = enSentence.replace(new RegExp(`\\b${escapeRegex(actualWord)}\\b`, 'i'), '_____');
    area.innerHTML = `
      <div class="card quiz-card">
        ${gateHeader(w, gate, '语境填空')}
        <div class="muted">意思：${escapeHtml(w.zh)}</div>
        <div class="cloze-sentence">${escapeHtml(blanked)}</div>
        <div class="quiz-hint">填入原句里被挖掉的目标词（可含时态/单复数变化）</div>
        <input class="quiz-input" id="ans" placeholder="填空">
        <p><button id="go">提交</button> <button class="secondary" id="skip">跳过</button></p>
        <div id="res"></div>
      </div>
    `;
    document.getElementById('ans').focus();
    document.getElementById('skip').addEventListener('click', () => { idx++; show(); });
    const submit = async () => {
      const val = document.getElementById('ans').value.trim();
      if (!val) { return; }
      document.getElementById('res').innerHTML = '<p class="muted">LLM 判分中…</p>';
      const r = await callLM('gradeContextCloze', { userAnswer: val, expected: actualWord, sentence: enSentence });
      submitResult(w, gate, r.correct, r.feedback);
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
async function fetchEbbinghausDue(limit = 200, capped = false) {
  const m = await callHost('getEbbinghausDue', { limit, capped });
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

// ============ Tab: AI Tutor (free-form chat) ============
const tutorHistory = [];   // [{role: 'user'|'assistant', text}]
/** Session id for the current tutor conversation. Generated lazily on first
 *  send so an empty tab doesn't create empty sessions. Reset by 清空对话. */
let tutorSessionId = null;
/** Track which tutor-added words already made it into the vocab this session
 *  so pills for already-added words render as ✅ instead of ➕. */
const tutorAddedEnLower = new Set();

async function renderTutor() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <h2>💬 AI 助教</h2>
    <p class="muted">和 Copilot 深度聊英语——释义、辨析、翻译难点、文化背景、写作润色都行。<b>助教会把值得学的英文加粗</b>，点旁边的 <code>➕ 加入词本</code> 就能收进 📖 词本。</p>
    <div class="tutor-container">
      <div id="tutorLog" class="tutor-log"></div>
      <div class="tutor-input-row">
        <textarea id="tutorInput" class="tutor-input" rows="3"
          placeholder="例：辨析 forgive vs pardon vs excuse 的差别 / 翻译"绵绵不绝的思念" / 讲下 The Wire 里 pearl-clutching 的用法"></textarea>
        <div class="tutor-actions">
          <button id="tutorSend">发送 (Ctrl+Enter)</button>
          <button class="secondary" id="tutorClear">清空对话</button>
          <button class="secondary" id="tutorExport">复制到 Copilot Chat</button>
        </div>
      </div>
    </div>
  `;
  renderTutorLog();
  const inputEl = document.getElementById('tutorInput');
  inputEl.focus();
  const send = async () => {
    const q = inputEl.value.trim();
    if (!q) { return; }
    if (!tutorSessionId) { tutorSessionId = newSessionId(); }
    tutorHistory.push({ role: 'user', text: q });
    renderTutorLog(true);
    inputEl.value = '';
    inputEl.disabled = true;
    const m = await callHost('chatFreeform', {
      history: tutorHistory.slice(0, -1),
      question: q,
      sessionId: tutorSessionId,
    });
    tutorHistory.push({ role: 'assistant', text: m.reply || '⚠️ 无响应' });
    inputEl.disabled = false;
    renderTutorLog(true);
    inputEl.focus();
  };
  document.getElementById('tutorSend').addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });
  document.getElementById('tutorClear').addEventListener('click', () => {
    if (tutorHistory.length === 0) { return; }
    if (confirm('清空全部对话历史？')) {
      tutorHistory.length = 0;
      tutorSessionId = null;   // start a fresh session next time
      renderTutorLog();
    }
  });
  document.getElementById('tutorExport').addEventListener('click', () => {
    if (tutorHistory.length === 0) { return; }
    const query = tutorHistory.map((t) => (t.role === 'user' ? '**我**：' : '**助教**：') + t.text).join('\n\n')
      + '\n\n---\n请继续这段对话。';
    vscode.postMessage({ type: 'openInCopilotChat', query });
  });
}

function renderTutorLog(scrollBottom = false) {
  const log = document.getElementById('tutorLog');
  if (!log) { return; }
  if (tutorHistory.length === 0) {
    log.innerHTML = `<div class="muted" style="padding:24px; text-align:center">还没有对话。上面输入框问点什么吧 👇</div>`;
    return;
  }
  log.innerHTML = tutorHistory.map((t, i) => `
    <div class="tutor-msg tutor-msg-${t.role}" data-msg-idx="${i}">
      <div class="tutor-msg-label">${t.role === 'user' ? '你' : '💬 助教'}</div>
      <div class="tutor-msg-body">${renderMarkdown(t.text)}</div>
    </div>
  `).join('');
  // Decorate every assistant reply: turn <strong> English phrases into
  // clickable "➕ 加入词本" pills.
  for (const msg of log.querySelectorAll('.tutor-msg-assistant')) {
    const idx = Number(msg.dataset.msgIdx);
    decorateTutorMessage(msg, tutorHistory[idx]?.text || '');
  }
  if (scrollBottom) { log.scrollTop = log.scrollHeight; }
}

/** Regex for an English word/phrase we're willing to offer as a vocab entry.
 *  Only Latin letters, spaces, hyphens, apostrophes; 1–5 tokens; not just a
 *  bare stopword. */
const TUTOR_WORD_RE = /^[A-Za-z][A-Za-z\-']*(?:\s+[A-Za-z][A-Za-z\-']*){0,4}$/;
const TUTOR_BOLD_STOP = new Set(['the','a','an','and','or','but','so','to','of','in','on','at','for','with','by','if','as','is','are']);

function looksLikeEnglishPhrase(s) {
  const t = String(s || '').trim();
  if (!t) { return false; }
  if (t.length > 60) { return false; }
  if (!TUTOR_WORD_RE.test(t)) { return false; }
  const lower = t.toLowerCase();
  if (TUTOR_BOLD_STOP.has(lower)) { return false; }
  return true;
}

/** Walk every <strong>/<b> in `msgEl` and append an "➕ 加入词本" pill after
 *  each English one. Idempotent: skips <strong>s already decorated. */
function decorateTutorMessage(msgEl, rawText) {
  const strongs = msgEl.querySelectorAll('strong, b');
  for (const st of strongs) {
    if (st.dataset.tutorDecorated === '1') { continue; }
    const text = (st.textContent || '').trim();
    if (!looksLikeEnglishPhrase(text)) { continue; }
    st.dataset.tutorDecorated = '1';
    const pill = document.createElement('button');
    pill.className = 'tutor-add-pill';
    const alreadyAdded = tutorAddedEnLower.has(text.toLowerCase());
    pill.dataset.en = text;
    pill.textContent = alreadyAdded ? '✅ 已在词本' : '➕ 加入词本';
    if (alreadyAdded) { pill.classList.add('done'); pill.disabled = true; }
    pill.title = alreadyAdded ? '已经在词本里了' : '加到 📖 词本，同时收进 🤖 AI 查询过';
    pill.addEventListener('click', () => addTutorWordToVocab(pill, rawText));
    st.insertAdjacentElement('afterend', pill);
  }
}

/** Send the add request to host, update UI + in-memory vocab on success. */
async function addTutorWordToVocab(pill, contextText) {
  const en = pill.dataset.en;
  if (!en) { return; }
  const original = pill.textContent;
  pill.disabled = true;
  pill.textContent = '⏳ 加入中…';
  try {
    const m = await callHost('addUserVocab', {
      en, contextText, tutorSessionId, source: 'tutor',
    });
    const entry = m && m.entry;
    if (!entry) {
      pill.textContent = '⚠️ 失败';
      setTimeout(() => { pill.textContent = original; pill.disabled = false; }, 1600);
      return;
    }
    mergeUserVocabEntry(entry);
    tutorAddedEnLower.add(en.toLowerCase());
    pill.textContent = `✅ 已加入（${entry.zh || '?'}）`;
    pill.classList.add('done');
    showToast(`✅ 已加入词本：${entry.en}${entry.zh ? ' — ' + entry.zh : ''}`);
  } catch (e) {
    pill.textContent = '⚠️ 失败';
    setTimeout(() => { pill.textContent = original; pill.disabled = false; }, 1600);
  }
}

/** Bottom-right toast used by the tutor + anywhere else that needs it. */
function showToast(text, ms = 2600) {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('toast-hide'); }, ms - 400);
  setTimeout(() => { el.remove(); }, ms);
}

// ============ Tab: 🤖 AI 查询过 ============
/** A小本子 of every word the user opened 深度学习 on. Rows include audio
 *  buttons, query count, and a link back to every stored conversation. */
async function renderQueriedWords() {
  const content = document.getElementById('content');
  content.innerHTML = `<h2>🤖 AI 查询过</h2><p class="muted">加载中…</p>`;
  const resp = await callHost('getQueriedWords');
  const items = (resp && resp.items) || [];
  const rows = items.map((it) => {
    const w = vocabById.get(it.wordId);
    const en = (w && w.en) || it.en || it.wordId;
    const zh = (w && w.zh) || it.zh || '';
    const isFav = favoriteWordIds.has(it.wordId);
    const sessions = (it.sessionIds || []).map((sid, idx) => `
      <button class="queried-session-btn" data-word-id="${it.wordId}" data-session-id="${sid}">
        💬 对话 ${it.sessionIds.length - idx}
      </button>`).join('');
    const lastFmt = fmtRelativeTime(it.lastQueriedAt);
    return `
      <div class="card queried-card" data-word-id="${it.wordId}">
        <div class="en">${escapeHtml(en)} ${audioBtns(en)}
          <button class="word-fav-btn" data-word-fav="${it.wordId}" title="${isFav ? '取消收藏' : '收藏'}">${isFav ? '★' : '☆'}</button>
          <span class="queried-count-badge" title="AI 查询次数">🤖 ×${it.count}</span>
        </div>
        ${phoneticBadges(en)}
        <div class="zh">${escapeHtml(zh) || '<em class="muted">暂无中文释义</em>'}</div>
        <div class="queried-meta">
          <span class="muted">最近：${escapeHtml(lastFmt)}</span>
          <div class="queried-sessions">${sessions}</div>
        </div>
      </div>`;
  }).join('');

  content.innerHTML = `
    <h2>🤖 AI 查询过 <span class="muted" style="font-weight:normal">(${items.length})</span></h2>
    <p class="muted">你在 🔍 深度学习 里问过 AI 助教的词都会收进这里。点击 💬 对话 可以回到当时那段聊天继续问。</p>
    <div id="queriedList">${items.length ? rows : '<p class="muted">还没有查询记录。到 📖 词本 里选一个词点 🔍 深度学习 就会自动收录。</p>'}</div>
  `;
  const list = document.getElementById('queriedList');
  if (!list) { return; }
  wireAudioButtons(list);
  wireFavoriteButtons(list);
  for (const b of list.querySelectorAll('.queried-session-btn')) {
    b.addEventListener('click', () => {
      const wordId = b.dataset.wordId;
      const sessionId = b.dataset.sessionId;
      const w = vocabById.get(wordId) || { id: wordId, en: b.closest('.queried-card')?.querySelector('.en')?.textContent?.trim() || wordId, zh: '' };
      // Reuse the browse tab's deep-study area if we are there; otherwise
      // ensure a deepArea container exists at the top of this tab.
      let deep = document.getElementById('deepArea');
      if (!deep) {
        deep = document.createElement('div');
        deep.id = 'deepArea';
        content.insertBefore(deep, list);
      }
      deep.scrollIntoView({ behavior: 'smooth', block: 'start' });
      openDeepStudy(w, { sessionId });
    });
  }
}

/** Small helper: relative time like "3分钟前 / 2小时前 / 昨天 / 2026-08-01". */
function fmtRelativeTime(iso) {
  if (!iso) { return ''; }
  const t = new Date(iso).getTime();
  if (isNaN(t)) { return iso; }
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) { return '刚刚'; }
  if (min < 60) { return `${min} 分钟前`; }
  const hr = Math.floor(min / 60);
  if (hr < 24) { return `${hr} 小时前`; }
  const day = Math.floor(hr / 24);
  if (day < 7) { return `${day} 天前`; }
  return iso.slice(0, 10);
}

// ============ Tab: Reading Corner ============
let readingState = {
  view: 'list',       // 'list' | 'article'
  sub: 'today',       // 'today' | 'favorites'
  articles: [],       // current list
  current: null,      // current article obj
  favoriteIds: new Set(),
};

async function renderReading() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <h2>📚 读书角</h2>
    <p class="muted">每天基于你要复习的词，为你生成 3-5 篇 4-6 分钟的短文。第一眼只有英文；点击句子随时和 Copilot 聊。</p>
    <div class="letter-tabs" style="border-bottom:none; margin-bottom:12px">
      <button data-sub="today" class="${readingState.sub === 'today' ? 'active' : ''}">📰 今日推送</button>
      <button data-sub="favorites" class="${readingState.sub === 'favorites' ? 'active' : ''}">⭐ 收藏夹</button>
    </div>
    <div id="readingBody"><p class="muted">加载中…</p></div>
  `;
  for (const b of content.querySelectorAll('[data-sub]')) {
    b.addEventListener('click', () => {
      readingState.sub = b.dataset.sub;
      readingState.view = 'list';
      readingState.current = null;
      renderReading();
    });
  }
  // Refresh favorite ids
  const favResp = await callHost('getFavoriteArticles');
  readingState.favoriteIds = new Set((favResp.items || []).map((a) => a.id));

  if (readingState.sub === 'today') { await renderReadingToday(); }
  else { await renderReadingFavorites(favResp.items || []); }
}

async function renderReadingToday() {
  const box = document.getElementById('readingBody');
  const resp = await callHost('getTodayArticles');
  const items = resp.items || [];
  const status = resp.status || { state: 'idle' };
  if (items.length > 0) { renderArticleList(items); return; }
  if (status.state === 'running') {
    box.innerHTML = `
      <div class="card">
        <p>🌀 后台正在为你生成今日短文…</p>
        <p class="muted">启动时已自动触发，大约 30-60 秒。你可以先往其他 tab 学习，或等在这里。</p>
        <p><button class="secondary" id="pollAgain">🔄 刷新</button></p>
      </div>
    `;
    document.getElementById('pollAgain').addEventListener('click', () => renderReadingToday());
    // Auto-poll every 4s
    if (!readingState.pollTimer) {
      readingState.pollTimer = setInterval(async () => {
        if (readingState.sub !== 'today' || readingState.view !== 'list') {
          clearInterval(readingState.pollTimer); readingState.pollTimer = null; return;
        }
        const r = await callHost('getTodayArticles');
        if ((r.items && r.items.length > 0) || (r.status && r.status.state !== 'running')) {
          clearInterval(readingState.pollTimer); readingState.pollTimer = null;
          renderReadingToday();
        }
      }, 4000);
    }
    return;
  }
  if (status.state === 'failed') {
    box.innerHTML = `
      <div class="card">
        <p class="result-bad">❗后台自动生成失败：${escapeHtml(status.error || '未知错误')}</p>
        <p><button id="genArticles">✨ 手动重新生成 4 篇</button></p>
      </div>
    `;
    document.getElementById('genArticles').addEventListener('click', () => generateReading());
    return;
  }
  // idle / done-but-empty (e.g. extension just re-installed)
  box.innerHTML = `
    <div class="card">
      <p>今天还没有生成短文。根据你待复习的词生成一批？</p>
      <p><button id="genArticles">✨ 生成 4 篇短文</button>
         <span class="muted" style="margin-left:8px">用 Copilot LLM，30-60 秒</span></p>
    </div>
  `;
  document.getElementById('genArticles').addEventListener('click', () => generateReading());
}

async function renderReadingFavorites(items) {
  const box = document.getElementById('readingBody');
  if (!items || items.length === 0) {
    box.innerHTML = `<div class="card"><p class="muted">还没有收藏。文章顶部的 ☆ 按钮可以收藏。</p></div>`;
    return;
  }
  renderArticleList(items);
}

function renderArticleList(items) {
  readingState.articles = items;
  const box = document.getElementById('readingBody');
  const cards = items.map((a) => {
    const isFav = readingState.favoriteIds.has(a.id);
    return `
      <div class="reading-card" data-id="${a.id}">
        <div class="reading-card-head">
          <button class="fav-btn" data-fav="${a.id}" title="${isFav ? '取消收藏' : '收藏'}">${isFav ? '★' : '☆'}</button>
          <span class="theme-tag theme-${escapeHtml(a.theme)}">${escapeHtml(a.theme)}</span>
          <span class="muted"> · ${a.minutes} min · ${a.sentences.length} 句</span>
        </div>
        <h3 class="reading-title">${escapeHtml(a.title)}</h3>
        <p class="muted reading-preview">${escapeHtml((a.sentences[0]?.en) || '')}…</p>
        <p><button class="read-btn" data-read="${a.id}">▶ 阅读</button></p>
      </div>
    `;
  }).join('');
  box.innerHTML = `
    <div class="reading-list">${cards}</div>
    ${readingState.sub === 'today' ? '<p style="margin-top:12px"><button class="secondary" id="regenArticles">🔄 换一批</button></p>' : ''}
  `;
  for (const b of box.querySelectorAll('[data-read]')) {
    b.addEventListener('click', () => {
      const a = items.find((x) => x.id === b.dataset.read);
      if (a) { openArticle(a); }
    });
  }
  for (const b of box.querySelectorAll('[data-fav]')) {
    b.addEventListener('click', async () => {
      const a = items.find((x) => x.id === b.dataset.fav);
      if (!a) { return; }
      const resp = await callHost('toggleFavoriteArticle', { article: a });
      if (resp.favorited) { readingState.favoriteIds.add(a.id); b.textContent = '★'; }
      else { readingState.favoriteIds.delete(a.id); b.textContent = '☆'; }
    });
  }
  const regen = document.getElementById('regenArticles');
  if (regen) { regen.addEventListener('click', () => generateReading()); }
}

async function generateReading() {
  const box = document.getElementById('readingBody');
  box.innerHTML = `<div class="card"><p>🌀 正在为你生成…（约 30-60 秒）</p></div>`;
  // Gather review words (from due queue) as primary vocab targets
  const due = await callHost('getEbbinghausDue', { limit: 30 });
  const dueIds = (due.due || []).map((d) => d.wordId);
  const reviewWords = dueIds.map((id) => vocabById.get(id)).filter(Boolean)
    .filter((w) => w.zh && /^[a-zA-Z\s\-']+$/.test(w.en))
    .slice(0, 15)
    .map((w) => ({ en: w.en, zh: w.zh }));
  // Extra: some recently learned words to keep articles readable
  const learnedIds = await fetchLearnedIds();
  const extraWords = [...learnedIds].slice(0, 10)
    .map((id) => vocabById.get(id))
    .filter((w) => w && w.zh && /^[a-zA-Z\s\-']+$/.test(w.en))
    .map((w) => ({ en: w.en, zh: w.zh }));
  const resp = await callHost('generateTodayArticles', { reviewWords, extraWords, count: 4 });
  const items = resp.items || [];
  if (items.length === 0) {
    const errMsg = resp.error || 'Copilot 不可用或返回了非预期格式';
    box.innerHTML = `<div class="card">
      <p class="result-bad">❗ 生成失败</p>
      <p class="muted" style="font-size:12px; white-space:pre-wrap; margin-top:8px">${escapeHtml(errMsg)}</p>
      <p style="margin-top:12px">
        <button id="retryGen">🔄 重试</button>
        <span class="muted" style="margin-left:8px">如反复失败，可打开 View → Output → English CATTI 查看详细日志</span>
      </p>
    </div>`;
    document.getElementById('retryGen').addEventListener('click', () => generateReading());
    return;
  }
  renderArticleList(items);
}

function openArticle(a) {
  readingState.view = 'article';
  readingState.current = a;
  const box = document.getElementById('readingBody');
  const isFav = readingState.favoriteIds.has(a.id);
  // Each sentence: EN, clickable, with tiny 🔊 and 💬 buttons. ZH hidden by default.
  const sentHtml = a.sentences.map((s, i) => `
    <div class="reading-sentence" data-i="${i}">
      <span class="sent-en" data-en="${encodeURIComponent(s.en)}" data-zh="${encodeURIComponent(s.zh)}" title="点击→与 Copilot 讨论 · Alt+点击→显示翻译">${escapeHtml(s.en)}</span>
      <span class="sent-actions">
        <button class="mini-btn sent-audio" data-text="${encodeURIComponent(s.en)}" data-accent="us" title="美音">🇺🇸</button>
        <button class="mini-btn sent-audio" data-text="${encodeURIComponent(s.en)}" data-accent="uk" title="英音">🇬🇧</button>
        <button class="mini-btn toggle-zh" data-i="${i}" title="显示/隐藏翻译">🇨🇳</button>
        <button class="mini-btn ask-copilot" data-en="${encodeURIComponent(s.en)}" title="Copilot 讲解">💬</button>
      </span>
      <div class="sent-zh hidden" id="szh-${i}">${escapeHtml(s.zh)}</div>
    </div>
  `).join('');
  box.innerHTML = `
    <div class="reading-article">
      <p><button class="secondary" id="backList">← 返回列表</button></p>
      <div class="reading-card-head">
        <button class="fav-btn" id="artFav" title="${isFav ? '取消收藏' : '收藏'}">${isFav ? '★' : '☆'}</button>
        <span class="theme-tag theme-${escapeHtml(a.theme)}">${escapeHtml(a.theme)}</span>
        <span class="muted"> · ${a.minutes} min · ${a.sentences.length} 句</span>
      </div>
      <h2 class="article-title">${escapeHtml(a.title)}</h2>
      <div class="article-toolbar">
        <button id="playAll">▶ 逐句播放（US）</button>
        <button class="secondary" id="playAllUk">▶ 逐句播放（UK）</button>
        <button class="secondary" id="toggleAllZh">🇨🇳 全部翻译</button>
        <button class="secondary" id="askWhole">💬 让 Copilot 讲解全文</button>
      </div>
      <div class="article-body">${sentHtml}</div>
    </div>
  `;
  document.getElementById('backList').addEventListener('click', () => {
    readingState.view = 'list';
    readingState.current = null;
    renderReading();
  });
  document.getElementById('artFav').addEventListener('click', async () => {
    const resp = await callHost('toggleFavoriteArticle', { article: a });
    if (resp.favorited) { readingState.favoriteIds.add(a.id); document.getElementById('artFav').textContent = '★'; }
    else { readingState.favoriteIds.delete(a.id); document.getElementById('artFav').textContent = '☆'; }
  });
  // Per-sentence buttons
  for (const b of box.querySelectorAll('.sent-audio')) {
    b.addEventListener('click', (e) => { e.stopPropagation(); playSentenceAudio(b); });
  }
  for (const b of box.querySelectorAll('.toggle-zh')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = document.getElementById(`szh-${b.dataset.i}`);
      if (el) { el.classList.toggle('hidden'); }
    });
  }
  for (const b of box.querySelectorAll('.ask-copilot')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      askCopilotAboutSentence(decodeURIComponent(b.dataset.en));
    });
  }
  // Sentence click: default → open Copilot; Alt+click → reveal translation
  for (const s of box.querySelectorAll('.sent-en')) {
    s.addEventListener('click', (e) => {
      if (e.altKey) {
        const i = s.parentElement.dataset.i;
        document.getElementById(`szh-${i}`).classList.toggle('hidden');
      } else {
        askCopilotAboutSentence(decodeURIComponent(s.dataset.en));
      }
    });
  }
  // Toolbar
  document.getElementById('playAll').addEventListener('click', () => playArticleSequentially(a.sentences, 'us'));
  document.getElementById('playAllUk').addEventListener('click', () => playArticleSequentially(a.sentences, 'uk'));
  document.getElementById('toggleAllZh').addEventListener('click', () => {
    const els = box.querySelectorAll('.sent-zh');
    const shouldShow = [...els].some((e) => e.classList.contains('hidden'));
    for (const el of els) { el.classList.toggle('hidden', !shouldShow); }
  });
  document.getElementById('askWhole').addEventListener('click', () => {
    const excerpt = a.sentences.map((s) => s.en).join(' ');
    const query = `请帮我讲解这篇英语短文的精妙之处、语言点、值得学习的表达，用中文：\n\n**${a.title}**\n\n${excerpt}`;
    vscode.postMessage({ type: 'openInCopilotChat', query });
  });
}

function askCopilotAboutSentence(en) {
  const query = `请用中文帮我：\n1. 翻译这句英文\n2. 讲一下里面值得学习的表达/搭配/语法点\n3. 如果有文化背景或修辞技巧，也说一下\n\n原句："${en}"`;
  vscode.postMessage({ type: 'openInCopilotChat', query });
}

async function playArticleSequentially(sentences, accent) {
  for (const s of sentences) {
    await playOne(s.en, accent);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function playOne(text, accent) {
  return new Promise((resolve) => {
    const hash = sentenceHash(text);
    let relPath = findSentenceAudio(hash, accent);
    if (!relPath) { relPath = `audio/sentences/dynamic/${accent}/${hash}.mp3`; }
    const audio = new Audio(`${dataBase}/${relPath}`);
    audio.onended = () => resolve();
    audio.onerror = async () => {
      // Try on-demand generation
      const m = await callHost('generateSentenceAudio', { text, accent });
      if (m && m.path) {
        const a2 = new Audio(`${dataBase}/${m.path}`);
        a2.onended = () => resolve();
        a2.onerror = () => resolve();
        a2.play().catch(() => resolve());
      } else {
        resolve();
      }
    };
    audio.play().catch(() => { /* onerror will trigger */ });
  });
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
