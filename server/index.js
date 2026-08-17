import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..");
const envCandidates = [
  process.env.LEARNING_CARD_ENV_PATH,
  path.join(process.cwd(), ".env"),
  path.join(projectRoot, ".env")
].filter(Boolean);
const envPath = envCandidates.find((candidate) => existsSync(candidate));
dotenv.config(envPath ? { path: envPath } : undefined);

const app = express();
const port = Number(process.env.PORT || 8787);
const bilibiliHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Referer: "https://www.bilibili.com/",
  Accept: "application/json,text/plain,*/*"
};
const bilibiliCookie = typeof process.env.BILIBILI_COOKIE === "string" ? process.env.BILIBILI_COOKIE.trim() : "";
if (bilibiliCookie) {
  bilibiliHeaders.Cookie = bilibiliCookie;
}
const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];
let cachedWbiKeys = null;
const videoNoteJobs = new Map();
const generatedRoot = process.env.LEARNING_CARD_DATA_DIR || path.join(process.cwd(), "generated");
const clientDistRoot = path.join(projectRoot, "dist");

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/generated", express.static(generatedRoot));

app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({
      code: "INVALID_JSON",
      message: "请求体不是有效的 JSON。"
    });
    return;
  }
  next(error);
});

const flashcardSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cards: {
      type: "array",
      minItems: 6,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          tags: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string" }
          },
          source: { type: "string" },
          difficulty: {
            type: "string",
            enum: ["基础", "重点", "易错", "拓展"]
          }
        },
        required: ["question", "answer", "tags", "source", "difficulty"]
      }
    }
  },
  required: ["cards"]
};

function normalizeInput(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getWritableEnvPath() {
  return envPath || path.join(projectRoot, ".env");
}

function inferApiProvider(baseUrl) {
  const normalized = normalizeInput(baseUrl).toLowerCase();
  if (normalized.includes("api.deepseek.com")) {
    return "deepseek";
  }
  if (normalized.includes("api.openai.com")) {
    return "openai";
  }
  return "custom";
}

function encodeEnvValue(value) {
  const text = String(value ?? "").replace(/\r?\n/g, "");
  if (!text || /[\s#"'=]/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function applyEnvUpdatesToText(text, updates) {
  const lines = String(text || "").split(/\r?\n/);
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !Object.hasOwn(updates, match[1])) {
      return line;
    }
    seen.add(match[1]);
    return `${match[1]}=${encodeEnvValue(updates[match[1]])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${encodeEnvValue(value)}`);
    }
  }

  return `${nextLines.join("\n").replace(/\n+$/g, "")}\n`;
}

async function saveRuntimeSettings(settings) {
  const apiKey = normalizeInput(settings.apiKey);
  const baseUrl = normalizeInput(settings.baseUrl);
  const model = normalizeInput(settings.model) || "deepseek-v4-flash";
  const apiMode = normalizeInput(settings.apiMode) === "responses" ? "responses" : "chat_completions";
  const updates = {
    OPENAI_BASE_URL: baseUrl,
    OPENAI_MODEL: model,
    OPENAI_API_MODE: apiMode
  };

  if (apiKey && !apiKey.includes("*")) {
    updates.OPENAI_API_KEY = apiKey;
  }

  const targetPath = getWritableEnvPath();
  const currentText = await readFile(targetPath, "utf8").catch(() => "");
  await writeFile(targetPath, applyEnvUpdatesToText(currentText, updates), "utf8");

  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}

function formatTimestamp(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

function extractBvid(value) {
  return normalizeInput(value).match(/BV[a-zA-Z0-9]{10}/)?.[0] || "";
}

function extractPageNumber(value) {
  try {
    const parsed = new URL(value);
    const page = Number(parsed.searchParams.get("p"));
    return Number.isInteger(page) && page > 0 ? page : 1;
  } catch {
    return 1;
  }
}

async function resolveBilibiliInput(input) {
  const raw = normalizeInput(input);
  const directBvid = extractBvid(raw);
  if (directBvid) {
    return { bvid: directBvid, pageNumber: extractPageNumber(raw), resolvedUrl: raw };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(raw);
  } catch {
    throw Object.assign(new Error("请输入有效的 B 站视频链接或 BV 号。"), {
      status: 400,
      code: "INVALID_BILIBILI_URL"
    });
  }

  const host = parsedUrl.hostname.toLowerCase();
  if (!host.endsWith("bilibili.com") && host !== "b23.tv") {
    throw Object.assign(new Error("请输入 B 站视频链接或 b23.tv 短链接。"), {
      status: 400,
      code: "INVALID_BILIBILI_URL"
    });
  }

  const response = await fetch(raw, {
    headers: bilibiliHeaders,
    redirect: "follow"
  });
  const resolvedUrl = response.url || raw;
  const bvid = extractBvid(resolvedUrl) || extractBvid(await response.text().catch(() => ""));
  if (!bvid) {
    throw Object.assign(new Error("没有从链接中识别到 B 站 BV 号。"), { status: 400, code: "INVALID_BILIBILI_URL" });
  }

  return { bvid, pageNumber: extractPageNumber(resolvedUrl), resolvedUrl };
}

async function fetchBilibiliJson(url) {
  const response = await fetch(url, { headers: bilibiliHeaders });
  if (!response.ok) {
    throw Object.assign(new Error(`B 站接口请求失败：HTTP ${response.status}`), {
      status: 502,
      code: "BILIBILI_REQUEST_FAILED"
    });
  }

  const payload = await response.json();
  if (payload.code !== 0) {
    throw Object.assign(new Error(payload.message || "B 站接口返回异常。"), {
      status: 502,
      code: "BILIBILI_API_ERROR"
    });
  }
  return payload.data;
}

function md5(value) {
  return createHash("md5").update(value).digest("hex");
}

function getFilenameKey(url) {
  return normalizeInput(url).split("/").pop()?.split(".")[0] || "";
}

function getMixinKey(imgKey, subKey) {
  const rawKey = `${imgKey}${subKey}`;
  return mixinKeyEncTab.map((index) => rawKey[index]).join("").slice(0, 32);
}

async function getWbiKeys() {
  const now = Date.now();
  if (cachedWbiKeys && cachedWbiKeys.expiresAt > now) {
    return cachedWbiKeys;
  }

  const response = await fetch("https://api.bilibili.com/x/web-interface/nav", { headers: bilibiliHeaders });
  if (!response.ok) {
    throw Object.assign(new Error(`B 站 WBI 参数请求失败：HTTP ${response.status}`), {
      status: 502,
      code: "WBI_KEY_REQUEST_FAILED"
    });
  }

  const payload = await response.json();
  const data = payload?.data || {};
  const imgKey = getFilenameKey(data?.wbi_img?.img_url);
  const subKey = getFilenameKey(data?.wbi_img?.sub_url);
  if (!imgKey || !subKey) {
    throw Object.assign(new Error("没有获取到 B 站 WBI 签名参数。"), {
      status: 502,
      code: "WBI_KEY_MISSING"
    });
  }

  cachedWbiKeys = {
    imgKey,
    subKey,
    mixinKey: getMixinKey(imgKey, subKey),
    expiresAt: now + 60 * 60 * 1000
  };
  return cachedWbiKeys;
}

async function createWbiQuery(params) {
  const keys = await getWbiKeys();
  const signedParams = {
    ...params,
    wts: Math.round(Date.now() / 1000)
  };
  const query = new URLSearchParams();

  for (const key of Object.keys(signedParams).sort()) {
    const value = String(signedParams[key]).replace(/[!'()*]/g, "");
    query.append(key, value);
  }

  const queryText = query.toString();
  query.append("w_rid", md5(`${queryText}${keys.mixinKey}`));
  return query.toString();
}

async function fetchVideoInfo(bvid) {
  const data = await fetchBilibiliJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
  );
  if (!data?.cid || !Array.isArray(data.pages)) {
    throw Object.assign(new Error("没有获取到视频分 P 信息。"), { status: 502, code: "VIDEO_INFO_MISSING" });
  }
  return data;
}

async function fetchSubtitleList(bvid, cid, aid) {
  const data = await fetchBilibiliJson(
    `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`
  );
  const subtitles = data?.subtitle?.subtitles || [];
  if (subtitles.length > 0) {
    return subtitles;
  }

  const query = await createWbiQuery(
    aid ? { aid, cid } : { bvid, cid }
  );
  const wbiData = await fetchBilibiliJson(`https://api.bilibili.com/x/player/wbi/v2?${query}`);
  return wbiData?.subtitle?.subtitles || [];
}

async function fetchSubtitleBody(subtitleUrl) {
  const normalizedUrl = subtitleUrl.startsWith("//") ? `https:${subtitleUrl}` : subtitleUrl;
  const response = await fetch(normalizedUrl, { headers: bilibiliHeaders });
  if (!response.ok) {
    throw Object.assign(new Error(`字幕请求失败：HTTP ${response.status}`), {
      status: 502,
      code: "SUBTITLE_REQUEST_FAILED"
    });
  }

  const payload = await response.json();
  const body = Array.isArray(payload.body) ? payload.body : [];
  return body
    .map((item) => ({
      from: Number(item.from) || 0,
      to: Number(item.to) || Number(item.from) || 0,
      content: normalizeInput(item.content)
    }))
    .filter((item) => item.content);
}

function selectBestSubtitle(subtitles) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) {
    return null;
  }

  const preferred =
    subtitles.find((item) => String(item.lan || "").toLowerCase().includes("zh")) ||
    subtitles.find((item) => normalizeInput(item.lan_doc).includes("中文")) ||
    subtitles[0];

  return preferred?.subtitle_url ? preferred : null;
}

