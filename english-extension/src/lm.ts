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
    const isPhrase = en.trim().split(/\s+/).length >= 2;
    const strictNote = isPhrase
      ? `\n**关键要求**：这是一个多词的短语/搭配。例句里必须**完整地、原封不动地**用到 "${en}"（可以是词形变化如复数/时态，但不能拆开）。禁止只用其中某一个词。`
      : `\n**关键要求**：例句必须包含目标词 "${en}"（允许词形变化如 -s / -ed / -ing）。`;
    const prompt =
      `请围绕英文词 "${en}"（中文意思：${zh}）写一个 1-2 句自然地道的例句。\n` +
      `场景优先选政治、经济、文化、时政类（CATTI 常见话题）。${strictNote}\n\n` +
      `严格只输出 JSON（无 markdown 围栏，无额外文字）：\n` +
      `{"en": "英文原文（必须真实包含目标词）", "zh": "对应中文翻译"}`;
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

/** Story mode: Generate a short vivid English narrative (100-180 words) that
 *  makes the target word/phrase concrete. Real scenarios, characters, tension. */
export async function generateStoryContext(en: string, zh: string): Promise<{ en: string; zh: string } | null> {
  try {
    const model = await getModel();
    if (!model) { return null; }
    const isPhrase = en.trim().split(/\s+/).length >= 2;
    const strictNote = isPhrase
      ? `**关键**：这是一个多词短语。故事里必须**完整地、原封不动地**用到 "${en}"（允许词形变化如复数/时态）。不能拆开。`
      : `**关键**：故事里必须用到目标词 "${en}"（允许词形变化）。`;
    const prompt =
      `你是一位擅长写英语学习故事的作者。请围绕英文词 "${en}"（中文意思：${zh}）写一个 100-180 词的英文短故事。\n\n` +
      `故事要求：\n` +
      `- 有具体场景（国家、公司、家庭、法庭、街头等——挑最贴合这个词的语境）\n` +
      `- 有真实的角色和冲突/情节（比如 "cross retaliation" 可以写两个国家贸易战里 A 国对 B 国不同领域的报复）\n` +
      `- 让读者读完立刻理解这个词在真实世界里怎么用、什么感觉\n` +
      `- 语言地道，句子长短结合，避免堆砌\n` +
      `- 故事完整，不要写成一个片段\n\n` +
      `${strictNote}\n\n` +
      `严格只输出 JSON（无 markdown 围栏，无额外文字）：\n` +
      `{"en": "英文故事", "zh": "对应的地道中文翻译"}`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    log(`[generateStoryContext] "${en}" raw len=${text.length}`);
    const parsed = parseJson(text);
    if (!parsed || !parsed.en || !parsed.zh) { return null; }
    return { en: String(parsed.en), zh: String(parsed.zh) };
  } catch (e: any) {
    log(`[generateStoryContext] error: ${e.message || e}`);
    return null;
  }
}

/** Fun mode: 小红书 / social-media style English post (80-140 words). Lively,
 *  emoji-friendly, hooks, life-scenario. Target word woven in naturally. */
