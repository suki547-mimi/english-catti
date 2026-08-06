import * as fs from 'fs';
import * as path from 'path';

/** Classic Ebbinghaus intervals (days after `learned_at`). */
export const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30];
/** Gate to run at each Ebbinghaus review step (index-aligned with intervals). */
export const EBBINGHAUS_GATES = [1, 2, 3, 4, 5, 5];
/** Max reviews推送 per day. 保障学习质量：休假回来 backlog 不会一次砸下来，
 *  超出的仍留在队列里，明天优先级更高。 */
export const DAILY_REVIEW_CAP = 20;

export interface WordState {
  id: string;
  en: string;
  zh: string;

  gate: 0 | 1 | 2 | 3 | 4 | 5;
  learned_at: string | null;
  reviews_done: number;
  next_review_at: string | null;
  next_review_gate: number;
  mastered: boolean;

  score: number;

  seen_count: number;
  last_reviewed_at: string | null;
  last_result: 'known' | 'unknown' | 'correct' | 'incorrect' | null;
  history: Array<{
    at: string;
    mode: 'learn' | 'ebbinghaus' | 'score';
    gate: number;
    result: string;
    score_before?: number;
    score_after?: number;
  }>;
}

export interface DailyStats {
  new_words: number;
  reviewed: number;
  correct: number;
  incorrect: number;
  ebbinghaus_reviewed: number;
  score_reviewed: number;
}

export interface Session {
  at: string;
  mode: 'learn' | 'ebbinghaus' | 'score';
  gate?: number;
  word_ids: string[];
  correct?: number;
  incorrect?: number;
}

export interface LearnSessionState {
  wordIds: string[];
  idx: number;
  known: number;
  unknown: number;
  startedAt: string;
}

/** One persisted AI conversation the user had with the tutor (mostly opened
 *  from a word card's 深度学习 button). Referenced from `queriedWords[wordId].sessionIds`. */
export interface AiSession {
  id: string;
  mode: 'deepStudy' | 'tutor';
  wordId?: string;
  en?: string;
  zh?: string;
  startedAt: string;
  updatedAt: string;
  messages: Array<{ role: 'user' | 'assistant'; text: string; at: string }>;
}

/** Aggregate stats for a word the user has asked the AI 助教 about. */
export interface QueriedWordStat {
  wordId: string;
  count: number;                 // total user questions across all sessions
  firstQueriedAt: string;
  lastQueriedAt: string;
  sessionIds: string[];          // most-recent first
  en?: string;
  zh?: string;
}

/** A word the user added to their vocab from outside the seed corpus
 *  (e.g. picked up in an AI 助教 conversation). Merged into the browse list
 *  at boot in the webview. */
export interface CustomWord {
  id: string;                   // e.g. 'user-chicken-out'
  en: string;
  zh: string;
  note?: string;                // short usage / register hint
  source: 'tutor' | 'manual';
  tutorSessionId?: string;      // link back to the conversation that surfaced it
  addedAt: string;
}

export interface UserState {
  version: number;
  created_at: string;
  updated_at: string;
  words: Record<string, WordState>;
  daily: Record<string, DailyStats>;
  sessions: Session[];
  currentLearnSession?: LearnSessionState | null;
  favoriteWords?: string[];   // wordIds the user has starred
  queriedWords?: Record<string, QueriedWordStat>;    // wordId -> stats
  aiSessions?: Record<string, AiSession>;             // sessionId -> full transcript
  customWords?: Record<string, CustomWord>;           // wordId -> user-added word
}

const EMPTY_STATE = (): UserState => ({
  version: 2,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  words: {},
  daily: {},
  sessions: [],
  currentLearnSession: null,
  favoriteWords: [],
  queriedWords: {},
  aiSessions: {},
  customWords: {},
});