function createTranscriptBlocks(segments) {
  const blocks = [];
  let current = null;

  for (const segment of segments) {
    if (!current || segment.from - current.from >= 90 || current.text.length > 900) {
      if (current) {
        blocks.push(current);
      }
      current = { from: segment.from, to: segment.to, text: segment.content };
      continue;
    }

    current.to = segment.to;
    current.text = `${current.text} ${segment.content}`;
  }

  if (current) {
    blocks.push(current);
  }

  let transcriptText = blocks
    .map((block) => `[${formatTimestamp(block.from)}-${formatTimestamp(block.to)}] ${block.text}`)
    .join("\n");
  const maxTranscriptChars = 90000;
  const truncated = transcriptText.length > maxTranscriptChars;
  if (truncated) {
    transcriptText = transcriptText.slice(0, maxTranscriptChars);
  }

  return { transcriptText, blockCount: blocks.length, truncated };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8"
      },
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutMs = options.timeoutMs || 10 * 60 * 1000;
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(
        Object.assign(new Error(`${options.label || command} 超时。`), {
          status: 504,
          code: "COMMAND_TIMEOUT"
        })
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        Object.assign(new Error(stderr || stdout || `${command} 执行失败。`), {
          status: 502,
          code: "COMMAND_FAILED"
        })
      );
    });
  });
}

async function assertYtDlpReady() {
  try {
    await runCommand("python", ["-m", "yt_dlp", "--version"], {
      timeoutMs: 15000,
      label: "yt-dlp 检查"
    });
  } catch {
    throw Object.assign(
      new Error("这个视频没有公开字幕，音频转写需要先安装 yt-dlp：python -m pip install --user -U yt-dlp"),
      {
        status: 422,
        code: "YT_DLP_MISSING"
      }
    );
  }
}

async function findDownloadedAudio(tempDir) {
  const files = await readdir(tempDir);
  const audioFile = files.find((file) => /\.(mp3|m4a|mp4|webm|wav|mpeg|mpga)$/i.test(file));
  if (!audioFile) {
    throw Object.assign(new Error("没有找到下载后的音频文件。"), {
      status: 502,
      code: "AUDIO_FILE_MISSING"
    });
  }
  return path.join(tempDir, audioFile);
}

