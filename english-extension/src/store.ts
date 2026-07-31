import * as fs from 'fs';
import * as path from 'path';

/** Classic Ebbinghaus intervals (days after `learned_at`). */
export const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30];
/** Gate to run at each Ebbinghaus review step (index-aligned with intervals). */
export const EBBINGHAUS_GATES = [1, 2, 3, 4, 5, 5];

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

export interface UserState {
  version: number;
  created_at: string;
  updated_at: string;
  words: Record<string, WordState>;
  daily: Record<string, DailyStats>;
  sessions: Session[];
  currentLearnSession?: LearnSessionState | null;
  favoriteWords?: string[];   // wordIds the user has starred
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
    const wasNew = w.gate === 0 && !w.learned_at;
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
    if (known && wasNew) { day.new_words += 1; }
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

  /** Ebbinghaus queue: due today or earlier, most overdue first. */
  getEbbinghausDue(limit = 200) {
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
    return items.slice(0, limit).map(({ wordId, gate, scheduled }) => ({ wordId, gate, scheduled }));
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
    const dueToday = this.getEbbinghausDue(9999).length;
    return {
      today, today_stats: t,
      streak_days: streak,
      total_learned: learned,
      total_mastered: mastered,
      due_today: dueToday,
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