function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(base: string | Date, days: number): string {
  const d = typeof base === 'string' ? new Date(base + 'T00:00:00') : new Date(base);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export class UserStore {
  private path: string;
  private dataRoot: string;
  private state: UserState;

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
    this.path = path.join(dataRoot, 'user_state.json');
    this.backupIfNeeded();
    this.state = this.load();
  }

  /** Snapshot user_state.json to a dated file if today's backup doesn't exist.
   *  Keeps the most recent 30 dated backups. */
  private backupIfNeeded() {
    try {
      if (!fs.existsSync(this.path)) { return; }
      const today = isoDate();
      const backupName = `user_state.backup-${today}.json`;
      const backupPath = path.join(this.dataRoot, backupName);
      if (fs.existsSync(backupPath)) { return; }   // already backed up today
      fs.copyFileSync(this.path, backupPath);
      // Prune old backups beyond 30
      const files = fs.readdirSync(this.dataRoot)
        .filter((f) => f.startsWith('user_state.backup-') && f.endsWith('.json'))
        .sort();
      const toDelete = files.slice(0, Math.max(0, files.length - 30));
      for (const f of toDelete) {
        try { fs.unlinkSync(path.join(this.dataRoot, f)); } catch { /* ignore */ }
      }
    } catch (e) {
      console.error('backup failed', e);
    }
  }

  private load(): UserState {
    try {
      if (fs.existsSync(this.path)) {
        const raw = fs.readFileSync(this.path, 'utf8');
        const parsed = JSON.parse(raw) as UserState;
        if (parsed && parsed.version === 2) { return parsed; }
        if (parsed && parsed.version === 1) {
          // v1 → v2 migration: keep daily + sessions, discard word states (v1 had a
          // different word schema). Word states will just be rebuilt as user reviews.
          return { ...EMPTY_STATE(), sessions: parsed.sessions || [], daily: parsed.daily || {} };
        }
      }
    } catch (e) {
      console.error('user_state load failed', e);
      // Try to recover from the most recent backup
      try {
        const files = fs.readdirSync(this.dataRoot)
          .filter((f) => f.startsWith('user_state.backup-') && f.endsWith('.json'))
          .sort();
        if (files.length > 0) {
          const latest = path.join(this.dataRoot, files[files.length - 1]);
          const raw = fs.readFileSync(latest, 'utf8');
          const parsed = JSON.parse(raw) as UserState;
          if (parsed && parsed.version === 2) {
            console.warn(`Recovered from backup: ${files[files.length - 1]}`);
            return parsed;
          }
        }
      } catch { /* ignore recovery failure */ }
    }
    return EMPTY_STATE();
  }

  private save() {
    this.state.updated_at = new Date().toISOString();
    fs.writeFileSync(this.path, JSON.stringify(this.state, null, 2), 'utf8');
  }

  getState(): UserState { return this.state; }

  private ensureDaily(date: string): DailyStats {
    if (!this.state.daily[date]) {
      this.state.daily[date] = {
        new_words: 0, reviewed: 0, correct: 0, incorrect: 0,
        ebbinghaus_reviewed: 0, score_reviewed: 0,
      };
    }
    return this.state.daily[date];
  }

  private ensureWord(id: string, en: string, zh: string): WordState {
    if (!this.state.words[id]) {
      this.state.words[id] = {
        id, en, zh,
        gate: 0, learned_at: null,
        reviews_done: 0, next_review_at: null, next_review_gate: 1,
        mastered: false, score: 0,
        seen_count: 0, last_reviewed_at: null, last_result: null,
        history: [],
      };
    }
    this.state.words[id].en = en;
    this.state.words[id].zh = zh;
    return this.state.words[id];
  }

  /** LEARN result. On pass: schedule +1 day Ebbinghaus. */
  recordLearn(wordId: string, en: string, zh: string, known: boolean) {
    const w = this.ensureWord(wordId, en, zh);
    const now = new Date().toISOString();
    const today = isoDate();
    // "wasNew" = first time this word is ever recorded. Guards against
    // double-counting when a word previously marked "不熟" (gate stays 0,
    // learned_at stays null) gets drawn again on a later day.
    const wasNew = w.seen_count === 0;
    w.seen_count += 1;
    w.last_reviewed_at = now;
    w.last_result = known ? 'known' : 'unknown';
    w.history.push({ at: now, mode: 'learn', gate: 1, result: known ? 'known' : 'unknown' });
    if (known) {
      if (w.gate < 1) { w.gate = 1; }
      if (!w.learned_at) { w.learned_at = today; }
      w.reviews_done = 0;
      w.next_review_at = addDays(w.learned_at, EBBINGHAUS_INTERVALS[0]);
      w.next_review_gate = EBBINGHAUS_GATES[0];
      w.score = Math.min(100, w.score + 20);
    } else {
      w.score = Math.max(0, w.score - 5);
    }
    const day = this.ensureDaily(today);
    // Count every first-time-studied card toward today's tally, whether the
    // user marked "认识" or "不熟" — both represent real study effort.
    if (wasNew) { day.new_words += 1; }
    this.save();
  }

  finishLearnSession(wordIds: string[], known: number, unknown: number) {
    this.state.sessions.push({
      at: new Date().toISOString(),
      mode: 'learn', gate: 1, word_ids: wordIds,
      correct: known, incorrect: unknown,
    });
    this.save();
  }

  recordEbbinghausReview(wordId: string, en: string, zh: string, gate: number, pass: boolean) {
    const w = this.ensureWord(wordId, en, zh);
    const now = new Date().toISOString();
    const today = isoDate();
    w.seen_count += 1;
    w.last_reviewed_at = now;
    w.last_result = pass ? 'correct' : 'incorrect';
    const scoreBefore = w.score;
    w.history.push({ at: now, mode: 'ebbinghaus', gate, result: pass ? 'correct' : 'incorrect', score_before: scoreBefore });
    if (pass) {
      w.reviews_done = Math.min(EBBINGHAUS_INTERVALS.length, w.reviews_done + 1);
      w.gate = Math.min(5, Math.max(w.gate, gate)) as WordState['gate'];
      w.score = Math.min(100, w.score + 15);
      if (w.reviews_done >= EBBINGHAUS_INTERVALS.length) {
        w.mastered = true;
        w.next_review_at = null;
        w.next_review_gate = 5;
      } else {
        // Next review uses the ORIGINAL gap between adjacent Ebbinghaus intervals,
        // anchored to TODAY (i.e. the actual pass day). This preserves the spacing
        // effect even after delays from failed retests, and prevents the "cascade"
        // where all delayed reviews collapse to a single day.
        const prevInterval = w.reviews_done > 0 ? EBBINGHAUS_INTERVALS[w.reviews_done - 1] : 0;
        const nextInterval = EBBINGHAUS_INTERVALS[w.reviews_done];
        const gap = Math.max(1, nextInterval - prevInterval);
        w.next_review_at = addDays(today, gap);
        w.next_review_gate = EBBINGHAUS_GATES[w.reviews_done];
      }
    } else {
      w.next_review_at = addDays(today, 1);
      w.next_review_gate = gate;
      w.score = Math.max(0, w.score - 15);
    }
    w.history[w.history.length - 1].score_after = w.score;

    const day = this.ensureDaily(today);
    day.reviewed += 1;
    day.ebbinghaus_reviewed += 1;
    if (pass) { day.correct += 1; } else { day.incorrect += 1; }
    this.save();
  }

  finishEbbinghausSession(wordIds: string[], correct: number, incorrect: number) {
    this.state.sessions.push({
      at: new Date().toISOString(),
      mode: 'ebbinghaus', word_ids: wordIds, correct, incorrect,
    });
    this.save();
  }

  recordScoreReview(wordId: string, en: string, zh: string, gate: number, pass: boolean) {
    const w = this.ensureWord(wordId, en, zh);
    const now = new Date().toISOString();
    const today = isoDate();
    w.seen_count += 1;
    w.last_reviewed_at = now;
    w.last_result = pass ? 'correct' : 'incorrect';
    const scoreBefore = w.score;
    w.history.push({ at: now, mode: 'score', gate, result: pass ? 'correct' : 'incorrect', score_before: scoreBefore });
    if (pass) { w.score = Math.min(100, w.score + 5); }
    else { w.score = Math.max(0, w.score - 10); }
    w.history[w.history.length - 1].score_after = w.score;

    const day = this.ensureDaily(today);
    day.reviewed += 1;
    day.score_reviewed += 1;
    if (pass) { day.correct += 1; } else { day.incorrect += 1; }
    this.save();
  }

  finishScoreSession(wordIds: string[], correct: number, incorrect: number) {
    this.state.sessions.push({
      at: new Date().toISOString(),
      mode: 'score', word_ids: wordIds, correct, incorrect,
    });
    this.save();
  }

  /** All words IDs the user has learned (gate >= 1). Used by webview to skip in "new" pool. */
  learnedIds(): string[] {
    return Object.values(this.state.words).filter((w) => w.gate >= 1).map((w) => w.id);
  }

  /** Persist the in-progress learn session so a window reload can resume it. */
  saveLearnSession(s: LearnSessionState | null): void {
    this.state.currentLearnSession = s;
    this.save();
  }

  getLearnSession(): LearnSessionState | null {
    return this.state.currentLearnSession || null;
  }

  /** Toggle favorite status for a word. Returns new state (true = favorited). */
  toggleFavoriteWord(wordId: string): boolean {
    if (!this.state.favoriteWords) { this.state.favoriteWords = []; }
    const idx = this.state.favoriteWords.indexOf(wordId);
    if (idx >= 0) { this.state.favoriteWords.splice(idx, 1); this.save(); return false; }
    this.state.favoriteWords.unshift(wordId);
    this.save();
    return true;
  }

  getFavoriteWords(): string[] {
    return this.state.favoriteWords || [];
  }

  // ---------- AI 小本子 (queried-words + session transcripts) ----------

  private ensureAiMaps(): void {
    if (!this.state.queriedWords) { this.state.queriedWords = {}; }
    if (!this.state.aiSessions) { this.state.aiSessions = {}; }
  }

  /** Create a new AI session record. If `wordId` is given, the session is
   *  linked to that word (deep-study mode); this also bumps the initial
   *  “查询” counter by 1 so opening the modal counts as one query.
   *  Returns the session id (caller passes `id` from webview so both sides stay in sync). */
  startAiSession(opts: { id: string; mode: 'deepStudy' | 'tutor'; wordId?: string; en?: string; zh?: string }): string {
    this.ensureAiMaps();
    const now = new Date().toISOString();
    const session: AiSession = {
      id: opts.id,
      mode: opts.mode,
      wordId: opts.wordId,
      en: opts.en,
      zh: opts.zh,
      startedAt: now,
      updatedAt: now,
      messages: [],
    };
    this.state.aiSessions![opts.id] = session;
    if (opts.wordId) {
      const qw = this.state.queriedWords!;
      const prev = qw[opts.wordId];
      if (prev) {
        prev.count += 1;
        prev.lastQueriedAt = now;
        // most-recent-first, deduped
        prev.sessionIds = [opts.id, ...prev.sessionIds.filter((s) => s !== opts.id)];
        if (opts.en) { prev.en = opts.en; }
        if (opts.zh) { prev.zh = opts.zh; }
      } else {
        qw[opts.wordId] = {
          wordId: opts.wordId,
          count: 1,
          firstQueriedAt: now,
          lastQueriedAt: now,
          sessionIds: [opts.id],
          en: opts.en,
          zh: opts.zh,
        };
      }
    }
    this.save();
    return opts.id;
  }

  /** Append one message to an existing session. If role='user' and the session
   *  is linked to a word, also bump that word's query count. */
  appendAiMessage(sessionId: string, role: 'user' | 'assistant', text: string): void {
    this.ensureAiMaps();
    const s = this.state.aiSessions![sessionId];
    if (!s) { return; }
    const now = new Date().toISOString();
    s.messages.push({ role, text: String(text || ''), at: now });
    s.updatedAt = now;
    if (role === 'user' && s.wordId) {
      const qw = this.state.queriedWords!;
      const stat = qw[s.wordId];
      if (stat) {
        stat.count += 1;
        stat.lastQueriedAt = now;
      }
    }
    this.save();
  }

  getAiSession(sessionId: string): AiSession | null {
    this.ensureAiMaps();
    return this.state.aiSessions![sessionId] || null;
  }

  /** All AI-queried words, most recent first. */
  getQueriedWords(): QueriedWordStat[] {
    this.ensureAiMaps();
    const list = Object.values(this.state.queriedWords!);
    list.sort((a, b) => (a.lastQueriedAt < b.lastQueriedAt ? 1 : -1));
    return list;
  }

  // ---------- User-added vocab (from AI tutor / manual) ----------

  private ensureCustomMap(): void {
    if (!this.state.customWords) { this.state.customWords = {}; }
  }

  /** Deterministic id from the english string so "chicken out" is always the same
   *  entry regardless of when it was added. Keeps join with WordState stable. */
  private customIdFor(en: string): string {
    const slug = String(en || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'x';
    return `user-${slug}`;
  }

  /** Add (or update) a user-supplied vocab entry. Dedupes on lowercased english.
   *  If `tutorSessionId` is provided, the word is also linked into
   *  `queriedWords` and its session list so it appears in 🤖 AI 查询过. */
  addCustomWord(opts: {
    en: string;
    zh: string;
    note?: string;
    source: 'tutor' | 'manual';
    tutorSessionId?: string;
  }): CustomWord {
    this.ensureCustomMap();
    this.ensureAiMaps();
    const en = String(opts.en || '').trim();
    const zh = String(opts.zh || '').trim();
    const id = this.customIdFor(en);
    const now = new Date().toISOString();
    const existing = this.state.customWords![id];
    const entry: CustomWord = existing
      ? { ...existing, en, zh: zh || existing.zh, note: opts.note ?? existing.note, tutorSessionId: opts.tutorSessionId || existing.tutorSessionId }
      : { id, en, zh, note: opts.note, source: opts.source, tutorSessionId: opts.tutorSessionId, addedAt: now };
    this.state.customWords![id] = entry;

    // Also link this word into the tutor session (so the session is now
    // classified as "about" this word) + bump queriedWords so it shows up in
    // the 🤖 AI 查询过 tab with a click-through to the conversation.
    if (opts.tutorSessionId) {
      const session = this.state.aiSessions![opts.tutorSessionId];
      if (session && !session.wordId) {
        session.wordId = id;
        session.en = en;
        session.zh = zh || session.zh;
        session.updatedAt = now;
      }
      const qw = this.state.queriedWords!;
      const prev = qw[id];
      if (prev) {
        prev.lastQueriedAt = now;
        if (!prev.sessionIds.includes(opts.tutorSessionId)) {
          prev.sessionIds = [opts.tutorSessionId, ...prev.sessionIds];
          prev.count += 1;
        }
        if (en) { prev.en = en; }
        if (zh) { prev.zh = zh; }
      } else {
        qw[id] = {
          wordId: id,
          count: 1,
          firstQueriedAt: now,
          lastQueriedAt: now,
          sessionIds: [opts.tutorSessionId],
          en,
          zh,
        };
      }
    }
    this.save();
    return entry;
  }

  /** All user-added words, most-recently-added first. */
  getCustomWords(): CustomWord[] {
    this.ensureCustomMap();
    const list = Object.values(this.state.customWords!);
    list.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
    return list;
  }

  /** True if the given english phrase is already in the user's custom list. */
  hasCustomWord(en: string): boolean {
    this.ensureCustomMap();
    return !!this.state.customWords![this.customIdFor(en)];
  }

  /** Ebbinghaus queue: due today or earlier, most overdue first.
   *  The webview normally requests capped=true so休假回来 backlog 不会一次砸 50 个。
   *  剩下的仍留在队列（`next_review_at` 不变），第二天 overdue+1 更靠前。 */
  getEbbinghausDue(limit = 200, capped = false) {
    const today = isoDate();
    const items: Array<{ wordId: string; gate: number; scheduled: string; overdue: number }> = [];
    for (const w of Object.values(this.state.words)) {
      if (w.mastered || w.gate < 1 || !w.next_review_at) { continue; }
      if (w.next_review_at <= today) {
        const overdue = Math.floor((new Date(today).getTime() - new Date(w.next_review_at).getTime()) / 86400000);
        items.push({ wordId: w.id, gate: w.next_review_gate, scheduled: w.next_review_at, overdue });
      }
    }
    items.sort((a, b) => (b.overdue - a.overdue) || (a.gate - b.gate));
    const cap = capped ? Math.min(limit, DAILY_REVIEW_CAP) : limit;
    return items.slice(0, cap).map(({ wordId, gate, scheduled }) => ({ wordId, gate, scheduled }));
  }

  /** Total overdue count (uncapped). Used to show "累计逾期" alongside today's cap. */
  getEbbinghausBacklog(): number {
    const today = isoDate();
    let n = 0;
    for (const w of Object.values(this.state.words)) {
      if (w.mastered || w.gate < 1 || !w.next_review_at) { continue; }
      if (w.next_review_at <= today) { n += 1; }
    }
    return n;
  }

  /** Weighted pool for score-driven review. */
  getScorePool() {
    const today = isoDate();
    const pool: Array<{ wordId: string; weight: number; gate: number; score: number }> = [];
    for (const w of Object.values(this.state.words)) {
      if (w.gate < 1) { continue; }
      const gapFromMastery = (5 - w.gate) * 5;
      const scoreDeficit = (100 - w.score);
      let recentPenalty = 0;
      if (w.last_reviewed_at && w.last_reviewed_at.slice(0, 10) === today) { recentPenalty = -9999; }
      const weight = Math.max(0, gapFromMastery + scoreDeficit + recentPenalty);
      if (weight > 0) { pool.push({ wordId: w.id, weight, gate: w.gate, score: w.score }); }
    }
    return pool;
  }

  /** Calendar summary: past N days activity + upcoming M days due count. */
  calendarSummary(pastDays = 30, futureDays = 7) {
    const today = new Date();
    const past: Array<{ date: string; new_words: number; reviewed: number; correct: number; incorrect: number }> = [];
    for (let i = pastDays - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const key = isoDate(d);
      const s = this.state.daily[key] || { new_words: 0, reviewed: 0, correct: 0, incorrect: 0, ebbinghaus_reviewed: 0, score_reviewed: 0 };
      past.push({ date: key, new_words: s.new_words, reviewed: s.reviewed, correct: s.correct, incorrect: s.incorrect });
    }
    const upcoming: Array<{ date: string; due: number }> = [];
    const dueCounts: Record<string, number> = {};
    for (const w of Object.values(this.state.words)) {
      if (w.mastered || w.gate < 1 || !w.next_review_at) { continue; }
      dueCounts[w.next_review_at] = (dueCounts[w.next_review_at] || 0) + 1;
    }
    for (let i = 0; i < futureDays; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const key = isoDate(d);
      let due = dueCounts[key] || 0;
      if (i === 0) {
        for (const dateKey of Object.keys(dueCounts)) {
          if (dateKey < key) { due += dueCounts[dateKey]; }
        }
      }
      upcoming.push({ date: key, due });
    }
    return { past, upcoming };
  }

  summary() {
    const today = isoDate();
    const t = this.state.daily[today] || { new_words: 0, reviewed: 0, correct: 0, incorrect: 0, ebbinghaus_reviewed: 0, score_reviewed: 0 };
    // Recompute today's `new_words` from the source of truth (per-word history)
    // so the chip stays accurate even if past sessions used older semantics or
    // an increment was missed. A word counts if its FIRST 'learn' history
    // entry (known OR unknown) landed on today.
    let newWordsToday = 0;
    for (const w of Object.values(this.state.words)) {
      const first = w.history.find((h) => h.mode === 'learn');
      if (first && first.at.slice(0, 10) === today) { newWordsToday += 1; }
    }
    if (newWordsToday > t.new_words) {
      t.new_words = newWordsToday;
      this.state.daily[today] = t;
      this.save();
    }
    let streak = 0;
    const cursor = new Date();
    while (true) {
      const key = isoDate(cursor);
      const s = this.state.daily[key];
      if (s && (s.new_words + s.reviewed > 0)) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
      else { break; }
    }
    const words = Object.values(this.state.words);
    const byLevel = [0, 0, 0, 0, 0, 0];
    for (const w of words) { byLevel[w.gate] = (byLevel[w.gate] || 0) + 1; }
    const mastered = words.filter((w) => w.mastered).length;
    const learned = words.filter((w) => w.gate >= 1).length;
    const backlog = this.getEbbinghausBacklog();
    const dueToday = Math.min(backlog, DAILY_REVIEW_CAP);
    return {
      today, today_stats: t,
      streak_days: streak,
      total_learned: learned,
      total_mastered: mastered,
      due_today: dueToday,
      review_backlog: backlog,
      daily_review_cap: DAILY_REVIEW_CAP,
      by_level: byLevel,
      total_sessions: this.state.sessions.length,
    };
  }

  dayDetail(date: string) {
    const reviewed: WordState[] = [];
    const scheduled: WordState[] = [];
    for (const w of Object.values(this.state.words)) {
      if (w.history.some((h) => h.at.slice(0, 10) === date)) { reviewed.push(w); }
      if (w.next_review_at === date && !w.mastered) { scheduled.push(w); }
    }
    return {
      date,
      reviewed_count: reviewed.length,
      scheduled_count: scheduled.length,
      reviewed: reviewed.slice(0, 200).map((w) => ({ id: w.id, en: w.en, zh: w.zh, gate: w.gate, score: w.score })),
      scheduled: scheduled.slice(0, 200).map((w) => ({ id: w.id, en: w.en, zh: w.zh, gate: w.next_review_gate })),
    };
  }
}