async function downloadBilibiliAudio(sourceUrl, pageNumber) {
  await assertYtDlpReady();
  const tempDir = await mkdtemp(path.join(tmpdir(), "bilibili-notes-"));
  const outputTemplate = path.join(tempDir, "audio.%(ext)s");
  const args = [
    "-m",
    "yt_dlp",
    "--no-playlist",
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "5",
    "--max-filesize",
    process.env.BILIBILI_AUDIO_MAX_FILESIZE || "200M",
    "-o",
    outputTemplate
  ];

  if (bilibiliCookie) {
    args.push("--add-header", `Cookie:${bilibiliCookie}`);
  }
  if (pageNumber > 1) {
    args.push("--playlist-items", String(pageNumber));
  }
  args.push(sourceUrl);

  try {
    await runCommand("python", args, {
      timeoutMs: Number(process.env.BILIBILI_AUDIO_DOWNLOAD_TIMEOUT_MS || 10 * 60 * 1000),
      label: "音频下载"
    });
    return { tempDir, audioPath: await findDownloadedAudio(tempDir) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    if (error.code === "YT_DLP_MISSING") {
      throw error;
    }
    throw Object.assign(new Error(`没有公开字幕，音频下载也失败：${error.message}`), {
      status: error.status || 502,
      code: error.code || "AUDIO_DOWNLOAD_FAILED"
    });
  }
}

async function downloadBilibiliAudioFromApi(bvid, cid) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "bilibili-notes-"));
  const rawAudioPath = path.join(tempDir, "audio.m4s");
  const audioPath = path.join(tempDir, "audio.mp3");

  try {
    const data = await fetchBilibiliJson(
      `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&fnval=16&fourk=1`
    );
    const audios = Array.isArray(data?.dash?.audio) ? data.dash.audio : [];
    const selectedAudio = audios
      .map((item) => ({
        url: item.baseUrl || item.base_url || item.backupUrl?.[0] || item.backup_url?.[0],
        bandwidth: Number(item.bandwidth) || Number.MAX_SAFE_INTEGER
      }))
      .filter((item) => item.url)
      .sort((a, b) => a.bandwidth - b.bandwidth)[0];

    if (!selectedAudio) {
      throw Object.assign(new Error("B 站 playurl 没有返回音频流。"), {
        status: 502,
        code: "AUDIO_STREAM_MISSING"
      });
    }

    const response = await fetch(selectedAudio.url, {
      headers: {
        ...bilibiliHeaders,
        Accept: "*/*",
        Origin: "https://www.bilibili.com",
        Range: "bytes=0-"
      }
    });
    if (!response.ok) {
      throw Object.assign(new Error(`音频流下载失败：HTTP ${response.status}`), {
        status: 502,
        code: "AUDIO_STREAM_REQUEST_FAILED"
      });
    }

    const audioBytes = Buffer.from(await response.arrayBuffer());
    await writeFile(rawAudioPath, audioBytes);
    await runCommand(
      "ffmpeg",
      ["-y", "-i", rawAudioPath, "-vn", "-acodec", "libmp3lame", "-q:a", "5", audioPath],
      {
        timeoutMs: Number(process.env.BILIBILI_AUDIO_CONVERT_TIMEOUT_MS || 5 * 60 * 1000),
        label: "音频转换"
      }
    );

    return { tempDir, audioPath };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function normalizeTranscriptionSegments(transcription) {
  if (Array.isArray(transcription?.segments) && transcription.segments.length > 0) {
    return transcription.segments
      .map((segment) => ({
        from: Number(segment.start) || 0,
        to: Number(segment.end) || Number(segment.start) || 0,
        content: normalizeInput(segment.text)
      }))
      .filter((segment) => segment.content);
  }

  const text = normalizeInput(typeof transcription === "string" ? transcription : transcription?.text);
  return text ? [{ from: 0, to: 0, content: text }] : [];
}

function parseLocalTranscriptionOutput(stdout) {
  const text = String(stdout || "").trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace
    ? text.slice(firstBrace, lastBrace + 1)
    : text;

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw Object.assign(
      new Error(`本地 Whisper 输出格式异常，无法解析转写结果。原始输出开头：${text.slice(0, 120) || "空"}`),
      {
        status: 502,
        code: "LOCAL_TRANSCRIPTION_JSON_FAILED"
      }
    );
  }
}

async function transcribeAudioLocally(audioPath) {
  const normalizedScriptPath = fileURLToPath(new URL("./local_transcribe.py", import.meta.url));
  const model = process.env.LOCAL_WHISPER_MODEL || "base";
  const device = process.env.LOCAL_WHISPER_DEVICE || "cpu";
  const computeType = process.env.LOCAL_WHISPER_COMPUTE_TYPE || "int8";
  const language = process.env.LOCAL_WHISPER_LANGUAGE || "zh";

  try {
    const { stdout } = await runCommand(
      "python",
      [
        normalizedScriptPath,
        audioPath,
        "--model",
        model,
        "--device",
        device,
        "--compute-type",
        computeType,
        "--language",
        language
      ],
      {
        timeoutMs: Number(process.env.LOCAL_WHISPER_TIMEOUT_MS || 20 * 60 * 1000),
        label: "本地 Whisper 转写"
      }
    );
    const parsed = parseLocalTranscriptionOutput(stdout);
    const segments = Array.isArray(parsed.segments)
      ? parsed.segments
          .map((segment) => ({
            from: Number(segment.from) || 0,
            to: Number(segment.to) || Number(segment.from) || 0,
            content: normalizeInput(segment.content)
          }))
          .filter((segment) => segment.content)
      : [];

    if (segments.length === 0) {
      throw Object.assign(new Error("本地 Whisper 没有转写出文本。"), {
        status: 502,
        code: "EMPTY_LOCAL_TRANSCRIPTION"
      });
    }

    return {
      segments,
      transcriptionModel: `local-faster-whisper:${model}`
    };
  } catch (error) {
    if (error.code === "COMMAND_FAILED" || error.code === "COMMAND_TIMEOUT") {
      throw Object.assign(
        new Error(
          `远程音频转写失败，本地 Whisper 也失败：${error.message}。请确认已安装 faster-whisper：python -m pip install --user -U faster-whisper`
        ),
        {
          status: error.status || 502,
          code: "LOCAL_TRANSCRIPTION_FAILED"
        }
      );
    }
    throw error;
  }
}

async function transcribeAudio(openai, audioPath) {
  const transcriptionMode = normalizeInput(process.env.OPENAI_TRANSCRIBE_MODE) || "auto";
  if (transcriptionMode === "local") {
    return transcribeAudioLocally(audioPath);
  }

  const transcriptionModel = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
  let transcription;
  try {
    transcription = await openai.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: transcriptionModel,
      response_format: "verbose_json"
    });
  } catch (error) {
    if (transcriptionMode === "remote") {
      throw Object.assign(
        new Error(
          `没有公开字幕，音频已提取，但音频转写接口失败：${error.message || "未知错误"}。请确认 OPENAI_TRANSCRIBE_BASE_URL 或 OPENAI_BASE_URL 支持 /audio/transcriptions。`
        ),
        {
          status: 502,
          code: "AUDIO_TRANSCRIPTION_FAILED"
        }
      );
    }
    return transcribeAudioLocally(audioPath);
  }
  const segments = normalizeTranscriptionSegments(transcription);

  if (segments.length === 0) {
    throw Object.assign(new Error("音频转写没有返回文本。"), {
      status: 502,
      code: "EMPTY_TRANSCRIPTION"
    });
  }

  return {
    segments,
    transcriptionModel
  };
}

