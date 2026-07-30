import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;
function log(msg: string) {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('English CATTI');
  }
  outputChannel.appendLine(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

export interface GradeResult {
  correct: boolean;
  feedback: string;
}

async function getModel(): Promise<vscode.LanguageModelChat | undefined> {
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  return models[0];
}

async function collectResponse(response: vscode.LanguageModelChatResponse): Promise<string> {
  let text = '';
  for await (const chunk of response.text) {
    text += chunk;
  }
  return text;
}

/** Robust JSON extractor: handles ```json fences, plain text, extra chatter. */
function parseJson(text: string): any | null {
  // 1. Try direct parse
  try { return JSON.parse(text); } catch {}
  // 2. Strip common markdown code fences and retry
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }
  // 3. Find outermost {…} block heuristically (longest brace-balanced substring)
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { starts.push(i); }
  }
  for (const s of starts) {
    // scan to matching brace
    let depth = 0;
    for (let i = s; i < text.length; i++) {
      if (text[i] === '{') { depth++; }
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(s, i + 1);
          try { return JSON.parse(candidate); } catch {}
          break;
        }
      }
    }
  }
  return null;
}

/**
 * Gate 1: EN → ZH. Grade whether user's Chinese answer semantically matches
 * the reference Chinese meaning. Loose match (any of the equivalent Chinese
 * words is acceptable).
 */
export async function gradeSemantic(userAnswer: string, referenceZh: string): Promise<GradeResult> {
  try {
    const model = await getModel();
    if (!model) {
      return { correct: false, feedback: '未找到可用的语言模型，请先登录 GitHub Copilot。' };
    }
    const prompt =
      `你是一位英语学习助手，需要判断学习者对英文单词的中文释义答案是否语义正确。\n` +
      `参考中文释义："${referenceZh}"\n` +
      `学习者的答案："${userAnswer}"\n\n` +
      `判分规则：\n` +
      `- 同义词、意思相近的表达都算对（例：如参考是"道路"，答案"路/道/公路/马路"都算对）\n` +
      `- 只要抓到核心意思即可，不要求字面一致\n` +
      `- 但如果学习者的答案指向完全不同的概念（例：参考"香格里拉"答"机场"），算错\n\n` +
      `只输出一行 JSON，不要 markdown 代码围栏，不要额外文字：\n` +
      `{"correct": true 或 false, "feedback": "中文简短点评，1 句话"}`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    log(`[gradeSemantic] raw response:\n${text}`);
    const parsed = parseJson(text);
    if (!parsed) {
      log(`[gradeSemantic] parse failed, raw text was: ${JSON.stringify(text)}`);
      return { correct: false, feedback: `LLM 返回格式异常。原文：${text.slice(0, 100)}` };
    }
    return { correct: !!parsed.correct, feedback: String(parsed.feedback || '') };
  } catch (e: any) {
    log(`[gradeSemantic] error: ${e.message || e}`);
    return { correct: false, feedback: `LM 错误: ${e.message || e}` };
  }
}

/**
 * Gate 4: user writes a sentence using the target word. Grade grammar,
 * usage naturalness, and whether the word is used correctly in context.
 */
export async function gradeSentence(sentence: string, targetWord: string, chineseMeaning: string): Promise<GradeResult> {
  try {
    const model = await getModel();
    if (!model) {
      return { correct: false, feedback: '未找到可用的语言模型，请先登录 GitHub Copilot。' };
    }
    const prompt =
      `你是英语造句评审。目标词：${targetWord}（中文意思：${chineseMeaning}）。\n` +
      `学习者的造句："${sentence}"。\n` +
      `请判断：\n` +
      `1. 语法是否正确\n` +
      `2. 目标词的用法是否地道\n` +
      `3. 整句是否自然\n` +
      `只返回 JSON：{"correct": true/false, "feedback": "中文点评，2-3 句，含改进建议"}`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    const parsed = parseJson(text);
    if (!parsed) {
      return { correct: false, feedback: 'LLM 返回格式异常，暂无法判分。' };
    }
    return { correct: !!parsed.correct, feedback: String(parsed.feedback || '') };
  } catch (e: any) {
    return { correct: false, feedback: `LM 错误: ${e.message || e}` };
  }
}

