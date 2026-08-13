# 🎙️ RVC 语音克隆项目（The Rookie）

给菜鸟老警的角色训练 RVC 模型，把我们本地的 edge-tts 台词转换成角色声。

---

## 一次性准备（本地）

**1. 装 yt-dlp（下载 YT 音频）**

```powershell
pip install yt-dlp
```

**2. 装 ffmpeg（音频处理）**

```powershell
# 用 Chocolatey：
choco install ffmpeg -y

# 或者直接下载：https://www.gyan.dev/ffmpeg/builds/ → ffmpeg-release-essentials.zip
# 解压把 bin 目录加进 PATH
ffmpeg -version   # 验证
```

**3. 挑角色 + 找 YT 剪辑**

首波推荐 3 个角色：

| 角色 | 建议关键词搜 YT |
|---|---|
| **John Nolan** (主角) | `John Nolan best scenes` / `John Nolan monologue` / `The Rookie John speech` |
| **Lucy Chen** | `Lucy Chen best moments` / `Lucy interrogation` |
| **Sergeant Grey** | `Sergeant Grey Rookie` / `Wade Grey office scene` |

**要求**：
- 一段视频里**只有一个人在说话**（对话戏不要，选独白 / 打电话 / 无线电报告 / 长台词）
- 尽量**无背景音乐 / 无枪声爆炸**
- 每个角色**累计 5-10 分钟**清晰语音（可以是多个短片段合起来）

**4. 填 CLIPS**

编辑 [tools/rvc_download_clips.py](../tools/rvc_download_clips.py) 里的 `CLIPS` 列表，每条：

```python
{"character": "john", "url": "https://youtube.com/watch?v=xxxx", "start": "0:15", "end": "0:45", "clip_id": "1"}
```

时间格式 `分:秒`，比如 `1:23` = 1 分 23 秒。

**5. 下载**

```powershell
python tools/rvc_download_clips.py
```

音频落在 `data/rvc/raw/john/*.wav`、`data/rvc/raw/lucy/*.wav`。

---

## 训练（Colab）

**6. 上传到 Google Drive**

把 `data/rvc/raw/john/` 整个文件夹压成 zip，扔到 Google Drive 里，比如：

```
Google Drive/rvc_datasets/john_raw.zip
```

对每个角色都做一次。

**7. 打开 Colab**

推荐的 RVC 一键笔记本（社区最活跃、维护勤）：

- [Mangio-RVC-Fork Colab](https://colab.research.google.com/github/Mangio621/Mangio-RVC-Fork/blob/main/Mangio_RVC_Fork.ipynb)
- 备选：[RVC-Project 官方](https://colab.research.google.com/github/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/blob/main/Retrieval_based_Voice_Conversion_WebUI.ipynb)

打开后要求登录 Google 账号 + 授权访问 Google Drive。

**8. 训练流程（每个角色跑一次）**

在 Colab 笔记本里按顺序：

1. **Runtime → Change runtime type → T4 GPU**（免费）
2. 运行第一个 cell 装依赖（几分钟）
3. 挂载 Google Drive（会弹授权页）
4. **Preprocess** 单元格：
   - 输入：`/content/drive/MyDrive/rvc_datasets/john_raw.zip`
   - 输出：`/content/dataset/john`
   - Sample rate：`40k` 或 `48k`（后者音质好但慢）
5. **Extract Features** 单元格：跑一遍
6. **Train** 单元格：
   - Experiment Name：`rookie_john`
   - Epochs：`200-500`（免费 GPU 大约 200 就够，2-3 小时）
   - Save frequency：每 50 epochs 存一次
7. 训练完，`.pth` 模型和 `.index` 索引文件会在 `/content/RVC/logs/rookie_john/` 里
8. **下载模型**：右击 `.pth` 和 `.index` → Download → 放到本地 `data/rvc/models/john/`

Colab **免费 GPU 每天 4-6 小时**，够跑一个角色。跑不完就断线，第二天接着来（把 checkpoint 传回 Drive 就行）。

---

## 推理（本地转声音）

**9. 本地装 RVC（推理用，不需要 GPU）**

```powershell
# 建独立 venv
python -m venv .venv-rvc
.\.venv-rvc\Scripts\Activate.ps1

# 克隆 fork
git clone https://github.com/Mangio621/Mangio-RVC-Fork rvc-inference
cd rvc-inference
pip install -r requirements.txt
```

**10. 批量转换脚本**

（我等你训练完再补 [tools/rvc_batch_convert.py](../tools/rvc_batch_convert.py)。做法：拿 `data/audio/sentences/en/us/*.mp3` 每一个作输入，RVC 推理输出到 `data/audio/sentences/rvc_john/*.mp3`。webview 加个"用角色声"按钮切换来源。）

---

## 建议进度

| 里程碑 | 时间 |
|---|---|
| **本周**：跑通 John 一个角色（10 分钟素材 + 200 epoch） | 3-5 小时活动时间 + 一晚训练 |
| **下周**：加 Lucy | 2-3 小时 |
| **有了 2 个角色的模型** | 我做批量转换 + 扩展里加"John 语音 / Lucy 语音 / 默认 edge-tts"三选 |

---

## FAQ

**Q: Colab 免费额度够吗？**   
A: 免费 T4 GPU 每次能跑约 4 小时。200 epoch 单角色大约 2 小时，够。多了会踢下线。

**Q: 语音质量能到什么程度？**  
A: 5 分钟素材 + 200 epoch：能听出是角色的音色和语调，但抑扬顿挫可能有点机械。10 分钟 + 500 epoch：非常接近。

**Q: 用 CPU 训练行吗？**  
A: 不行。CPU 训练 200 epoch 要几天，Colab 免费 GPU 才 2 小时。

**Q: 有 GPU 我自己训吗？**  
A: 你要有 NVIDIA GPU（≥ 4 GB VRAM），可以，跑 `Mangio-RVC-Fork` 本地版本，指令一样。

**Q: 合规风险？**  
A: 自用学习属于合理使用范围。不要公开分享合成音频。