async function transcribeBilibiliAudio(sourceUrl, openai) {
  const { bvid, pageNumber, resolvedUrl } = await resolveBilibiliInput(sourceUrl);
  const info = await fetchVideoInfo(bvid);
  const pages = info.pages || [];
  const selectedPage = pages[Math.min(Math.max(pageNumber, 1), pages.length) - 1] || pages[0];
  const audioUrl = resolvedUrl.startsWith("http")
    ? resolvedUrl
    : `https://www.bilibili.com/video/${bvid}${pageNumber > 1 ? `?p=${pageNumber}` : ""}`;
  let download;

  try {
    download = await downloadBilibiliAudioFromApi(bvid, selectedPage.cid || info.cid);
  } catch {
    download = await downloadBilibiliAudio(audioUrl, selectedPage.page || pageNumber);
  }

  try {
    const { segments, transcriptionModel } = await transcribeAudio(openai, download.audioPath);
    return {
      title: info.title || bvid,
      owner: info.owner?.name || "",
      description: info.desc || "",
      bvid,
      cid: selectedPage.cid || info.cid,
      pageTitle: selectedPage.part || "",
      pageNumber: selectedPage.page || pageNumber,
      sourceUrl: resolvedUrl,
      subtitleLabel: `音频转写：${transcriptionModel}`,
      segments
    };
  } finally {
    await rm(download.tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractBilibiliTranscript(sourceUrl) {
  const { bvid, pageNumber, resolvedUrl } = await resolveBilibiliInput(sourceUrl);
  const info = await fetchVideoInfo(bvid);
  const pages = info.pages || [];
  const selectedPage = pages[Math.min(Math.max(pageNumber, 1), pages.length) - 1] || pages[0];
  const cid = selectedPage.cid || info.cid;
  const subtitles = await fetchSubtitleList(bvid, cid, info.aid);
  const subtitle = selectBestSubtitle(subtitles);

  if (!subtitle) {
    throw Object.assign(new Error("这个视频没有公开字幕，暂时无法仅凭链接自动生成笔记。"), {
      status: 422,
      code: "NO_PUBLIC_SUBTITLE"
    });
  }

  const segments = await fetchSubtitleBody(subtitle.subtitle_url);
  if (segments.length === 0) {
    throw Object.assign(new Error("字幕内容为空，无法生成笔记。"), {
      status: 422,
      code: "EMPTY_SUBTITLE"
    });
  }

  return {
    title: info.title || bvid,
    owner: info.owner?.name || "",
    description: info.desc || "",
    bvid,
    cid,
    pageTitle: selectedPage.part || "",
    pageNumber: selectedPage.page || pageNumber,
    sourceUrl: resolvedUrl,
    subtitleLabel: subtitle.lan_doc || subtitle.lan || "字幕",
    segments
  };
}

function extractJsonText(response) {
  if (response.output_text) {
    return response.output_text;
  }

  const textFragments = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        textFragments.push(content.text);
      }
    }
  }
  return textFragments.join("\n");
}

function extractChatJsonText(response) {
  return response.choices?.[0]?.message?.content || "";
}

function extractResponseText(response) {
  return extractJsonText(response);
}

function extractChatText(response) {
  return response.choices?.[0]?.message?.content || "";
}

function stripMarkdownFence(value) {
  const text = normalizeInput(value);
  const match = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return normalizeInput(match ? match[1] : text);
}