/** Generate a short bilingual example sentence containing the target word/phrase. */
export async function generateContext(en: string, zh: string): Promise<{ en: string; zh: string } | null> {
  try {
    const model = await getModel();
    if (!model) { return null; }
    const prompt =
      `请围绕英文词 "${en}"（中文意思：${zh}）写一个 1-2 句自然地道的例句。\n` +
      `场景优先选政治、经济、文化、时政类（CATTI 常见话题）。\n` +
      `严格只输出 JSON（无 markdown 围栏，无额外文字）：\n` +
      `{"en": "英文原文（含目标词）", "zh": "对应中文翻译"}`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    log(`[generateContext] "${en}" raw: ${text.slice(0, 200)}`);
    const parsed = parseJson(text);
    if (!parsed || !parsed.en || !parsed.zh) { return null; }
    return { en: String(parsed.en), zh: String(parsed.zh) };
  } catch (e: any) {
    log(`[generateContext] error: ${e.message || e}`);
    return null;
  }
}

/** Generate an in-depth Markdown study card for a word: EN-EN, register,
 *  synonyms, TV/film quotes, collocations. */
export async function deepStudy(en: string, zh: string): Promise<string> {
  try {
    const model = await getModel();
    if (!model) { return '⚠️ 未找到可用的语言模型（Copilot）。'; }
    const prompt =
      `你是英语学习助手。请围绕单词/词组 "${en}"（中文意思：${zh}）给出一份"深度学习"卡片。` +
      `用中文说明，Markdown 输出（不要代码围栏），严格包含以下 5 个二级标题：\n\n` +
      `## 1. 英英释义\n` +
      `1-2 个学习者字典风格的 EN-EN 定义，标词性。\n\n` +
      `## 2. 常用度 & 语域\n` +
      `常见程度（罕见 / 一般 / 常见 / 高频）+ 语域（正式 / 中性 / 口语 / 俚语）。\n\n` +
      `## 3. 近义词辨析\n` +
      `列出 3 个近义词，用一句话点出与目标词的细微差别（语义强度、正式度、搭配偏好等）。\n\n` +
      `## 4. 影视名场面\n` +
      `2-3 个来自著名英美剧/电影的用例。优先选：House of Cards、Suits、The Crown、Breaking Bad、` +
      `Friends、The Office、Downton Abbey、Sherlock、Game of Thrones、Succession、Better Call Saul。\n` +
      `- 每例标注剧名（英文 + 中文）+ 角色 + 情境\n` +
      `- 引用原台词（若不能百分百确认，写"符合角色说话风格的示范用法"并标注 ⚠️）\n\n` +
      `## 5. 高频搭配\n` +
      `3 个最常见搭配，短语形式 + 一句中文解释。`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    log(`[deepStudy] "${en}" got ${text.length} chars`);
    return text.trim();
  } catch (e: any) {
    log(`[deepStudy] error: ${e.message || e}`);
    return `⚠️ 生成失败: ${e.message || e}`;
  }
}

/** Follow-up chat about a specific word. Prior conversation is passed in. */
export async function chatWithWord(
  en: string, zh: string,
  history: Array<{ role: 'user' | 'assistant'; text: string }>,
  question: string,
): Promise<string> {
  try {
    const model = await getModel();
    if (!model) { return '⚠️ 未找到可用的语言模型。'; }
    const systemNote =
      `你是英语学习助手。当前学习对象是英文词 "${en}"（中文意思：${zh}）。` +
      `围绕这个词的用法、含义、语域、搭配、文化背景等回答学习者的问题。` +
      `简洁、准确，用中文回答，可以夹带英文原文。避免闲聊。`;
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemNote),
      vscode.LanguageModelChatMessage.Assistant('好的，请开始提问。'),
    ];
    for (const turn of history) {
      if (turn.role === 'user') {
        messages.push(vscode.LanguageModelChatMessage.User(turn.text));
      } else {
        messages.push(vscode.LanguageModelChatMessage.Assistant(turn.text));
      }
    }
    messages.push(vscode.LanguageModelChatMessage.User(question));
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    log(`[chatWithWord] "${en}" Q="${question.slice(0, 50)}" -> ${text.length} chars`);
    return text.trim();
  } catch (e: any) {
    log(`[chatWithWord] error: ${e.message || e}`);
    return `⚠️ 出错: ${e.message || e}`;
  }
}

