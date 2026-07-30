# CATTI 英语学习项目

> **目标**：以 CATTI 2 笔译 + 3 口译为主线，同时全方位提升英语。单人自用。
> **底子**：IELTS 7.5，多年未系统学习需重启。
> **项目位置**：`c:\Cursorworkspace\English`
> **状态**：数据管线完成、内容源扩面中；功能页面尚未开工。

---

## 目录

- [一分钟速览](#一分钟速览)
- [🟠 待你确认的事项](#-待你确认的事项下次动手前先看这里)
- [🟢 已确定的决策](#-已确定的决策)
- [四大功能](#四大功能)
  - [功能 1：单词本网页](#功能-1单词本网页)
  - [功能 2：工作日闹钟](#功能-2工作日闹钟)
  - [功能 3：艾宾浩斯 SRS 双入口](#功能-3艾宾浩斯-srs-双入口)
  - [功能 4：5 级熟练度 + 5 关判定](#功能-45-级熟练度--5-关判定)
- [记忆/学习理论要点](#记忆学习理论要点)
- [数据资源](#数据资源)
- [环境 & 技术栈](#环境--技术栈)
- [工件速查](#工件速查)
- [时间线 / 优先级](#时间线--优先级)
- [考试选型参考](#考试选型参考)
- [更新日志](#更新日志)

---

## 一分钟速览

| 项 | 数值 / 状态 |
|---|---|
| 本地资料 | 20 doc + 1 docx + 2 pdf + 1 apkg（张培基 9484 卡）→ 已入库 |
| 网络已抓 | ChinaDaily 每日一词 223 篇 + 外交部 41 天 EN+CN |
| 外部骨架 | CATTI 3 口译 5,000 词（GitHub 开源 CSV，含 12 类话题） |
| 张培基 apkg | **2,212 中英对齐句** + 1,033 英文短句（明文可读） |
| 双语句总量 | 白皮书 101 + ChinaDaily 410 + MFA 278 + 张培基 2,212 = **3,001**（去重后 **1,549**） |
| 术语总量 | 合并去重后 **18,193** entries / **12,950 unique headword**（本地 + ChinaDaily + CATTI3 + Google 10k 补量）|
| 单词音频 | ✅ 完成：17,469 unique EN × 2 accents = **34,938 mp3**（426 MB，US+UK） |
| 例句音频 | ✅ 完成：1,549 语料句 × 3 口音 = **4,370 mp3**（US+UK+ZH，94%）+ LLM 现场生成句按需 edge-tts |
| IPA 音标 | ✅ 91% 覆盖（Youdao 4,210 + FreeDict 641；11,000+ 词有音标） |
| VS Code 扩展 | ✅ **v0.3.0** — `english-extension/`，5 tab（词本/学习/复习/📚 读书角/统计），vscode.lm + Copilot Chat 深度集成 |
| Git 备份 | ✅ `github.com/suki547-mimi/english-catti` 已同步；日常 `.\tools\backup.ps1` |
| 学习进度存储 | ✅ `user_state.json` + 每日备份 30 份轮换；`state.currentLearnSession` 落盘（reload 可续 4/10） |
| 艾宾浩斯 SRS | ✅ 已就绪：`[1, 2, 4, 7, 15, 30]` 天间隔 · gap-preservation 逻辑 · 分数驱动大池辅助 |
| 5 关判定 | ⏳ 仅关 1 上线（EN→ZH LLM 语义判分）；关 2/3/4/5 UI 未做 |
| 读书角 | ✅ v0.3.0 首发：LLM 生成《青年文摘》风格短文 · 开机后台自动生成 · 逐句 Copilot 讲解 · 收藏夹 · 单句/逐句音频 |
| 深度学习卡 | ✅ 英英/常用度/近义辨析/影视名场面/高频搭配 · 后台预取 3 个词（点击瞬发） |
| 闹钟 | ✅ v0.3.0 上线：VS Code 内每日提醒（默认 10:00 / 15:00 / 20:00）· 通知内 3 选 1 快捷入口 · Windows Task Scheduler 系统级提醒（VS Code 关着也响）· 智能跳过（今日目标已达 → 不打扰） |
| CATTI 2 词表 | ❌ GitHub 多次限速，未成功获取官方版；当前 12.9k headwords 已覆盖高频 |

---

## 🟠 待你确认的事项（下次动手前先看这里）

按优先级从高到低：

| # | 议题 | 我的建议 | 你的决定 |
|---|---|---|---|
| ~~Q1~~ | ~~**内容源方向**~~ | ~~B 方案~~ | ✅ **2026-07-29 定：B 方案**。三源并行：张培基散文 / 外交部记者会 / Economist 双语。词汇量按 CATTI 2 + ATA 标准 |
| ~~Q1a~~ | ~~**词汇量目标**~~ | ~~15,000-18,000 独立英文 headword~~ | ✅ **2026-07-29 定**：目标 15-18k headword，每词 1-3 释义 + 1 真实例句 |
| ~~Q1b~~ | ~~**词汇骨架**~~ | ~~CATTI 3 + COCA 15k 兜底~~ | ✅ **2026-07-29 定**：Google 10k 补量，headword 从 5,778 → 12,950（[augment_google10k.py](../tools/augment_google10k.py)）；CATTI 2 官方词表若后续找到再合并 |
| ~~Q2~~ | ~~**CATTI 目标时间线**~~ | ~~3 口先~~ | ✅ **2026-07-29 定**：不设截止日期，**每天 10 词，作长期基础** |
| ~~Q3~~ | ~~**是否规划国际考试**~~ | ~~CATTI 2 笔过后再看~~ | ✅ **2026-07-29 定**：**暂不规划**，专注 CATTI |
| ~~Q4~~ | ~~**关 3 近义词辨析**~~ | ~~改选修~~ | ✅ **2026-07-29 定**：关 3 **改成"搭配填空 collocation cloze"**（详见功能 4） |
| ~~Q5~~ | ~~**LLM 打分接哪个？**~~ | ~~做 VS Code 扩展~~ | ✅ **2026-07-29 定**：做 VS Code 扩展 + Webview，白嫖 Copilot（vscode.lm API） |
| ~~Q6~~ | ~~**前端技术栈**~~ | ~~VS Code Webview~~ | ✅ **2026-07-29 定**：Webview 内嵌 SPA（技术栈可选 Vanilla/React/Vue），完全支持交互（tab / 卡片 / 音频 / 拖拽） |
| Q7 | **CATTI PDF OCR 补词** | 推迟 | ⏳ |
| ~~Q8~~ | ~~**数据备份策略**~~ | ~~git 私仓~~ | ✅ **2026-07-29 完成**：初始 push 到 `github.com/suki547-mimi/english-catti`；日常用 `tools\backup.ps1` |
| ~~Q9~~ | ~~**发音库**~~ | ~~edge-tts~~ | ✅ **2026-07-29 夜生成**：17,469 unique EN × 2 accents = 34,938 mp3，约 350 MB；[generate_audio.py](../tools/generate_audio.py) 支持增量恢复 |
| Q10 | **词库合并/去重策略**：本地 6,038 + ChinaDaily 580 + CATTI3 5,000 + 张培基 headword 提取 后如何去重？优先级？| 建议合并 key = `(headword.lower(), zh.lower())`；同 key 保留最丰富的一条，合并 `sources[]` | ⏳ |
| Q11 | **Economist 备选**：原源下线，怎么补？| 建议：抓 chinadaily 双语新闻栏 或 直接抓 fmprc 白皮书英/中版 | ⏳ |

---

## 🟢 已确定的决策

- **项目形态**：单人自用，本地部署，无需登录/多用户/服务器
- **数据管线**：Word COM 转 doc→docx + `python-docx` + `PyMuPDF (fitz)` + 自定义 ZH↔EN 切分（`_best_split`）
- **Chrome MCP 接入方式**：`.vscode/mcp.json` 配 `type: "http"`，指向 `127.0.0.1:12306/mcp`；使用前跑桌面 `start-chrome-mcp.bat`
- **词条数据模型**：`id / zh / en / headword / letter / topic / sources[] / kind(word|phrase|sentence)`
- **双语句数据模型**：`zh / en / source / url / date / kind(lead|speech)`
- **SRS 算法**：SM-2（Anki 同款），不自己造艾宾浩斯区间
- **两个学习入口**：`/learn`（未见过的新词）与 `/review`（到期复习）
- **每日新词上限**：20；复习无上限
- **闹钟实现**：Windows 计划任务 + PowerShell + BurntToast，工作日 10:00 / 15:00 / 17:00
- **5 关判定核心思想**：5 题不集中做（massed），而是散布到 5 次不同复习会话（spacing），每关只做 1 题
- **Q5 题型**：**情境填空**——从真实双语句语料挖空目标词，让用户填
- **前测（pre-test）**：新词首次学习先让用户猜，再揭示答案（对错都揭示）
- **内容方向**：不只服务 CATTI 2 笔，覆盖 2 笔 + 3 口 + 全方位提升
- **不用**：`NAETI`（已停考）、上海高级口译（区域性，含金量下降）
- **不做**：多用户账号系统、社交分享、云端同步（暂时）

---

## 四大功能

### 功能 1：单词本网页

**已定**
- 展示形式：字母 tab（A–Z）+ 话题 tab
- 存储：静态 JSON 首屏加载 + IndexedDB 存学习状态
- 性能方案：Tanstack Virtual 虚拟列表 + FlexSearch 全库搜索
- 词条粒度：**保留短语级**（不硬拆成单词）；额外抽 headword 做字母索引

**待议**
- 具体前端框架（Vanilla vs 极小 React）→ 见 Q6
- 首屏是否按 kind 分区（word / phrase / sentence 各一 tab）
- 是否需要「话题混排 vs 严格分组」两种视图切换

---

### 功能 2：工作日闹钟

**已定**
- 触发时间：工作日 10:00 / 15:00 / 17:00（3 次/天）
- 技术方案：Windows 计划任务 + PowerShell + BurntToast
- 弹窗点击行为：`Start-Process` 打开本地学习页 `http://localhost:xxxx/#/review`
- 假期识别：**不做**（依赖 Windows 内置"仅工作日"，元旦国庆等法定假期不会额外识别）

**待议**
- 端口占用规则（建议固定 5173 或 4173，Vite 默认）
- 学习页启动方式：常驻本地服务 vs 每次点击闹钟才启

---

### 功能 3：艾宾浩斯 SRS 双入口

**已定**
- 算法：**SM-2**（`ease_factor` 初始 2.5，`interval` 递增）
- 数据模型：
  ```
  word_id, level(1..5), ease_factor, interval_days,
  due_at, last_reviewed_at, last_result,
  streak, history[]
  ```
- `/learn` 入口：抽 `due_at IS NULL` 的新词，按话题或字母
- `/review` 入口：抽 `due_at <= now()` 的词，按到期先后
- 每日新词上限：20；复习无上限
- 每关（Q1–Q5）通过 → level +1；不通过 → level 保持 & 重新排入下次复习

**待议**
- 每关不通过时，`ease_factor` 怎么衰减
- 长时间未见过的词（超过 30 天）是否自动降级
- Q3 是否影响 level（见 Q4）

---

### 功能 4：5 级熟练度 + 5 关判定

**已定核心机制**
- Level 1 = 完全不知道，Level 5 = 娴熟
- 5 关**分散到 5 次不同复习会话**，每次只做 1 关（间隔重复 spacing）
- 每关对应一次会话，通过后 `level += 1`

**每关设计（2026-07-29 更新）**

| 关 | 题型 | 判分 | 触发 | 命中原理 |
|---|---|---|---|---|
| 关 1 | EN→ZH，多义都算对 | LLM 语义匹配 | 首次见 / L1→L2 | Testing Effect |
| 关 2 | ZH→EN，Levenshtein ≤ 2 字母算对 | 字符串距离 | 20 分钟后 / L2→L3 | Generation Effect |
| **关 3** | **搭配填空 collocation cloze**（新）：给一句用了此词的真实例句，把**搭配对象**挖空。例：`___ economic growth` 让填 `sustained/robust/high-quality` 之一（多个正解都行） | 词库预置正解 + LLM 兜底判等价 | 次日 / L3→L4 | Collocational Knowledge |
| 关 4 | 造句 | LLM 判语法 + 用法 + 自然度 | 3 天后 / L4→L5 | Elaboration |
| 关 5 | **情境填空**（真实双语句挖目标词） | 字符串精确/Levenshtein | 7 天后 / L5→S（stable） | Context-Dependent Memory |

**关于原关 3（近义词辨析）**：改为 **"精通模式"** 独立入口，不进 level 门槛，用户自己选做，练习时给结构化 rubric（语义强弱 / 语域 / 常见搭配 / 情感色彩四维度）辅助学习。

**待议**
- LLM 走哪家（见 Q5 → 建议改 VS Code 扩展方案）
- 用户答错反馈用什么形式：直接给答案 vs 提示语义再问一次

---

## 记忆/学习理论要点

给未来自己看，避免在设计判定题时忘掉：

| 原理 | 中文名 | 关键含义 |
|---|---|---|
| Spacing effect | 间隔效应 | 分次 > 集中，一次做 5 题的收益<< 5 天各做 1 题 |
| Testing effect | 测试效应 | 主动检索 >> 被动复读 |
| Generation effect | 生成效应 | 让学习者产出（造句、翻译）比给学习者读效果好 |
| Context-dependent memory | 情境依赖记忆 | 词的记忆强度受"语境"锚定，脱离真实语境的背单词收益递减 |
| Desirable difficulties | 合理难度 | 学习时"稍难一点"（正确率 60-85%）留存最好 |
| Elaborative interrogation | 精细提问 | "为什么"、"和 X 相比" 比机械重复留存好 |
| Pre-testing effect | 前测效应 | 让学习者先猜再看答案，比直接看答案效果好，哪怕猜错也一样 |

**反面教训**：
- 一天塞 100 新词 = 短期看似掌握、长期几乎全忘（massed 灾难）
- 只做 Q1（EN→ZH）反复练 = 有识别但不会产出（识别 ≠ 会用）
- Q3（辨析）如果 LLM 打分不稳，负反馈会打击自信 → **宁可不做**

---

## 数据资源

### 本地资料（已入库）

| 源 | 位置 | 数量 | 状态 |
|---|---|---|---|
| 分类词汇 20 份 doc | `Files\口译笔译分类词汇（01–20）*.doc` | ~6,000 条 | ✅ 已入 [data/vocab.json](../data/vocab.json) |
| 维和 30 年白皮书 | `Files\202009*.docx` | 247 段 → 101 双语句 | ✅ 已入 [data/corpus_sentences.json](../data/corpus_sentences.json) |
| CATTI 大纲词汇 PDF ×2 | `Files\CATTI*.pdf` | – | ⚠️ 扫描图片版，需要 OCR，暂缓 |

**说明**
- 分类词汇 05/12 原文段落被打包成大块，我按 `\n` 二次拆行处理
- 分类词汇 19（谚语）有 3 份重复文件，已去重
- 分类词汇 18 缺失（原本就没有，不是我漏了）
- 分类词汇 07 后半段是纯英文 WTO 术语注释，已过滤

### 已抓取的网络源

| 源 | 时间跨度 | 状态 |
|---|---|---|
| ChinaDaily 每日一词 | 2024-05 → 2025-05（12 个月，223 篇） | ✅ [data/chinadaily_vocab.json](../data/chinadaily_vocab.json) (580 术语) + [data/chinadaily_sentences.json](../data/chinadaily_sentences.json) (410 双语句) |
| CATTI 3 口译 5000 词 CSV | – | ✅ [data/catti3_vocab.json](../data/catti3_vocab.json) (5,000 词，含 12 类话题分类)　源：`sherylling1986-beep/catti-vocabulary` |
| 外交部例行记者会 EN+CN | 2026-06-01 → 2026-07-28（41 天） | ✅ [data/mfa_dialog_pairs.json](../data/mfa_dialog_pairs.json) **278 组对齐 Q&A**（283 EN / 281 CN，98.6% 对齐率） |

### 探测失败/暂缓的源

| 源 | URL | 问题 |
|---|---|---|
| 沪江 Economist 双语 | hjenglish.com/newsteneijingxueren/ | 404 栏目下线 |
| 可可英语 Economist | kekenet.com/Economist/ | 页面重定向，栏目撤了 |
| 百度百科 张培基 | baike.baidu.com | 403 反爬 |

### 待护苗的候选源

| 源 | 下一步 |
|---|---|
| 张培基《英译中国现代散文选》 | **需你手动提供 PDF/DOC**（版权作品，无合法免费源）→ 放到 `Files\` 即可 |
| Economist 双语 | 备选：直接抓英文单语版 + LLM 翻译 / GitHub 翻译者仓库 / 微信公众号历史归档 |
| gov.cn/english 白皮书 | 拓展 2024/2025 各主题白皮书（时政次补） |
| COCA/BNC 15k 频段 | Q1b 后补词量骨架，从 Paul Nation 公开站取 |
| 中国关键词 keywords.china.org.cn | 时政（会加剧不平衡），除非需要更多官方译法 |
| 术语在线 termonline.cn | 做按需查询工具，不批量抓 |
| TED 中英字幕 ted.com | 后期口译听感补强 |

**Q1 已定 → 三路并行进行中**（2026-07-29）：外交部 ✅、CATTI 3 骨架 ✅、张培基/Economist ⏳。

---

## 环境 & 技术栈

| 组件 | 版本 / 位置 | 用途 |
|---|---|---|
| Python | 3.14.2（`C:\Python314\`） | 数据管线 + 抓虫 |
| `python-docx` | 已装 | docx 解析 |
| `pywin32` | 已装 | Word COM 转 doc→docx |
| `PyMuPDF (fitz)` | 已装 | PDF 解析 |
| `pypdf` | 已装 | PDF 备用 |
| `requests` + `beautifulsoup4` + `lxml` | 已装 | 抓虫 |
| Office Word | 16.0 | COM 服务 doc→docx |
| Chrome MCP | 桌面 `start-chrome-mcp.bat` | 浏览器自动化，端口 12306（用前手动启动） |
| VS Code MCP | [.vscode/mcp.json](../.vscode/mcp.json) | 指 `http://127.0.0.1:12306/mcp` |
| 前端（未来） | 待定 → 见 Q6 | 词本页面 |

**Chrome MCP 启动流程**
1. 双击桌面 `start-chrome-mcp.bat`
2. 在打开的 Chrome 里确认 mcp-chrome 扩展在跑
3. `Get-NetTCPConnection -LocalPort 12306 -State Listen` 有输出即通
4. VS Code Copilot Chat 里就能调 chrome-mcp 工具

---

## 工件速查

**数据文件**（都在 [data/](../data/) 下）
| 文件 | 大小 | 说明 |
|---|---|---|
| [vocab.json](../data/vocab.json) | 1.4 MB | 6,038 本地词条 |
| [corpus_sentences.json](../data/corpus_sentences.json) | 83 KB | 101 白皮书双语句 |
| [build_report.json](../data/build_report.json) | 3 KB | 本地词库 A-Z / 话题 / kind 统计 |
| [chinadaily_vocab.json](../data/chinadaily_vocab.json) | 187 KB | 580 每日一词术语 |
| [chinadaily_sentences.json](../data/chinadaily_sentences.json) | 308 KB | 410 每日一词双语句 |
| [chinadaily_articles.json](../data/chinadaily_articles.json) | 344 KB | 223 篇原文结构备份 |
| [chinadaily_urls.txt](../data/chinadaily_urls.txt) | 40 KB | URL 索引 |
| [catti3_vocab.json](../data/catti3_vocab.json) | ~1.7 MB | 5,000 CATTI 3 口译骨架词 |
| [mfa_dialog_pairs.json](../data/mfa_dialog_pairs.json) | 819 KB | 278 组 MFA EN↔CN 对齐 Q&A |
| [mfa_articles.json](../data/mfa_articles.json) | 815 KB | 41 天 MFA 元数据 |
| [mfa_urls.txt](../data/mfa_urls.txt) | 8 KB | MFA URL 索引 |
| [zhangpeiji_pairs.json](../data/zhangpeiji_pairs.json) | ~1 MB | **2,212 张培基中英对齐句** |
| [zhangpeiji_en_snippets.json](../data/zhangpeiji_en_snippets.json) | ~150 KB | 1,033 张培基英文短句 |
| [data/external/](../data/external/) | – | GitHub 原始 CSV/JS + 张培基 anki 原始 JSON 备份 |

**脚本工件**（都在 [tools/](../tools/) 下）
| 文件 | 用途 |
|---|---|
| [sample_files.py](../tools/sample_files.py) | 初次抽样，`sample_report.json` 是它的输出 |
| [probe_pdf.py](../tools/probe_pdf.py) | 确认 CATTI PDF 是扫描版 |
| [build_vocab.py](../tools/build_vocab.py) | **本地资料 → vocab.json 生产管线** |
| [scrape_chinadaily.py](../tools/scrape_chinadaily.py) | **ChinaDaily 每日一词抓虫** |
| [scrape_mfa.py](../tools/scrape_mfa.py) | **外交部 EN+CN 对齐 Q&A 抓虫** |
| [import_catti3.py](../tools/import_catti3.py) | CATTI 3 五千词 CSV 入库 |
| [parse_apkg.py](../tools/parse_apkg.py) | Anki apkg → JSON |
| [import_zhangpeiji.py](../tools/import_zhangpeiji.py) | 张培基 Anki → 对齐句对 |
| [sample_report.json](../tools/sample_report.json) | 初次抽样报告 |

**配置**
| 文件 | 说明 |
|---|---|
| [.vscode/mcp.json](../.vscode/mcp.json) | VS Code 侧 MCP 配置 |
| （用户主目录）`.cursor\mcp.json` | Cursor 侧同款配置 |

---

## 时间线 / 优先级

按当前状态推荐的推进顺序：

```
1. [现在] 拍板 Q1（内容源方向）——影响后面所有事
        ├─ 如果选 B 方案：并行抓 张培基 / 外交部 / TED
        └─ 如果继续时政：再抓中国关键词补 500-1500 条

2. [下一步] 数据规范化合并：把本地 + 已抓 + 新抓的所有源
   合并为一份 unified_vocab.json + unified_sentences.json

3. [MVP-1] 功能 1 静态词本页
        ├─ A-Z tab / 话题 tab
        ├─ Tanstack Virtual + FlexSearch
        └─ 能查、能翻、不卡

4. [MVP-2] 功能 3 SRS 引擎（无判定，纯自评"记住/没记住"）

5. [MVP-3] 功能 4 判定系统
        ├─ 关 1、2、5 上线（不依赖 LLM 判分的先做）
        ├─ 关 4 造句上线（接 LLM，Q5 拍板后）
        └─ 关 3 精通模式（可选，最后做）

6. [MVP-4] 功能 2 Windows 计划任务闹钟（最简单，压轴）

7. [可选] CATTI PDF OCR 补词
```

**卡壳预警**
- 如果 Q1 不定 → 卡在第 1 步
- 如果 Q5 LLM 选型不定 → 关 1/4 做不了
- 如果 Q6 前端栈不定 → 第 3 步做不了

---

## 考试选型参考

（讨论时的完整记录，方便后续如果要重定目标查阅）

| 考试 | 出题方 | 定位 | 你要不要 |
|---|---|---|---|
| CATTI 2 笔 | 中国外文局 | 国内笔译最高 | ✅ 当前主线 |
| CATTI 3 口 | 中国外文局 | 国内口译基础 | ✅ 当前主线 |
| ATA EN⇔ZH | 美国翻译协会 | 国际商用金标准 | ⭐ 中期目标（2 笔过后） |
| UN LCE | 联合国 | 顶配 | ❌ 除非进 UN |
| CIOL DipTrans | 英国 | 欧洲标准 | ❌ 除非欧洲市场 |
| NAATI | 澳洲 | 澳新法定 | ❌ 除非移民 |
| 上海高级口译 | 上外 | 长三角 | ❌ 含金量下降 |
| NAETI | 教育部 | 已停考 | ❌ 别看老攻略 |
| AIIC | 国际会议口译员协会 | 顶配同传 | ❌ 长期职业才谈 |

**辅助路径**（非考试）：TAC 会员认证、TED 志愿字幕译者、TED 翻译作品挂 LinkedIn。

---

## 备份 & Git 私仓教程

### 一次性初始化（大约 5 分钟）

**1. 在项目根初始化 git**
```powershell
cd C:\Cursorworkspace\English
git init
git branch -M main
```

**2. 建 `.gitignore`**（下面这份已经写好在 `.gitignore`）
```
# 大量音频文件（生成后可能几百 MB）
data/audio/
data/audio_test/
# 原始 apkg / 大的原始下载
Files/*.apkg
data/external/*.js
# Python 缓存
__pycache__/
*.pyc
# VS Code local
.vscode/*.log
```

**3. 首次提交**
```powershell
git add .
git commit -m "chore: initial commit — data pipeline, scrapers, docs"
```

**4. 在 GitHub 上建**：
- 打开 https://github.com/new
- Repository name: `english-catti`（或你喜欢的）
- **Private** ✅
- 不要勾"initialize with README"（因为本地已经有了）

**5. 连接远程 + 推**
```powershell
git remote add origin git@github.com:<你的用户名>/english-catti.git
git push -u origin main
```
如果用 HTTPS：`https://github.com/<你的用户名>/english-catti.git`；第一次 push 会弹 GitHub 登录（选 Sign in with browser，然后授权 git credential manager 即可，之后不再问）。

### 日常备份（每天/每周一次）

```powershell
cd C:\Cursorworkspace\English
git add .
git commit -m "study: <一句话说今天做了啥>"
git push
```

**建议节奏**：
- 每天学完，一提交（提交信息写今天学了啥/加了什么源）
- 每周至少一次 push 到远程

### 恢复到某天的状态
```powershell
git log --oneline           # 看历史
git checkout <commit-hash>  # 临时切到某天
# 或者
git reset --hard <commit-hash>  # 危险！彻底回退到某天（会丢失之后的所有改动）
```

### 一键脚本（可选）
后期我可以给你写一个 `tools/backup.ps1`：跑一次自动 `git add + commit + push`，注释里带日期。

---

## 更新日志

| 日期 | 里程碑 |
|---|---|
| 2026-07-29 | 项目启动；本地资料评估完成；MCP 接入；本地词库（6,038）+ 白皮书句对（101）入库；ChinaDaily 12 月抓取完成（580 术语 + 410 句对）；本文档建立 |
| 2026-07-29 | **Q1 定 = B 方案**：三源并行（张培基/外交部/Economist），词汇量对齐 CATTI 2 + ATA（15-18k headword 目标）；开始探源 |
| 2026-07-29 | 探源结果：外交部 ✅可抓；沪江/可可 Economist ❌下线；张培基需手动 PDF；GitHub 发现开源 CATTI 3 五千词 CSV |
| 2026-07-29 | 入库 CATTI 3 五千词骨架（12 话题类）；MFA 抓虫完成 2 月 EN+CN 对齐（41 天 / 278 组 Q&A / 98.6% 对齐率） |
| 2026-07-29 | 用户提供张培基 Anki apkg（9,484 卡）→ 解析出 **2,212 张培基中英对齐句 + 1,033 英文短句**（加密仅在评析字段，明文可用） |
| 2026-07-29 | **一批决策落定**：Q1a/Q2/Q3/Q4/Q8 → 见待议表；新增 Q9（发音库）；发音方案定：edge-tts + Free Dict API + Youdao |
| 2026-07-29 | **重大架构调整**：功能 1+3+4 改为 **VS Code 扩展 + Webview** 形态，以复用 Copilot 免费额度做 LLM 判分 |
| 2026-07-29 | Git 私仓建立：MinGit 装到用户目录、初始 push 到 `github.com/suki547-mimi/english-catti`（70 文件 / 35 万行）；Q5+Q6+Q8 全部关掉 |
| 2026-07-29 | **词库合并完成**：三源去重合并 → 11,021 entries / **5,778 unique headword** / 1,549 双语句；[merge_all.py](../tools/merge_all.py) |
| 2026-07-29 夜 | **AFK 四合一开工**：<br>• A: Google 10k 补量 → 词库涨到 18,193 entries / **12,950 unique headword**（[augment_google10k.py](../tools/augment_google10k.py)）<br>• B: CATTI 2 词表再搜 GitHub 又限速，暂无结果<br>• C: [generate_audio.py](../tools/generate_audio.py) 启动，17,469 unique EN × 2 accents = 34,938 mp3 后台跑<br>• D: [english-extension/](../english-extension/) M0 骨架完成，4 tab + 关 1 演示 + vscode.lm 判分 |
| 2026-07-30 | **保存 bug 修复 + 会话持久化**：`user_state.json` 缺失（记录方法未 save）→ 全部补上；`currentLearnSession` 落盘 → reload 后能续 4/10；每日 30 份备份轮换；起始页新增 chips（今日新学 X/10 / 待复习 / 累计 / 词库） |
| 2026-07-30 | **例句音频**：批量 [generate_sentence_audio.py](../tools/generate_sentence_audio.py) 生成 1,549 句 × 3 口音（US/UK/ZH）；LLM 生成句支持按需 edge-tts + 磁盘缓存（`data/audio/sentences/dynamic/`） |
| 2026-07-30 | **读书角 tab 上线**：LLM 生成 3-5 篇《青年文摘》风格短文（复习词织入）；纯英文默认；点句 → Copilot Chat 讲解；🇨🇳 按钮切翻译；🇺🇸🇬🇧 单句/逐句播放；⭐ 收藏夹；数据存 `data/reading_corner/`（daily/`{date}.json` + `favorites.json`） |
| 2026-07-30 | **v0.3.0 发布**：<br>• 版本号从 0.0.1 → **0.3.0**（读书角+闹钟大特性）<br>• 读书角 **开机后台自动生成**（`maybeAutoGenerateReading` 在 activate 后 3s 触发）<br>• LLM prompt 重写：**质量 > 词汇覆盖**，词汇变"可选调味料"，句数 ≥ 5 才收<br>• 读书角**生成后立刻预取音频**（US+UK 并发 3，全部句子）→ 点播放瞬发<br>• 生成失败时展示原始错误消息 + Output 日志入口<br>• 空态提示改善：复习 tab 明确"艾宾浩斯要等明天""今天已过一遍" |
| 2026-07-30 | **闹钟功能开工**（v0.3.0 内）：<br>• VS Code 内提醒：`englishCatti.alarms.times`（默认 10:00 / 15:00 / 20:00）· 每次到点通知内含 学习/复习/读书角/再等 10 分钟 4 个按钮<br>• 智能跳过：如果今日已学 ≥10 词 且 待复习=0，静默跳过<br>• 命令 `English CATTI: Configure Daily Alarms` 交互设置时间<br>• 命令 `English CATTI: Install Windows System Alarms` 用 `schtasks.exe` 创建 Windows 任务计划（VS Code 关着也响）→ 生成 `data/notify_alarm.ps1` |