function normalizeVideoMarkdown(value, title) {
  let text = stripMarkdownFence(value);
  const firstHeadingIndex = text.search(/^#\s+/m);
  if (firstHeadingIndex > 0) {
    text = text.slice(firstHeadingIndex);
  }
  text = text.replace(/^#\s*视频标题[：:]\s*/m, "# ");
  if (!/^#\s+/.test(text)) {
    text = `# ${title}\n\n${text}`;
  }
  return normalizeInput(text);
}

const videoNoteStylePrompts = {
  summary: [
    "请把下面的视频文本整理成一份类似 BiliGPT「全文总结」风格的 Markdown 学习笔记。",
    "输出必须严格遵守：",
    "1. 第一行必须是一级标题：# 视频标题。不要在标题前输出任何寒暄、解释或导语。",
    "2. 先写「## 摘要」：用 1 个自然段概括整节课，约 120-220 个中文字符，强调主题、学习路径和核心认知。",
    "3. 再写「## 亮点」：给 5-7 条要点，每条以一个贴切 emoji 开头，语言要像学习摘要，不要像逐字稿。",
    "4. 再写一行标签：3-6 个中文标签，格式如 #互联网原理 #DNS #HTTP。",
    "5. 再写「## 思考」：给 2-4 个高价值问答。问题要能帮助复习或排查实际问题；回答要综合视频内容，不要凭空添加视频没讲的细节。",
    "6. 再写「## 术语解释」：提取 4-8 个关键术语，用「术语: 解释」格式，解释要准确、简洁、适合初学者。",
    "7. 最后写「## 时间线」：只列 5-10 条关键时间段，格式为「- [00:00-01:30] 主题」。时间戳必须来自文本块。",
    "8. 不要写逐段详细笔记，不要输出代码围栏，不要编造视频文本里没有的信息。",
    "9. 如果音频转写有明显噪声，可以在摘要后的括号里轻微说明「基于音频转写整理」，但不要反复强调。"
  ],
  classNotes: [
    "请把下面的视频文本整理成适合课后复习的 Markdown 课堂笔记。",
    "输出必须严格遵守：",
    "1. 第一行必须是一级标题：# 视频标题。不要在标题前输出任何寒暄、解释或导语。",
    "2. 写「## 本节目标」：用 3-5 条说明看完本节应该掌握什么。",
    "3. 写「## 核心概念」：按概念分组解释，不要只罗列名词。",
    "4. 写「## 详细笔记」：按主题展开，保留关键步骤、例子、因果关系和老师强调的注意点。",
    "5. 写「## 易错点」：列出 3-6 条容易误解的地方。",
    "6. 写「## 复习问题」：给 5-8 个问题，覆盖本节主要知识点。",
    "7. 写「## 时间线」：列 8-14 条关键时间段，格式为「- [00:00-01:30] 主题」。",
    "8. 内容要比全文总结更详细，但不要逐字转录，不要编造视频文本里没有的信息。"
  ],
  exam: [
    "请把下面的视频文本整理成考试/测验复习版 Markdown 笔记。",
    "输出必须严格遵守：",
    "1. 第一行必须是一级标题：# 视频标题。不要在标题前输出任何寒暄、解释或导语。",
    "2. 写「## 必背结论」：列 6-10 条最可能考到的结论。",
    "3. 写「## 高频考点」：按考点解释，每个考点包含「要点」「容易混淆」「一句话记忆」。",
    "4. 写「## 选择/简答题」：生成 6-10 道复习题，并给出简短答案。",
    "5. 写「## 术语速记」：提取 5-10 个术语，用「术语: 解释」格式。",
    "6. 写「## 考前检查清单」：列出可以自测的掌握项。",
    "7. 不要编造视频文本里没有的信息；如果题目依据不足，就用视频中明确讲到的内容出题。"
  ],
  glossary: [
    "请把下面的视频文本整理成术语解释/概念卡片版 Markdown。",
    "输出必须严格遵守：",
    "1. 第一行必须是一级标题：# 视频标题。不要在标题前输出任何寒暄、解释或导语。",
    "2. 写「## 摘要」：用 80-160 个中文字符概括视频主题。",
    "3. 写「## 术语解释」：提取 8-15 个术语，每个术语用三级标题。",
    "4. 每个术语包含「一句话解释」「它解决什么问题」「和其他概念的关系」「视频中的例子/语境」。",
    "5. 写「## 概念关系」：用项目符号说明关键术语之间的连接。",
    "6. 写「## 复习卡片」：给 6-10 组 Q/A。",
    "7. 不要编造视频文本里没有的信息。"
  ],
  timeline: [
    "请把下面的视频文本整理成时间线导向的 Markdown 笔记。",
    "输出必须严格遵守：",
    "1. 第一行必须是一级标题：# 视频标题。不要在标题前输出任何寒暄、解释或导语。",
    "2. 写「## 摘要」：用一小段概括视频。",
    "3. 写「## 时间线笔记」：按时间顺序列 10-20 个片段，格式为「### [00:00-01:30] 主题」。",
    "4. 每个时间片段下写 2-4 条要点，说明这个片段讲了什么、为什么重要。",
    "5. 写「## 全局总结」：把视频主线再压缩成 5-8 条。",
    "6. 写「## 后续复习」：给 3-6 个复习动作。",
    "7. 时间戳必须来自文本块，不要编造视频文本里没有的信息。"
  ]
};

function normalizeVideoNoteStyle(value) {
  const style = normalizeInput(value);
  return Object.hasOwn(videoNoteStylePrompts, style) ? style : "summary";
}

function createOpenAIClient() {
  const options = { apiKey: process.env.OPENAI_API_KEY };
  const baseURL = normalizeInput(process.env.OPENAI_BASE_URL);
  if (baseURL) {
    options.baseURL = baseURL;
  }
  return new OpenAI(options);
}

function createTranscriptionOpenAIClient() {
  const options = {
    apiKey: normalizeInput(process.env.OPENAI_TRANSCRIBE_API_KEY) || process.env.OPENAI_API_KEY
  };
  const baseURL = normalizeInput(process.env.OPENAI_TRANSCRIBE_BASE_URL) || normalizeInput(process.env.OPENAI_BASE_URL);
  if (baseURL) {
    options.baseURL = baseURL;
  }
  return new OpenAI(options);
}

async function generateMarkdownWithResponses(openai, model, prompt) {
  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "你是一位中文学习笔记整理助手。你会基于视频字幕生成结构清晰、适合复习的 Markdown 笔记。必须忠实于字幕内容，不编造字幕里没有的信息。"
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  return stripMarkdownFence(extractResponseText(response));
}

async function generateMarkdownWithChatCompletions(openai, model, prompt) {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "你是一位中文学习笔记整理助手。你会基于视频字幕生成结构清晰、适合复习的 Markdown 笔记。必须忠实于字幕内容，不编造字幕里没有的信息。"
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  return stripMarkdownFence(extractChatText(response));
}

async function answerVideoQuestionWithResponses(openai, model, prompt) {
  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "你是一位中文视频学习助教。你只基于用户提供的视频笔记回答问题；如果笔记中没有依据，要明确说明不能从当前笔记确认。回答要清楚、实用、适合复习。"
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  return stripMarkdownFence(extractResponseText(response));
}

async function answerVideoQuestionWithChatCompletions(openai, model, prompt) {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "你是一位中文视频学习助教。你只基于用户提供的视频笔记回答问题；如果笔记中没有依据，要明确说明不能从当前笔记确认。回答要清楚、实用、适合复习。"
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  return stripMarkdownFence(extractChatText(response));
}

async function answerVideoQuestion(videoNotes, question) {
  const openai = createOpenAIClient();
  const model = process.env.OPENAI_MODEL || "deepseek-v4-flash";
  const apiMode = normalizeInput(process.env.OPENAI_API_MODE) || "chat_completions";
  const markdown = normalizeInput(videoNotes?.markdown).slice(0, 90000);
  const prompt = [
    `视频标题：${normalizeInput(videoNotes?.title) || "未提供"}`,
    `来源链接：${normalizeInput(videoNotes?.sourceUrl) || "未提供"}`,
    `BV 号：${normalizeInput(videoNotes?.bvid) || "未提供"}`,
    `问题：${question}`,
    "",
    "回答要求：",
    "1. 只依据下面的视频 Markdown 笔记回答，不要编造笔记中没有的信息。",
    "2. 如果用户问解释概念，请用通俗语言解释，并指出它在本视频中的语境。",
    "3. 如果用户问复习/考试，请可以生成题目、清单或对比表，但依据必须来自笔记。",
    "4. 如果能引用时间线，请保留笔记中已有的时间戳。",
    "5. 输出 Markdown，不要寒暄。",
    "",
    "视频 Markdown 笔记：",
    markdown
  ].join("\n");

  return apiMode === "chat_completions"
    ? answerVideoQuestionWithChatCompletions(openai, model, prompt)
    : answerVideoQuestionWithResponses(openai, model, prompt);
}

function normalizeFlashcards(payload) {
  const rawCards = Array.isArray(payload?.cards) ? payload.cards : [];
  return rawCards
    .map((card) => ({
      question: normalizeInput(card?.question),
      answer: normalizeInput(card?.answer),
      tags: Array.isArray(card?.tags)
        ? card.tags.map(normalizeInput).filter(Boolean).slice(0, 5)
        : [],
      source: normalizeInput(card?.source),
      difficulty: ["基础", "重点", "易错", "拓展"].includes(card?.difficulty) ? card.difficulty : "重点"
    }))
    .filter((card) => card.question && card.answer)
    .slice(0, 20);
}

async function generateFlashcardsWithResponses(openai, model, prompt) {
  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "你是一位中文学习卡片制作助手。你会基于视频笔记生成适合 Anki 复习的问答卡片。必须忠实于笔记内容，不编造笔记里没有的信息。"
      },
      {
        role: "user",
        content: prompt
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "video_flashcards",
        strict: true,
        schema: flashcardSchema
      }
    }
  });

  return JSON.parse(extractJsonText(response));
}

async function generateFlashcardsWithChatCompletions(openai, model, prompt) {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "你是一位中文学习卡片制作助手。你会基于视频笔记生成适合 Anki 复习的问答卡片。必须忠实于笔记内容，不编造笔记里没有的信息。必须只返回符合 JSON Schema 的 JSON。"
      },
      {
        role: "user",
        content: prompt
      }
    ],
    response_format: {
      type: "json_object"
    }
  });

  return JSON.parse(extractChatJsonText(response));
}