export interface ReadingArticle {
  id: string;
  title: string;         // EN title
  theme: string;         // short EN tag e.g. "life", "reflection"
  minutes: number;       // estimated read time
  sentences: Array<{ en: string; zh: string }>;
  vocab_used: string[];  // English words highlighted from the review pool
  created_at: string;
}

/** Generate 3-5 short reading pieces (青年文摘 style) that weave in a set of
 *  review-target words. Returns an array of articles (may be empty on error). */
export async function generateReadingArticles(
  reviewWords: Array<{ en: string; zh: string }>,
  extraWords: Array<{ en: string; zh: string }> = [],
  count = 4,
): Promise<ReadingArticle[]> {
  try {
    const model = await getModel();
    if (!model) { return []; }
    const vocabList = [...reviewWords, ...extraWords]
      .slice(0, 30)
      .map((w) => `- ${w.en} (${w.zh})`)
      .join('\n');
    const prompt =
      `你是一位英语学习内容作者。请为一名 CATTI 2 笔译目标的中国学习者创作 ${count} 篇短文，` +
      `风格类似《青年文摘》——温和、真诚、有小小的思考或触动，可以是生活片段、旅行感悟、成长小事、` +
      `观察随笔、职场反思、亲情故事等。每篇 250-400 词，约 4-6 分钟阅读时长。\n\n` +
      `**必须**尽量自然地使用以下复习词汇（每篇 3-6 个即可，不必全部塞进去）：\n${vocabList}\n\n` +
      `每篇文章须：\n` +
      `- 有一个吸引人的英文标题（title）\n` +
      `- 主题标签 theme：从 life / reflection / travel / growth / family / career / observation / relationship 里挑一个\n` +
      `- 分成 8-16 个短句（每句独立成行），每句配备中文翻译（zh）供后续按需查看\n` +
      `- 语言地道，句式多样（长短结合），避免堆砌生词\n` +
      `- vocab_used 里列出这篇里实际用到的目标词（英文，小写）\n\n` +
      `只输出一段 JSON 数组，不要 markdown 代码围栏，不要额外文字。格式示例：\n` +
      `[\n` +
      `  {\n` +
      `    "title": "The Morning Light",\n` +
      `    "theme": "reflection",\n` +
      `    "minutes": 5,\n` +
      `    "sentences": [\n` +
      `      {"en": "I woke up to a gray sky.", "zh": "我在灰蒙蒙的天空下醒来。"},\n` +
      `      {"en": "It felt like the world was holding its breath.", "zh": "仿佛世界屏住了呼吸。"}\n` +
      `    ],\n` +
      `    "vocab_used": ["gray", "breath"]\n` +
      `  }\n` +
      `]`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const raw = await collectResponse(response);
    log(`[generateReadingArticles] raw length: ${raw.length}`);
    // parseJson only handles objects; do a manual array extraction here.
    const arr = extractJsonArray(raw);
    if (!arr) {
      log(`[generateReadingArticles] parse failed, raw head: ${raw.slice(0, 200)}`);
      return [];
    }
    const now = new Date().toISOString();
    return arr.map((a: any, i: number) => ({
      id: `${Date.now()}-${i}`,
      title: String(a.title || `Untitled ${i + 1}`).trim(),
      theme: String(a.theme || 'life').trim(),
      minutes: Number(a.minutes) || 5,
      sentences: Array.isArray(a.sentences)
        ? a.sentences.filter((s: any) => s && s.en).map((s: any) => ({ en: String(s.en).trim(), zh: String(s.zh || '').trim() }))
        : [],
      vocab_used: Array.isArray(a.vocab_used) ? a.vocab_used.map((v: any) => String(v).toLowerCase()) : [],
      created_at: now,
    })).filter((a) => a.sentences.length >= 3);
  } catch (e: any) {
    log(`[generateReadingArticles] error: ${e.message || e}`);
    return [];
  }
}

function extractJsonArray(text: string): any[] | null {
  try { const p = JSON.parse(text); if (Array.isArray(p)) { return p; } } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { const p = JSON.parse(fence[1].trim()); if (Array.isArray(p)) { return p; } } catch {}
  }
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try { const p = JSON.parse(text.slice(start, end + 1)); if (Array.isArray(p)) { return p; } } catch {}
  }
  return null;
}
