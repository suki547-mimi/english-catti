import * as vscode from 'vscode';

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

function parseJson(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) { return null; }
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
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
      `你是一位英语学习助手。参考中文释义："${referenceZh}"。学习者的答案："${userAnswer}"。\n` +
      `判断答案是否与参考释义语义等价（同义词、意思相近的表达都算对，不要求逐字一致）。\n` +
      `只返回一个 JSON：{"correct": true/false, "feedback": "简短中文说明，1 句话"}`;
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