async function generateVideoFlashcards(videoNotes, count) {
  const openai = createOpenAIClient();
  const model = process.env.OPENAI_MODEL || "deepseek-v4-flash";
  const apiMode = normalizeInput(process.env.OPENAI_API_MODE) || "chat_completions";
  const markdown = normalizeInput(videoNotes?.markdown).slice(0, 90000);
  const safeCount = Math.min(20, Math.max(6, Number(count) || 12));
  const prompt = [
    `视频标题：${normalizeInput(videoNotes?.title) || "未提供"}`,
    `来源链接：${normalizeInput(videoNotes?.sourceUrl) || "未提供"}`,
    `BV 号：${normalizeInput(videoNotes?.bvid) || "未提供"}`,
    `目标卡片数量：${safeCount}`,
    "",
    "请基于下面的视频 Markdown 笔记生成 Anki 风格复习卡片。",
    "要求：",
    "1. 每张卡片只问一个清晰问题，答案要短而完整，适合主动回忆。",
    "2. 覆盖核心概念、关键流程、术语解释、易错点和实际应用。",
    "3. 不要生成太空泛的问题，比如「本节讲了什么」。",
    "4. 如果笔记里有时间戳，可以在 source 字段写入对应时间戳或小节名；没有就写视频标题。",
    "5. tags 用 1-5 个中文短标签，不要带 #。",
    "6. difficulty 只能是「基础」「重点」「易错」「拓展」。",
    "7. 只能依据笔记内容，不要编造额外知识。",
    "",
    "视频 Markdown 笔记：",
    markdown
  ].join("\n");

  const payload =
    apiMode === "chat_completions"
      ? await generateFlashcardsWithChatCompletions(openai, model, prompt)
      : await generateFlashcardsWithResponses(openai, model, prompt);
  const cards = normalizeFlashcards(payload);

  if (cards.length === 0) {
    throw Object.assign(new Error("模型没有返回可用复习卡片，请稍后重试。"), {
      status: 502,
      code: "EMPTY_FLASHCARDS"
    });
  }

  return { cards };
}

async function buildVideoNotes(sourceUrl, options = {}, onProgress = () => undefined) {
  const openai = createOpenAIClient();
  const transcriptionOpenai = createTranscriptionOpenAIClient();
  const model = process.env.OPENAI_MODEL || "deepseek-v4-flash";
  const apiMode = normalizeInput(process.env.OPENAI_API_MODE) || "chat_completions";
  const noteStyle = normalizeVideoNoteStyle(options.noteStyle);
  let video;

  onProgress({ stage: "解析链接", message: "正在解析 B 站链接并读取视频信息...", progress: 12 });

  try {
    onProgress({ stage: "读取字幕", message: "正在检查视频是否有可用字幕...", progress: 24 });
    video = await extractBilibiliTranscript(sourceUrl);
    onProgress({ stage: "字幕就绪", message: "已获取字幕，正在整理文本...", progress: 58 });
  } catch (error) {
    if (error.code !== "NO_PUBLIC_SUBTITLE" && error.code !== "EMPTY_SUBTITLE") {
      throw error;
    }
    onProgress({ stage: "音频转写", message: "没有可用字幕，正在提取音频并进行本地转写...", progress: 35 });
    video = await transcribeBilibiliAudio(sourceUrl, transcriptionOpenai);
    onProgress({ stage: "转写完成", message: "音频转写完成，正在整理文本...", progress: 72 });
  }

  const { transcriptText, blockCount, truncated } = createTranscriptBlocks(video.segments);
  const prompt = [
    `视频标题：${video.title}`,
    `UP 主：${video.owner || "未知"}`,
    `分 P：${video.pageTitle || video.pageNumber || "默认"}`,
    `来源链接：${video.sourceUrl}`,
    `文本来源：${video.subtitleLabel}`,
    truncated ? "注意：文本较长，以下内容已按长度上限截断，请在笔记中标注「基于前半段内容」。" : "",
    "",
    ...videoNoteStylePrompts[noteStyle],
    "",
    "视频文本：",
    transcriptText
  ].filter(Boolean).join("\n");

  onProgress({ stage: "生成笔记", message: "正在调用大模型生成 Markdown 笔记...", progress: 84 });
  const rawMarkdown =
    apiMode === "chat_completions"
      ? await generateMarkdownWithChatCompletions(openai, model, prompt)
      : await generateMarkdownWithResponses(openai, model, prompt);
  const markdown = normalizeVideoMarkdown(rawMarkdown, video.title);

  if (!markdown) {
    throw Object.assign(new Error("模型没有返回笔记内容，请稍后重试。"), {
      status: 502,
      code: "EMPTY_MODEL_OUTPUT"
    });
  }

  onProgress({ stage: "完成", message: "Markdown 笔记已生成。", progress: 100 });

  return {
    title: video.title,
    sourceUrl: video.sourceUrl,
    bvid: video.bvid,
    cid: video.cid,
    pageTitle: video.pageTitle,
    subtitleLabel: video.subtitleLabel,
    segmentCount: video.segments.length,
    blockCount,
    truncated,
    noteStyle,
    markdown
  };
}

function serializeVideoNoteJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    message: job.message,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    result: job.result || null,
    error: job.error || null
  };
}

function updateVideoNoteJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

const knowledgeFilePath = path.join(generatedRoot, "knowledge.json");

async function readKnowledgeEntries() {
  try {
    const parsed = JSON.parse(await readFile(knowledgeFilePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeKnowledgeEntries(entries) {
  await mkdir(path.dirname(knowledgeFilePath), { recursive: true });
  await writeFile(knowledgeFilePath, JSON.stringify(entries, null, 2), "utf8");
}

function normalizeKnowledgeEntry(payload, id = randomUUID()) {
  const now = new Date().toISOString();
  const concepts = Array.isArray(payload?.concepts)
    ? payload.concepts
        .map((concept) => ({
          name: normalizeInput(concept?.name),
          explanation: normalizeInput(concept?.explanation)
        }))
        .filter((concept) => concept.name)
        .slice(0, 20)
    : [];
  return {
    id: normalizeInput(payload?.id) || id,
    title: normalizeInput(payload?.title) || "未命名知识条目",
    summary: normalizeInput(payload?.summary) || normalizeInput(payload?.title) || "暂无摘要",
    tags: Array.isArray(payload?.tags) ? payload.tags.map(normalizeInput).filter(Boolean).slice(0, 12) : [],
    concepts,
    markdown: normalizeInput(payload?.markdown) || "",
    sourceUrl: normalizeInput(payload?.sourceUrl),
    bvid: normalizeInput(payload?.bvid),
    sourceTitle: normalizeInput(payload?.sourceTitle),
    noteStyle: normalizeVideoNoteStyle(payload?.noteStyle),
    createdAt: normalizeInput(payload?.createdAt) || now,
    updatedAt: now
  };
}

function serializeKnowledgeEntry(entry) {
  return { ...entry };
}

function parseKnowledgeJson(value) {
  const text = stripMarkdownFence(value);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function refineKnowledgeWithResponses(openai, model, prompt) {
  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "你是一位中文知识库整理助手。你会把视频笔记提炼成可长期沉淀的结构化知识，必须忠实于笔记内容，不编造信息。必须只返回一个合法 JSON 对象。"
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });
  return parseKnowledgeJson(extractResponseText(response));
}

async function refineKnowledgeWithChatCompletions(openai, model, prompt) {
  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是一位中文知识库整理助手。你会把视频笔记提炼成可长期沉淀的结构化知识，必须忠实于笔记内容，不编造信息。必须只返回一个合法 JSON 对象，不要输出 Markdown 代码块。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" }
    });
    const payload = parseKnowledgeJson(extractChatJsonText(response));
    if (payload) {
      return payload;
    }
  } catch {
    // 部分中转站不支持 response_format，退回普通文本解析。
  }
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "你是一位中文知识库整理助手。你会把视频笔记提炼成可长期沉淀的结构化知识，必须忠实于笔记内容，不编造信息。必须只返回一个合法 JSON 对象，不要输出 Markdown 代码块。"
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });
  return parseKnowledgeJson(extractChatJsonText(response));
}

