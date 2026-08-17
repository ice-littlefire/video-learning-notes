# 视频学习笔记工具

把 B 站视频链接整理成可阅读、可复习的 Markdown 学习笔记。它优先使用公开视频字幕；没有字幕时，可在本机用 faster-whisper 把音频转写为文字，再交给大模型归纳。

这是一个本地桌面工具：React 负责界面，Express 负责视频解析、转写和模型请求，Electron 将它们打包成 Windows 应用。

## 功能

- 输入 B 站视频链接，生成 Markdown 学习笔记。
- 提供全文总结、课堂笔记、考试复习、术语解释和时间线等笔记结构。
- 对当前视频笔记继续提问。
- 将笔记沉淀到知识库，支持搜索、编辑、导入本地 `.md` 文件。
- 以列表或可缩放的时间轴浏览知识条目。
- 内置 Markdown 阅读器，支持主题、字体、字号、行距与壁纸设置。
- 支持 DeepSeek、中转站及其他 OpenAI 兼容接口；可在软件设置中切换 API。

## 技术栈

- React + Vite + TypeScript
- Express + Node.js
- Electron + electron-builder
- OpenAI Node SDK（兼容 DeepSeek / OpenAI 兼容接口）
- yt-dlp、ffmpeg、faster-whisper（无公开字幕时的本地转写）

## 本地运行

需要先安装 Node.js 20+。若希望处理没有公开字幕的视频，还需要 Python、ffmpeg 和本地转写依赖。

```bash
git clone https://github.com/ice-littlefire/video-learning-notes.git
cd video-learning-notes
npm install
copy .env.example .env
npm run dev
```

打开 `http://127.0.0.1:5173/`。首次运行后，也可以通过软件右上角的设置按钮填写 API Key、Base URL 和模型名。

## API 配置

`.env` 只应保留在本机，绝不要提交到 GitHub。最基础的 DeepSeek 配置示例：

```env
OPENAI_API_KEY=你的_API_Key
OPENAI_MODEL=deepseek-v4-flash
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_API_MODE=chat_completions
OPENAI_TRANSCRIBE_MODE=local
```

如果使用中转站或其他兼容服务，请将 `OPENAI_BASE_URL` 改为该服务给出的 OpenAI 兼容地址，并填写它实际支持的模型名。

## 无字幕视频转写

默认的 `OPENAI_TRANSCRIBE_MODE=local` 会使用本地 faster-whisper，因此不依赖中转站是否支持 `/audio/transcriptions`。

```bash
python -m pip install --user -U yt-dlp faster-whisper
```

同时确保 `ffmpeg` 已安装并且可在终端中直接运行。转写速度和准确度取决于音频长度、电脑性能以及 `.env` 中的 Whisper 模型配置。

## 打包 Windows 便携版

```bash
npm run dist:portable
```

打包结果位于 `release/`。分发给他人时，请分发整个应用文件夹，不要只发送单独的 `.exe`；并确保该文件夹中的 `.env` 没有任何真实 API Key 或 B 站 Cookie。

## 隐私与使用说明

- `.env`、`generated/`、运行日志和构建产物均已被 Git 忽略，不会随源码上传。
- API Key 只在本机运行时使用；接收者应填写自己的 Key。
- 仅处理你有权访问和使用的视频内容，并遵守 B 站及相关服务的规则。
- 本项目与哔哩哔哩及模型服务提供商均无官方隶属关系。