export async function generateFunContext(en: string, zh: string): Promise<{ en: string; zh: string } | null> {
  try {
    const model = await getModel();
    if (!model) { return null; }
    const isPhrase = en.trim().split(/\s+/).length >= 2;
    const strictNote = isPhrase
      ? `**关键**：这个多词短语必须原封不动地出现在文中（可词形变化，不能拆开）。`
      : `**关键**：目标词必须原封不动地出现（可词形变化）。`;
    const prompt =
      `你是一位活泼的英语博主，风格类似 Instagram Reels / 小红书笔记。围绕英文词 "${en}"（意思：${zh}）` +
      `写一段 80-140 词的英文短帖。\n\n` +
      `风格要求：\n` +
      `- 有钩子（第一句抓人眼球，像刷到笔记的感觉）\n` +
      `- 生活化场景（约会、职场、旅行、看剧、小八卦……）\n` +
      `- 短句多、语气活泼、可以用 emoji（1-3 个即可，不要泛滥）\n` +
      `- 结尾可以有小反转或俏皮话\n\n` +
      `${strictNote}\n\n` +
      `严格只输出 JSON（无 markdown 围栏，无额外文字）：\n` +
      `{"en": "英文短帖", "zh": "对应的活泼中文翻译"}`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    log(`[generateFunContext] "${en}" raw len=${text.length}`);
    const parsed = parseJson(text);
    if (!parsed || !parsed.en || !parsed.zh) { return null; }
    return { en: String(parsed.en), zh: String(parsed.zh) };
  } catch (e: any) {
    log(`[generateFunContext] error: ${e.message || e}`);
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

/** Generate 3-5 short reading pieces (青年文摘 style). Vocab is used as a
 *  gentle hint pool, NOT a hard requirement — the prompt prioritizes literary
 *  quality over cramming target words. Returns { items, error?: string }. */
export async function generateReadingArticles(
  reviewWords: Array<{ en: string; zh: string }>,
  extraWords: Array<{ en: string; zh: string }> = [],
  count = 4,
): Promise<{ items: ReadingArticle[]; error?: string }> {
  try {
    const model = await getModel();
    if (!model) { return { items: [], error: '未找到可用的 Copilot 语言模型（请先登录 GitHub Copilot）。' }; }
    // Pick a small, high-signal vocab pool as gentle hint (max 12 words)
    const hintPool = [...reviewWords.slice(0, 8), ...extraWords.slice(0, 4)]
      .filter((w) => w && w.en && /^[a-zA-Z\s\-']{2,}$/.test(w.en));
    const vocabList = hintPool.length
      ? hintPool.map((w) => `- ${w.en} (${w.zh})`).join('\n')
      : '(暂无——请自由发挥)';
    const themes = ['life', 'reflection', 'travel', 'growth', 'family', 'career', 'observation', 'relationship'];
    const seedTheme = themes[Math.floor(Math.random() * themes.length)];
    const prompt =
      `你是一位优秀的英语学习内容作者，风格接近《青年文摘》《读者》《The New York Times · Modern Love》。\n\n` +
      `请为一名 CATTI 2-3 水平的中国学习者创作 ${count} 篇短文。\n\n` +
      `**最重要的原则**：\n` +
      `1. **质量第一**。宁可完全不用下面提供的词汇，也不要生硬拼凑。这些词汇只是"可选择性调味料"，不是"必须完成的清单"。\n` +
      `2. 每篇文章要有真实的感受、洞察、或触动的瞬间——不是编造的"励志故事"，而是让读者读完可以静静回味的那种小文。\n` +
      `3. 语言地道、干净、有节奏感。**长短句结合**，善用平实的动词，避免形容词堆砌。\n` +
      `4. 题材尽量**多样化**（每篇不同主题）：其中一篇建议从主题 "${seedTheme}" 开始想。\n\n` +
      `**可选**参考词汇（如果自然，用其中 1-4 个即可；不自然就完全不用）：\n${vocabList}\n\n` +
      `每篇结构：\n` +
      `- title：吸引人的英文标题（不要用感叹号、不要老套的"the power of X"套路）\n` +
      `- theme：从这 8 个里挑一个：${themes.join(' / ')}\n` +
      `- minutes：预估阅读时间 (4-6)\n` +
      `- sentences：数组，10-16 个短句，每个 { "en": "...", "zh": "..." }，zh 是自然流畅的翻译（不是硬直译）\n` +
      `- vocab_used：这篇里实际用到的建议词汇（英文小写；如果没用就是空数组）\n\n` +
      `**输出**：只输出一段 JSON 数组。不要 markdown 代码围栏，不要任何解释性文字，直接以 \`[\` 开头，以 \`]\` 结尾。\n` +
      `格式示例（只是示例，不要照抄内容）：\n` +
      `[\n` +
      `  {\n` +
      `    "title": "The Morning Light",\n` +
      `    "theme": "reflection",\n` +
      `    "minutes": 5,\n` +
      `    "sentences": [\n` +
      `      {"en": "I woke up before the alarm.", "zh": "闹钟没响我就醒了。"},\n` +
      `      {"en": "The light was thin and gray, like a memory that has been washed too many times.", "zh": "光线薄而灰，像被反复洗过的记忆。"}\n` +
      `    ],\n` +
      `    "vocab_used": ["thin", "memory"]\n` +
      `  }\n` +
      `]`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const raw = await collectResponse(response);
    log(`[generateReadingArticles] raw length: ${raw.length}`);
    const arr = extractJsonArray(raw);
    if (!arr) {
      log(`[generateReadingArticles] parse failed. Head: ${raw.slice(0, 400)}`);
      return { items: [], error: `LLM 返回未能解析为 JSON 数组（原文前 200 字：${raw.slice(0, 200)}…）` };
    }
    const now = new Date().toISOString();
    const items = arr.map((a: any, i: number) => ({
      id: `${Date.now()}-${i}`,
      title: String(a.title || `Untitled ${i + 1}`).trim(),
      theme: String(a.theme || 'life').trim(),
      minutes: Number(a.minutes) || 5,
      sentences: Array.isArray(a.sentences)
        ? a.sentences.filter((s: any) => s && s.en).map((s: any) => ({ en: String(s.en).trim(), zh: String(s.zh || '').trim() }))
        : [],
      vocab_used: Array.isArray(a.vocab_used) ? a.vocab_used.map((v: any) => String(v).toLowerCase()) : [],
      created_at: now,
    })).filter((a) => a.sentences.length >= 5);
    if (items.length === 0) {
      return { items: [], error: `LLM 生成了 ${arr.length} 项，但没有一篇达到最少 5 句的标准。` };
    }
    return { items };
  } catch (e: any) {
    log(`[generateReadingArticles] error: ${e.message || e}`);
    return { items: [], error: `LLM 调用异常: ${e.message || e}` };
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

// ============ Gates 2-5 support ============

/** Gate 2: ZH → EN. User was shown the Chinese meaning and typed English.
 *  Grade whether their answer semantically matches the target English word/phrase.
 *  Accepts synonyms, minor form differences (walk/walking/walked), etc. */
export async function gradeReverseSemantic(userEn: string, targetEn: string, zhHint: string): Promise<GradeResult> {
  try {
    const model = await getModel();
    if (!model) { return { correct: false, feedback: '未找到可用的语言模型。' }; }
    const prompt =
      `你是一位英语学习助手。学习者看到中文意思"${zhHint}"，被要求写出对应的英文表达。\n` +
      `目标英文（参考）："${targetEn}"\n` +
      `学习者的答案："${userEn}"\n\n` +
      `判分规则：\n` +
      `- 同义词、近义词都算对（例：happy / glad / joyful 都对）\n` +
      `- 词形变化算对（例：walk / walked / walking）\n` +
      `- 拼写错误 1-2 个字母也可以算对但要提示\n` +
      `- 只输出一行 JSON：{"correct": true 或 false, "feedback": "中文简短点评一句，如果和参考不同但对，说明"}`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    const parsed = parseJson(text);
    if (!parsed) { return { correct: false, feedback: `LLM 返回异常: ${text.slice(0, 80)}` }; }
    return { correct: !!parsed.correct, feedback: String(parsed.feedback || '') };
  } catch (e: any) {
    return { correct: false, feedback: `LM 错误: ${e.message || e}` };
  }
}

/** Gate 3: Generate a collocation cloze — a short phrase with the target word
 *  blanked out, and the correct answer. */
export async function generateCollocationCloze(en: string, zh: string): Promise<{ stem: string; answer: string; hint: string } | null> {
  try {
    const model = await getModel();
    if (!model) { return null; }
    const prompt =
      `为学习者生成关于英文词 "${en}"（意思："${zh}"）的一个高频搭配填空题。\n\n` +
      `要求：\n` +
      `- 选一个真实、高频的英语搭配（例：如果词是 "make"，可选 "make a decision"）\n` +
      `- 把目标词挖空，用 \`___\` 表示空格\n` +
      `- 挖空后剩下的部分要足够长以提供语境（至少 3 个词）\n` +
      `- hint 是一句提示（中文），不要直接说答案\n\n` +
      `只输出一行 JSON：{"stem": "带 ___ 的短语", "answer": "被挖掉的词（原形）", "hint": "中文提示一句"}`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    const parsed = parseJson(text);
    if (!parsed || !parsed.stem || !parsed.answer) { return null; }
    return {
      stem: String(parsed.stem).trim(),
      answer: String(parsed.answer).trim(),
      hint: String(parsed.hint || '').trim(),
    };
  } catch (e: any) {
    log(`[collocationCloze] ${e.message || e}`);
    return null;
  }
}

/** Gate 3 grade: check whether the filled word matches the expected answer (or a valid variant). */
export async function gradeCollocation(userAnswer: string, expected: string, stem: string): Promise<GradeResult> {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (norm(userAnswer) === norm(expected)) {
    return { correct: true, feedback: '✓ 完全一致' };
  }
  // For lexical variants (walk vs walking) let LLM decide
  try {
    const model = await getModel();
    if (!model) { return { correct: false, feedback: `期待: ${expected}` }; }
    const prompt =
      `搭配填空题：\n"${stem}"\n\n` +
      `期待答案："${expected}"\n学习者填的是："${userAnswer}"\n\n` +
      `是否算对？考虑：单复数变形、时态、大小写、拼写小错。只输出一行 JSON：\n` +
      `{"correct": true 或 false, "feedback": "中文简短点评"}`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    const parsed = parseJson(text);
    if (!parsed) { return { correct: false, feedback: `期待: ${expected}` }; }
    return { correct: !!parsed.correct, feedback: String(parsed.feedback || `期待: ${expected}`) };
  } catch (e: any) {
    return { correct: false, feedback: `LM 错误: ${e.message || e}` };
  }
}

/** Gate 5 (context cloze) grade — usually deterministic string match with variants. */
export async function gradeContextCloze(userAnswer: string, expected: string, sentence: string): Promise<GradeResult> {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (norm(userAnswer) === norm(expected)) {
    return { correct: true, feedback: '✓ 完全一致' };
  }
  try {
    const model = await getModel();
    if (!model) { return { correct: false, feedback: `期待: ${expected}` }; }
    const prompt =
      `语境填空题（原句括号里是被挖掉的目标词）：\n"${sentence}"\n\n` +
      `期待答案："${expected}"\n学习者填的是："${userAnswer}"\n\n` +
      `是否算对？可接受词形变化，但要求语义完全一致。只输出一行 JSON：\n` +
      `{"correct": true 或 false, "feedback": "中文简短点评"}`;
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    const parsed = parseJson(text);
    if (!parsed) { return { correct: false, feedback: `期待: ${expected}` }; }
    return { correct: !!parsed.correct, feedback: String(parsed.feedback || '') };
  } catch (e: any) {
    return { correct: false, feedback: `LM 错误: ${e.message || e}` };
  }
}

/** Free-form AI tutor chat — no specific target word.
 *  Uses full history so the tutor remembers prior questions in the same session. */
export async function chatFreeform(
  history: Array<{ role: 'user' | 'assistant'; text: string }>,
  question: string,
): Promise<string> {
  try {
    const model = await getModel();
    if (!model) { return '⚠️ 未找到可用的语言模型。'; }
    const systemNote =
      `你是一位英语学习助手，专为准备 CATTI 2 笔译 / 3 口译考试的中国学习者服务。` +
      `你可以：\n` +
      `- 解释单词/短语/习语的含义、词源、语域、使用场景\n` +
      `- 辨析近义词、翻译难点\n` +
      `- 提供高质量例句（尽量地道，标准中文翻译）\n` +
      `- 讨论英美文化背景、成语典故、影视名场面里的用法\n` +
      `- 帮忙润色英文写作、找到更好的表达\n\n` +
      `回答简洁、准确、地道。中文为主，可以夹带英文示例。避免闲聊和过度铺垫。`;
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemNote),
      vscode.LanguageModelChatMessage.Assistant('好的，请开始提问。'),
    ];
    for (const turn of history) {
      if (turn.role === 'user') { messages.push(vscode.LanguageModelChatMessage.User(turn.text)); }
      else { messages.push(vscode.LanguageModelChatMessage.Assistant(turn.text)); }
    }
    messages.push(vscode.LanguageModelChatMessage.User(question));
    const cts = new vscode.CancellationTokenSource();
    const response = await model.sendRequest(messages, {}, cts.token);
    const text = await collectResponse(response);
    log(`[chatFreeform] Q="${question.slice(0, 50)}" -> ${text.length} chars`);
    return text.trim();
  } catch (e: any) {
    log(`[chatFreeform] error: ${e.message || e}`);
    return `⚠️ 出错: ${e.message || e}`;
  }
}