async function refineKnowledgeEntry(markdown, context = {}) {
  const openai = createOpenAIClient();
  const model = process.env.OPENAI_MODEL || "deepseek-v4-flash";
  const apiMode = normalizeInput(process.env.OPENAI_API_MODE) || "chat_completions";
  const prompt = [
    `来源视频标题：${normalizeInput(context.sourceTitle) || "未提供"}`,
    `来源链接：${normalizeInput(context.sourceUrl) || "未提供"}`,
    `BV 号：${normalizeInput(context.bvid) || "未提供"}`,
    "",
    "请把下面的视频笔记提炼成一条知识库条目，输出 JSON，字段如下：",
    "{",
    '  "title": "简短、可检索的主题标题",',
    '  "summary": "150-300 字的完整总结，把零散笔记归纳成可独立理解的知识",',
    '  "tags": ["3-6 个标签"],',
    '  "concepts": [{"name": "概念名", "explanation": "一句话解释"}],',
    '  "markdown": "重新整理后的 Markdown 知识文档，用 ## 分节，适合直接阅读"',
    "}",
    "",
    "要求：",
    "1. 只能依据视频笔记内容，不补充笔记里没有的信息。",
    "2. summary 要归纳知识点之间的联系，而不是复述笔记目录。",
    "3. concepts 覆盖核心概念，每条解释清晰、独立可读。",
    "4. markdown 保留关键流程、结论、例子和复习问题，去掉寒暄。",
    "",
    "视频笔记：",
    normalizeInput(markdown).slice(0, 90000)
  ].join("\n");
  const payload = apiMode === "chat_completions"
    ? await refineKnowledgeWithChatCompletions(openai, model, prompt)
    : await refineKnowledgeWithResponses(openai, model, prompt);

  if (!payload) {
    throw Object.assign(new Error("模型没有返回可解析的知识库 JSON，请检查 API 配置后重试。"), {
      status: 502,
      code: "KNOWLEDGE_REFINE_JSON_FAILED"
    });
  }

  return normalizeKnowledgeEntry({
    ...payload,
    title: payload.title || context.sourceTitle,
    markdown: payload.markdown || markdown,
    sourceUrl: context.sourceUrl,
    bvid: context.bvid,
    sourceTitle: context.sourceTitle,
    noteStyle: context.noteStyle
  });
}
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/settings", (_req, res) => {
  const baseUrl = normalizeInput(process.env.OPENAI_BASE_URL);
  res.json({
    provider: inferApiProvider(baseUrl),
    apiKeySet: Boolean(normalizeInput(process.env.OPENAI_API_KEY)),
    baseUrl,
    model: process.env.OPENAI_MODEL || "deepseek-v4-flash",
    apiMode: normalizeInput(process.env.OPENAI_API_MODE) || "chat_completions",
    envPath: getWritableEnvPath()
  });
});

app.post("/api/settings", async (req, res) => {
  const provider = normalizeInput(req.body?.provider);
  const presetBaseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "";
  const presetModel = provider === "deepseek" ? "deepseek-v4-flash" : "";
  const baseUrl = normalizeInput(req.body?.baseUrl) || presetBaseUrl;
  const model = normalizeInput(req.body?.model) || presetModel || "deepseek-v4-flash";
  const apiMode = normalizeInput(req.body?.apiMode) === "responses" ? "responses" : "chat_completions";

  try {
    await saveRuntimeSettings({
      apiKey: req.body?.apiKey,
      baseUrl,
      model,
      apiMode
    });

    res.json({
      provider: inferApiProvider(baseUrl),
      apiKeySet: Boolean(normalizeInput(process.env.OPENAI_API_KEY)),
      baseUrl,
      model,
      apiMode,
      envPath: getWritableEnvPath()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: "SETTINGS_SAVE_FAILED",
      message: "API 设置保存失败，请检查软件目录是否有写入权限。"
    });
  }
});

app.post("/api/video-notes/generate", async (req, res) => {
  const sourceUrl = normalizeInput(req.body?.sourceUrl);
  const noteStyle = normalizeVideoNoteStyle(req.body?.noteStyle);

  if (!sourceUrl) {
    res.status(400).json({
      code: "EMPTY_URL",
      message: "请输入 B 站视频链接。"
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      code: "MISSING_API_KEY",
      message: "缺少 OPENAI_API_KEY。请复制 .env.example 为 .env 并填入你的 DeepSeek API Key。"
    });
    return;
  }

  try {
    res.json(await buildVideoNotes(sourceUrl, { noteStyle }));
  } catch (error) {
    console.error(error);
    const status = error.status || 502;
    res.status(status).json({
      code: error.code || "VIDEO_NOTES_FAILED",
      message: error.message || "视频笔记生成失败，请检查链接、字幕或网络连接。"
    });
  }
});

app.post("/api/video-notes/jobs", (req, res) => {
  const sourceUrl = normalizeInput(req.body?.sourceUrl);
  const noteStyle = normalizeVideoNoteStyle(req.body?.noteStyle);

  if (!sourceUrl) {
    res.status(400).json({
      code: "EMPTY_URL",
      message: "请输入 B 站视频链接。"
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      code: "MISSING_API_KEY",
      message: "缺少 OPENAI_API_KEY。请复制 .env.example 为 .env 并填入你的 DeepSeek API Key。"
    });
    return;
  }

  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    status: "queued",
    stage: "排队中",
    message: "任务已创建，准备开始生成视频笔记...",
    progress: 3,
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null
  };
  videoNoteJobs.set(job.id, job);

  setTimeout(async () => {
    try {
      updateVideoNoteJob(job, {
        status: "running",
        stage: "启动任务",
        message: "正在启动视频笔记任务...",
        progress: 6
      });
      const result = await buildVideoNotes(sourceUrl, { noteStyle }, (progress) => {
        updateVideoNoteJob(job, {
          status: "running",
          stage: progress.stage,
          message: progress.message,
          progress: progress.progress
        });
      });
      updateVideoNoteJob(job, {
        status: "completed",
        stage: "完成",
        message: result.truncated ? "Markdown 笔记已生成；文本较长，已基于前半段生成。" : "Markdown 笔记已生成。",
        progress: 100,
        result
      });
    } catch (error) {
      console.error(error);
      updateVideoNoteJob(job, {
        status: "failed",
        stage: "生成失败",
        message: error.message || "视频笔记生成失败，请检查链接、字幕或网络连接。",
        progress: Math.max(Number(job.progress) || 0, 5),
        error: {
          code: error.code || "VIDEO_NOTES_FAILED",
          message: error.message || "视频笔记生成失败，请检查链接、字幕或网络连接。"
        }
      });
    }
  }, 0);

  res.status(202).json(serializeVideoNoteJob(job));
});

