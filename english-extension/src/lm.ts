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
