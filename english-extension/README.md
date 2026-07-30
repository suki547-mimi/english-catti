# English CATTI — VS Code Extension

个人 CATTI 2 笔译 + 3 口译词汇训练器。整合本工作区已经建好的：
- ~18k 词条 / ~13k 独立 headword（合并本地资料 + ChinaDaily + CATTI 3 + Google 10k）
- 1,549 双语句对（张培基 + 白皮书 + ChinaDaily）
- ~35k 音频文件（edge-tts 生成的 US + UK）

## 当前状态：M0 骨架

已实现：
- ✅ 4 个 tab：词本浏览 / 学习 / 复习 / 统计
- ✅ 从工作区 `data/` 读词库、句库、音频索引
- ✅ 字母 tab（A-Z）+ 搜索
- ✅ 每条词有 🇺🇸 / 🇬🇧 音频按钮，点击即播
- ✅ 关 1（EN→ZH）演示，接入 `vscode.lm`（GitHub Copilot）判分
- ✅ 数据统计页

未实现（明天验收后一起补）：
- ⏳ SM-2 SRS 状态持久化（当前只随机抽词）
- ⏳ 关 2/3/4/5（ZH→EN、搭配填空、造句、情境填空）
- ⏳ 学习状态持久化（IndexedDB 或 workspaceState）
- ⏳ 命令面板 / keybinding 优化
- ⏳ 图标 / 打包 vsix

## 如何跑起来

前提：本机装了 Node.js（`node -v` 能返回 18+）。若没装：
```powershell
winget install OpenJS.NodeJS.LTS   # 若 winget 被禁，从 https://nodejs.org 下载 LTS
```

首次编译：
```powershell
cd english-extension
npm install
npm run compile
```

调试运行：
1. 用 VS Code 打开 `english-extension` 目录（或直接在当前多根工作区里）
2. 按 `F5` 打开"扩展开发主机"窗口
3. 在开发主机窗口里打开工作区根目录 `c:\Cursorworkspace\English`
4. `Ctrl+Shift+P` → 输 `English CATTI: Open Vocabulary Trainer`
5. 也可以 `Ctrl+Alt+E` 快捷键

## 数据源约定

扩展读取的路径：
- `<workspace-root>/data/unified_vocab.json`  — 词库
- `<workspace-root>/data/unified_sentences.json`  — 句库
- `<workspace-root>/data/audio_index.json`  — 音频索引（`{ en_text: {hash, us, uk} }`）
- `<workspace-root>/data/audio/us/*.mp3`  — 美音
- `<workspace-root>/data/audio/uk/*.mp3`  — 英音

## 目录

```
english-extension/
├── package.json          # 扩展清单
├── tsconfig.json
├── src/
│   ├── extension.ts      # 入口，注册命令
│   ├── panel.ts          # Webview panel 管理 + 消息路由
│   └── lm.ts             # vscode.lm 封装（关 1 / 关 4 判分）
├── webview/
│   ├── index.html
│   ├── main.js
│   └── styles.css
├── .vscodeignore
├── .gitignore
└── README.md
```