app.post("/api/video-notes/ask", async (req, res) => {
  const question = normalizeInput(req.body?.question);
  const videoNotes = req.body?.videoNotes;

  if (!question) {
    res.status(400).json({
      code: "EMPTY_QUESTION",
      message: "请输入想问的问题。"
    });
    return;
  }

  if (!normalizeInput(videoNotes?.markdown)) {
    res.status(400).json({
      code: "EMPTY_VIDEO_NOTES",
      message: "请先生成或载入一份视频笔记，再提问。"
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      code: "MISSING_API_KEY",
      message: "缺少 OPENAI_API_KEY。请复制 .env.example 为 .env 并填入你的 DeepSeek API Key。"
    });
    return;
  }

  try {
    res.json({ answer: await answerVideoQuestion(videoNotes, question) });
  } catch (error) {
    console.error(error);
    res.status(502).json({
      code: error.code || "VIDEO_QUESTION_FAILED",
      message: error.message || "视频问答失败，请检查 API Key、Base URL、模型名称或网络连接。"
    });
  }
});

app.post("/api/video-notes/flashcards", async (req, res) => {
  const videoNotes = req.body?.videoNotes;
  const count = Number(req.body?.count) || 12;

  if (!normalizeInput(videoNotes?.markdown)) {
    res.status(400).json({
      code: "EMPTY_VIDEO_NOTES",
      message: "请先生成或载入一份视频笔记，再生成复习卡片。"
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      code: "MISSING_API_KEY",
      message: "缺少 OPENAI_API_KEY。请复制 .env.example 为 .env 并填入你的 DeepSeek API Key。"
    });
    return;
  }

  try {
    res.json(await generateVideoFlashcards(videoNotes, count));
  } catch (error) {
    console.error(error);
    res.status(error.status || 502).json({
      code: error.code || "FLASHCARDS_FAILED",
      message: error.message || "复习卡片生成失败，请检查 API Key、Base URL、模型名称或网络连接。"
    });
  }
});

app.get("/api/video-notes/jobs/:id", (req, res) => {
  const job = videoNoteJobs.get(req.params.id);

  if (!job) {
    res.status(404).json({
      code: "JOB_NOT_FOUND",
      message: "没有找到这个视频笔记任务。"
    });
    return;
  }

  res.json(serializeVideoNoteJob(job));
});

app.get("/api/knowledge", async (_req, res) => {
  try {
    const entries = await readKnowledgeEntries();
    res.json({
      items: entries.map(({ markdown, ...meta }) => meta)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: "KNOWLEDGE_READ_FAILED",
      message: "知识库读取失败，请检查数据目录权限。"
    });
  }
});

app.get("/api/knowledge/:id", async (req, res) => {
  try {
    const entries = await readKnowledgeEntries();
    const entry = entries.find((item) => item.id === req.params.id);
    if (!entry) {
      res.status(404).json({
        code: "KNOWLEDGE_NOT_FOUND",
        message: "没有找到这条知识。"
      });
      return;
    }
    res.json(serializeKnowledgeEntry(entry));
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: "KNOWLEDGE_READ_FAILED",
      message: "知识库读取失败，请检查数据目录权限。"
    });
  }
});

app.post("/api/knowledge", async (req, res) => {
  const entry = normalizeKnowledgeEntry(req.body);
  if (!entry.markdown) {
    res.status(400).json({
      code: "EMPTY_KNOWLEDGE_MARKDOWN",
      message: "知识内容不能为空。"
    });
    return;
  }
  try {
    const entries = await readKnowledgeEntries();
    entries.unshift(entry);
    await writeKnowledgeEntries(entries);
    res.status(201).json(serializeKnowledgeEntry(entry));
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: "KNOWLEDGE_SAVE_FAILED",
      message: "知识库保存失败，请检查数据目录权限。"
    });
  }
});

app.put("/api/knowledge/:id", async (req, res) => {
  try {
    const entries = await readKnowledgeEntries();
    const index = entries.findIndex((item) => item.id === req.params.id);
    if (index < 0) {
      res.status(404).json({
        code: "KNOWLEDGE_NOT_FOUND",
        message: "没有找到这条知识。"
      });
      return;
    }
    const nextEntry = normalizeKnowledgeEntry(
      {
        ...entries[index],
        ...req.body,
        createdAt: entries[index].createdAt
      },
      entries[index].id
    );
    if (!nextEntry.markdown) {
      res.status(400).json({
        code: "EMPTY_KNOWLEDGE_MARKDOWN",
        message: "知识内容不能为空。"
      });
      return;
    }
    entries[index] = nextEntry;
    await writeKnowledgeEntries(entries);
    res.json(serializeKnowledgeEntry(nextEntry));
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: "KNOWLEDGE_SAVE_FAILED",
      message: "知识库保存失败，请检查数据目录权限。"
    });
  }
});

app.delete("/api/knowledge/:id", async (req, res) => {
  try {
    const entries = await readKnowledgeEntries();
    const next = entries.filter((item) => item.id !== req.params.id);
    if (next.length === entries.length) {
      res.status(404).json({
        code: "KNOWLEDGE_NOT_FOUND",
        message: "没有找到这条知识。"
      });
      return;
    }
    await writeKnowledgeEntries(next);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: "KNOWLEDGE_DELETE_FAILED",
      message: "知识库删除失败，请检查数据目录权限。"
    });
  }
});

app.post("/api/knowledge/refine", async (req, res) => {
  const markdown = normalizeInput(req.body?.markdown);
  if (!markdown) {
    res.status(400).json({
      code: "EMPTY_VIDEO_NOTES",
      message: "请先生成或载入一份视频笔记，再提炼知识。"
    });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      code: "MISSING_API_KEY",
      message: "缺少 OPENAI_API_KEY。请复制 .env.example 为 .env 并填入你的 DeepSeek API Key。"
    });
    return;
  }
  try {
    const entry = await refineKnowledgeEntry(markdown, {
      sourceUrl: req.body?.sourceUrl,
      bvid: req.body?.bvid,
      sourceTitle: req.body?.sourceTitle,
      noteStyle: req.body?.noteStyle
    });
    const entries = await readKnowledgeEntries();
    entries.unshift(entry);
    await writeKnowledgeEntries(entries);
    res.status(201).json(serializeKnowledgeEntry(entry));
  } catch (error) {
    console.error(error);
    res.status(error.status || 502).json({
      code: error.code || "KNOWLEDGE_REFINE_FAILED",
      message: error.message || "知识提炼失败，请检查 API Key、Base URL、模型名称或网络连接。"
    });
  }
});
if (existsSync(clientDistRoot)) {
  app.use(express.static(clientDistRoot));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/generated")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDistRoot, "index.html"));
  });
}

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Learning card server listening on http://127.0.0.1:${port}`);
});

export { app, server };
