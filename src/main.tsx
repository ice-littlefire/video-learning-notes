import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";
import * as Label from "@radix-ui/react-label";
import * as Progress from "@radix-ui/react-progress";
import * as Select from "@radix-ui/react-select";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import lightNovelWallpaper from "./assets/light-novel-girl.png";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  CalendarDays,
  Check,
  ChevronDown,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  History,
  Import,
  KeyRound,
  Library,
  Link as LinkIcon,
  Loader2,
  LocateFixed,
  MessageCircle,
  MoveHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  SendHorizontal,
  Settings2,
  Sparkles,
  Tag,
  Trash2,
  Video,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type {
  ApiSettings,
  KnowledgeConcept,
  KnowledgeEntry,
  KnowledgeListResponse,
  SavedVideoNotes,
  VideoFlashcard,
  VideoNotesJob,
  VideoNoteStyle,
  VideoNotesResult
} from "./types";
import {
  addVideoNotesHistoryItem,
  loadVideoNotesHistory,
  saveVideoNotesHistory
} from "./utils/storage";
import "./styles.css";

const videoNoteStyles: Array<{
  id: VideoNoteStyle;
  label: string;
  description: string;
}> = [
  { id: "summary", label: "全文总结", description: "摘要、亮点、思考和术语" },
  { id: "classNotes", label: "课堂笔记", description: "详细小节，适合课后复习" },
  { id: "exam", label: "考试复习", description: "考点、题目和检查清单" },
  { id: "glossary", label: "术语解释", description: "概念卡片和关系梳理" },
  { id: "timeline", label: "时间线", description: "按视频进度组织内容" }
];

const videoQuestionSuggestions = [
  "这节课最重要的 3 个点是什么？",
  "帮我出 5 道复习题",
  "有哪些容易混淆的概念？"
];

const apiProviderPresets: Array<{
  id: ApiSettings["provider"];
  label: string;
  baseUrl: string;
  model: string;
  apiMode: ApiSettings["apiMode"];
}> = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiMode: "chat_completions"
  },
  {
    id: "custom",
    label: "中转站",
    baseUrl: "",
    model: "deepseek-v4-flash",
    apiMode: "chat_completions"
  },
  {
    id: "openai",
    label: "OpenAI 兼容",
    baseUrl: "",
    model: "gpt-5.1",
    apiMode: "responses"
  }
];

type ReaderPreferences = {
  theme: "light" | "sepia" | "night" | "paper";
  fontFamily: "system" | "serif" | "sans" | "mono";
  fontSize: number;
  lineHeight: number;
  wallpaper: "none" | "soft" | "photo";
  wallpaperOpacity: number;
};

const defaultReaderPreferences: ReaderPreferences = {
  theme: "light",
  fontFamily: "system",
  fontSize: 16,
  lineHeight: 1.8,
  wallpaper: "none",
  wallpaperOpacity: 0.18
};

const READER_PREFERENCES_KEY = "learning-card-maker:reader-preferences";

const readerThemeColors: Record<
  ReaderPreferences["theme"],
  { bg: string; fg: string; muted: string; border: string; toolbar: string }
> = {
  light: {
    bg: "hsl(0 0% 100%)",
    fg: "hsl(222.2 47.4% 11.2%)",
    muted: "hsl(210 40% 98%)",
    border: "hsl(214.3 31.8% 91.4%)",
    toolbar: "rgba(255, 255, 255, 0.9)"
  },
  sepia: {
    bg: "hsl(38 46% 93%)",
    fg: "hsl(24 24% 24%)",
    muted: "hsl(39 42% 87%)",
    border: "hsl(36 30% 80%)",
    toolbar: "rgba(249, 241, 224, 0.92)"
  },
  night: {
    bg: "hsl(222 32% 10%)",
    fg: "hsl(210 32% 92%)",
    muted: "hsl(222 24% 20%)",
    border: "hsl(222 20% 26%)",
    toolbar: "rgba(12, 17, 29, 0.92)"
  },
  paper: {
    bg: "hsl(0 0% 97%)",
    fg: "hsl(0 0% 18%)",
    muted: "hsl(0 0% 92%)",
    border: "hsl(0 0% 86%)",
    toolbar: "rgba(255, 255, 255, 0.92)"
  }
};

const readerFonts: Record<ReaderPreferences["fontFamily"], string> = {
  system: 'Inter, "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif',
  serif: '"Noto Serif SC", "Songti SC", SimSun, Georgia, serif',
  sans: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Microsoft YaHei UI", sans-serif',
  mono: '"Cascadia Code", Consolas, "Courier New", monospace'
};

function loadReaderPreferences(): ReaderPreferences {
  try {
    const raw = window.localStorage.getItem(READER_PREFERENCES_KEY);
    if (!raw) {
      return defaultReaderPreferences;
    }
    const parsed = JSON.parse(raw);
    return { ...defaultReaderPreferences, ...parsed };
  } catch {
    return defaultReaderPreferences;
  }
}


function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getDateParts(value: string) {
  const date = new Date(value);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    time: new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date)
  };
}

function formatLongDate(value: string) {
  const { year, month, day } = getDateParts(value);
  return `${year}年${month}月${day}日`;
}

function dayKey(value: string) {
  const { year, month, day } = getDateParts(value);
  return `${year}-${month}-${day}`;
}

function monthKey(value: string) {
  const { year, month } = getDateParts(value);
  return `${year}-${month}`;
}

function getVideoNoteStyleLabel(style: VideoNoteStyle) {
  return videoNoteStyles.find((item) => item.id === style)?.label || "全文总结";
}

function makeMarkdownFilename(title: string) {
  const safeTitle = (title || "bilibili-video-notes")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${safeTitle || "bilibili-video-notes"}.md`;
}

function escapeCsv(value: string) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function makeFlashcardsCsv(cards: VideoFlashcard[]) {
  const rows = [
    ["Front", "Back", "Tags", "Source", "Difficulty"],
    ...cards.map((card) => [
      card.question,
      card.answer,
      card.tags.join(" "),
      card.source,
      card.difficulty
    ])
  ];
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

async function generateVideoNotes(payload: {
  sourceUrl: string;
  noteStyle: VideoNoteStyle;
}) {
  const response = await fetch("/api/video-notes/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "生成失败，请稍后重试。");
  }
  return data as VideoNotesJob;
}

async function fetchVideoNotesJob(jobId: string) {
  const response = await fetch(`/api/video-notes/jobs/${encodeURIComponent(jobId)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "获取任务进度失败，请稍后重试。");
  }
  return data as VideoNotesJob;
}

async function askVideoQuestion(payload: { videoNotes: VideoNotesResult; question: string }) {
  const response = await fetch("/api/video-notes/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "回答失败，请稍后重试。");
  }
  return data as { answer: string };
}

async function generateVideoFlashcards(payload: { videoNotes: VideoNotesResult; count: number }) {
  const response = await fetch("/api/video-notes/flashcards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "复习卡片生成失败，请稍后重试。");
  }
  return data as { cards: VideoFlashcard[] };
}

async function fetchApiSettings() {
  const response = await fetch("/api/settings");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "读取 API 设置失败。");
  }
  return data as ApiSettings;
}

async function saveApiSettings(payload: ApiSettings & { apiKey?: string }) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "保存 API 设置失败。");
  }
  return data as ApiSettings;
}

async function fetchKnowledgeList() {
  const response = await fetch("/api/knowledge");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "读取知识库失败。");
  }
  return data as KnowledgeListResponse;
}

async function fetchKnowledgeEntry(id: string) {
  const response = await fetch(`/api/knowledge/${encodeURIComponent(id)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "读取知识条目失败。");
  }
  return data as KnowledgeEntry;
}

async function createKnowledgeEntry(payload: Partial<KnowledgeEntry> & { markdown: string }) {
  const response = await fetch("/api/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "保存知识失败。");
  }
  return data as KnowledgeEntry;
}

async function updateKnowledgeEntry(id: string, payload: Partial<KnowledgeEntry>) {
  const response = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "更新知识失败。");
  }
  return data as KnowledgeEntry;
}

async function deleteKnowledgeEntry(id: string) {
  const response = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "删除知识失败。");
  }
  return data as { ok: boolean };
}

async function refineKnowledgeFromNotes(payload: {
  sourceUrl: string;
  bvid: string;
  sourceTitle: string;
  noteStyle: VideoNoteStyle;
  markdown: string;
}) {
  const response = await fetch("/api/knowledge/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "知识提炼失败，请稍后重试。");
  }
  return data as KnowledgeEntry;
}
function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function omitMarkdown(entry: KnowledgeEntry): Omit<KnowledgeEntry, "markdown"> {
  const { markdown, ...meta } = entry;
  return meta;
}
function App() {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoNoteStyle, setVideoNoteStyle] = useState<VideoNoteStyle>("summary");
  const [videoNotes, setVideoNotes] = useState<VideoNotesResult | null>(null);
  const [videoJob, setVideoJob] = useState<VideoNotesJob | null>(null);
  const [videoQuestion, setVideoQuestion] = useState("");
  const [videoAnswer, setVideoAnswer] = useState("");
  const [videoFlashcards, setVideoFlashcards] = useState<VideoFlashcard[]>([]);
  const [videoNotesHistory, setVideoNotesHistory] = useState<SavedVideoNotes[]>(() => loadVideoNotesHistory());
  const [apiSettings, setApiSettings] = useState<ApiSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isGeneratingVideoNotes, setIsGeneratingVideoNotes] = useState(false);
  const [isAskingVideoQuestion, setIsAskingVideoQuestion] = useState(false);
  const [isGeneratingFlashcards, setIsGeneratingFlashcards] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [message, setMessage] = useState("");
  const [activePage, setActivePage] = useState<"notes" | "knowledge" | "reader">("notes");
  const [readerDoc, setReaderDoc] = useState<{
    title: string;
    markdown: string;
    sourceLabel?: string;
    sourceUrl?: string;
  } | null>(null);
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(() => loadReaderPreferences());
  const [knowledgeItems, setKnowledgeItems] = useState<Array<Omit<KnowledgeEntry, "markdown">>>([]);
  const [knowledgeSelected, setKnowledgeSelected] = useState<KnowledgeEntry | null>(null);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [knowledgeNotice, setKnowledgeNotice] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [isKnowledgeLoading, setIsKnowledgeLoading] = useState(false);
  const [isRefiningKnowledge, setIsRefiningKnowledge] = useState(false);
  const [isCopyingReader, setIsCopyingReader] = useState(false);

  const canGenerateVideoNotes = useMemo(() => videoUrl.trim(), [videoUrl]);
  const canAskVideoQuestion = useMemo(
    () => Boolean(videoNotes?.markdown && videoQuestion.trim()),
    [videoNotes, videoQuestion]
  );

  useEffect(() => {
    window.localStorage.setItem(READER_PREFERENCES_KEY, JSON.stringify(readerPreferences));
  }, [readerPreferences]);

  useEffect(() => {
    let alive = true;
    fetchApiSettings()
      .then((settings) => {
        if (alive) {
          setApiSettings(settings);
        }
      })
      .catch((error) => {
        if (alive) {
          setMessage(error instanceof Error ? error.message : "读取 API 设置失败。");
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  function handleSelectApiProvider(provider: ApiSettings["provider"]) {
    const preset = apiProviderPresets.find((item) => item.id === provider);
    if (!preset) {
      return;
    }

    setApiSettings((current) => ({
      provider,
      apiKeySet: Boolean(current?.apiKeySet),
      baseUrl: preset.baseUrl || current?.baseUrl || "",
      model: preset.model,
      apiMode: preset.apiMode,
      envPath: current?.envPath
    }));
  }

  async function handleSaveApiSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!apiSettings) {
      return;
    }

    setIsSavingSettings(true);
    setMessage("");

    try {
      const nextSettings = await saveApiSettings({
        ...apiSettings,
        apiKey: apiKeyInput
      });
      setApiSettings(nextSettings);
      setApiKeyInput("");
      setMessage("API 设置已保存，后续生成会使用新配置。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存 API 设置失败。");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleGenerateVideoNotes(event: React.FormEvent) {
    event.preventDefault();
    if (!canGenerateVideoNotes) {
      setMessage("请输入 B 站视频链接。");
      return;
    }

    setIsGeneratingVideoNotes(true);
    setMessage("");
    setVideoJob(null);
    setVideoAnswer("");
    setVideoFlashcards([]);

    try {
      let job = await generateVideoNotes({
        sourceUrl: videoUrl,
        noteStyle: videoNoteStyle
      });
      setVideoJob(job);
      setMessage(job.message);

      while (job.status === "queued" || job.status === "running") {
        await wait(1200);
        job = await fetchVideoNotesJob(job.id);
        setVideoJob(job);
        setMessage(job.message);
      }

      if (job.status === "failed") {
        throw new Error(job.error?.message || job.message || "生成失败，请稍后重试。");
      }

      if (!job.result) {
        throw new Error("任务已完成，但没有返回笔记内容。");
      }

      const saved: SavedVideoNotes = {
        id: makeId(),
        createdAt: new Date().toISOString(),
        sourceUrl: videoUrl.trim() || job.result.sourceUrl,
        noteStyle: job.result.noteStyle,
        notes: job.result
      };

      setVideoNotes(job.result);
      setVideoQuestion("");
      setVideoFlashcards([]);
      setVideoNotesHistory(addVideoNotesHistoryItem(saved));
      setMessage(job.message || (job.result.truncated ? "Markdown 笔记已生成；文本较长，已基于前半段生成。" : "Markdown 笔记已生成。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成失败，请稍后重试。");
    } finally {
      setIsGeneratingVideoNotes(false);
    }
  }

  async function handleAskVideoQuestion(event: React.FormEvent) {
    event.preventDefault();
    if (!videoNotes?.markdown) {
      setMessage("请先生成或载入一份视频笔记。");
      return;
    }
    if (!videoQuestion.trim()) {
      setMessage("请输入想问的问题。");
      return;
    }

    setIsAskingVideoQuestion(true);
    setMessage("");

    try {
      const result = await askVideoQuestion({ videoNotes, question: videoQuestion });
      setVideoAnswer(result.answer);
      setMessage("视频问答已生成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "回答失败，请稍后重试。");
    } finally {
      setIsAskingVideoQuestion(false);
    }
  }

  async function handleGenerateFlashcards() {
    if (!videoNotes?.markdown) {
      setMessage("请先生成或载入一份视频笔记。");
      return;
    }

    setIsGeneratingFlashcards(true);
    setMessage("");

    try {
      const result = await generateVideoFlashcards({ videoNotes, count: 12 });
      setVideoFlashcards(result.cards);
      setMessage(`已生成 ${result.cards.length} 张复习卡片。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "复习卡片生成失败，请稍后重试。");
    } finally {
      setIsGeneratingFlashcards(false);
    }
  }

  function handleDownloadFlashcardsCsv() {
    if (videoFlashcards.length === 0) {
      return;
    }

    const csv = `\ufeff${makeFlashcardsCsv(videoFlashcards)}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = (videoNotes?.title || "video-flashcards")
      .replace(/[\\/:*?"<>|]/g, "-")
      .slice(0, 90);
    link.download = `${safeTitle || "video-flashcards"}-anki.csv`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("复习卡片 CSV 已下载。");
  }

  async function handleCopyMarkdown() {
    if (!videoNotes?.markdown) {
      return;
    }

    setIsCopying(true);
    setMessage("");

    try {
      await navigator.clipboard.writeText(videoNotes.markdown);
      setMessage("Markdown 已复制。");
    } catch {
      setMessage("复制失败，可以在右侧手动选中文本。");
    } finally {
      setIsCopying(false);
    }
  }

  function handleDownloadMarkdown() {
    if (!videoNotes?.markdown) {
      return;
    }

    const blob = new Blob([videoNotes.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = makeMarkdownFilename(videoNotes.title);
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Markdown 文件已下载。");
  }

  function handleLoadVideoNotesHistory(item: SavedVideoNotes) {
    setVideoUrl(item.sourceUrl);
    setVideoNoteStyle(item.noteStyle);
    setVideoNotes(item.notes);
    setVideoJob(null);
    setVideoQuestion("");
    setVideoAnswer("");
    setVideoFlashcards([]);
    setMessage("已载入历史视频笔记。");
  }

  function handleDeleteVideoNotesHistory(id: string) {
    const next = videoNotesHistory.filter((item) => item.id !== id);
    setVideoNotesHistory(next);
    saveVideoNotesHistory(next);
  }

  async function loadKnowledgeList() {
    setIsKnowledgeLoading(true);
    setKnowledgeError("");
    try {
      const result = await fetchKnowledgeList();
      setKnowledgeItems(result.items);
    } catch (error) {
      setKnowledgeError(error instanceof Error ? error.message : "读取知识库失败。");
    } finally {
      setIsKnowledgeLoading(false);
    }
  }

  useEffect(() => {
    if (activePage !== "knowledge") {
      return;
    }
    let alive = true;
    loadKnowledgeList();
    return () => {
      alive = false;
    };
  }, [activePage]);

  async function handleRefineToKnowledge() {
    if (!videoNotes?.markdown) {
      setMessage("请先生成或载入一份视频笔记，再提炼知识。");
      return;
    }
    setIsRefiningKnowledge(true);
    setKnowledgeNotice("");
    try {
      const entry = await refineKnowledgeFromNotes({
        sourceUrl: videoNotes.sourceUrl,
        bvid: videoNotes.bvid,
        sourceTitle: videoNotes.title,
        noteStyle: videoNotes.noteStyle,
        markdown: videoNotes.markdown
      });
      setKnowledgeSelected(entry);
      setKnowledgeItems((items) => [omitMarkdown(entry), ...items.filter((item) => item.id !== entry.id)]);
      setKnowledgeNotice(`已提炼：${entry.title}`);
      setMessage("知识已提炼并保存到知识库。");
      setActivePage("knowledge");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "知识提炼失败，请稍后重试。");
    } finally {
      setIsRefiningKnowledge(false);
    }
  }

  async function handleOpenKnowledgeInReader(id: string) {
    try {
      const entry = await fetchKnowledgeEntry(id);
      setKnowledgeSelected(entry);
      setReaderDoc({
        title: entry.title,
        markdown: entry.markdown,
        sourceLabel: "知识库",
        sourceUrl: entry.sourceUrl
      });
      setActivePage("reader");
    } catch (error) {
      setKnowledgeError(error instanceof Error ? error.message : "读取知识失败。");
    }
  }

  function handleOpenVideoNotesInReader() {
    if (!videoNotes?.markdown) {
      return;
    }
    setReaderDoc({
      title: videoNotes.title,
      markdown: videoNotes.markdown,
      sourceLabel: `${getVideoNoteStyleLabel(videoNotes.noteStyle)} · ${videoNotes.bvid}`,
      sourceUrl: videoNotes.sourceUrl
    });
    setActivePage("reader");
  }

  async function handleSelectKnowledge(id: string) {
    try {
      const entry = await fetchKnowledgeEntry(id);
      setKnowledgeSelected(entry);
      setKnowledgeError("");
    } catch (error) {
      setKnowledgeError(error instanceof Error ? error.message : "读取知识失败。");
    }
  }

  async function handleDeleteKnowledge(id: string) {
    const target = knowledgeItems.find((item) => item.id === id);
    if (!window.confirm(`确定删除「${target?.title || "这条知识"}」吗？`)) {
      return;
    }
    try {
      await deleteKnowledgeEntry(id);
      setKnowledgeItems((items) => items.filter((item) => item.id !== id));
      if (knowledgeSelected?.id === id) {
        setKnowledgeSelected(null);
      }
      setKnowledgeNotice("已删除。");
    } catch (error) {
      setKnowledgeError(error instanceof Error ? error.message : "删除失败。");
    }
  }

  async function handleSaveKnowledgeEdit(entry: KnowledgeEntry) {
    const updated = await updateKnowledgeEntry(entry.id, {
      title: entry.title,
      summary: entry.summary,
      tags: entry.tags,
      concepts: entry.concepts,
      markdown: entry.markdown,
      sourceTitle: entry.sourceTitle
    });
    setKnowledgeSelected(updated);
    setKnowledgeItems((items) => [omitMarkdown(updated), ...items.filter((item) => item.id !== updated.id)]);
    setKnowledgeNotice(`已更新：${updated.title}`);
  }

  async function handleImportMarkdownFile(file: File) {
    try {
      const text = await file.text();
      if (!text.trim()) {
        setKnowledgeError("文件内容为空。");
        return;
      }
      const title = file.name.replace(/\.md$/i, "") || "导入的知识";
      const entry = await createKnowledgeEntry({
        title,
        summary: text.slice(0, 200),
        tags: [],
        concepts: [],
        markdown: text,
        sourceTitle: "本地导入",
        sourceUrl: "",
        bvid: ""
      });
      setKnowledgeSelected(entry);
      setKnowledgeItems((items) => [omitMarkdown(entry), ...items.filter((item) => item.id !== entry.id)]);
      setKnowledgeNotice(`已导入：${entry.title}`);
      setActivePage("knowledge");
    } catch (error) {
      setKnowledgeError(error instanceof Error ? error.message : "导入失败。");
    }
  }

  async function handleCopyReaderMarkdown() {
    if (!readerDoc?.markdown) {
      return;
    }
    setIsCopyingReader(true);
    try {
      await navigator.clipboard.writeText(readerDoc.markdown);
      setKnowledgeNotice("Markdown 已复制。");
    } catch {
      setKnowledgeNotice("复制失败，请手动选择文本。");
    } finally {
      setIsCopyingReader(false);
    }
  }

  function handleDownloadReaderMarkdown() {
    if (!readerDoc?.markdown) {
      return;
    }
    const blob = new Blob([readerDoc.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = makeMarkdownFilename(readerDoc.title);
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Video size={22} aria-hidden="true" />
          </div>
          <div>
            <p>Video Notes</p>
            <h1>视频学习笔记</h1>
          </div>
        </div>

        <nav className="app-nav" aria-label="主导航">
          <button
            type="button"
            className={activePage === "notes" ? "active" : ""}
            onClick={() => setActivePage("notes")}
          >
            <Video size={16} aria-hidden="true" />
            视频笔记
          </button>
          <button
            type="button"
            className={activePage === "knowledge" ? "active" : ""}
            onClick={() => setActivePage("knowledge")}
          >
            <Library size={16} aria-hidden="true" />
            知识库
          </button>
          <button
            type="button"
            className={activePage === "reader" ? "active" : ""}
            onClick={() => setActivePage("reader")}
          >
            <BookOpen size={16} aria-hidden="true" />
            阅读器
          </button>
        </nav>

        <div className="header-actions">
          <span className={`model-pill ${apiSettings?.apiKeySet ? "ready" : ""}`}>
            {apiSettings?.model || "未读取模型"}
          </span>
          <SettingsDialog
            apiSettings={apiSettings}
            apiKeyInput={apiKeyInput}
            isSavingSettings={isSavingSettings}
            onApiKeyInputChange={setApiKeyInput}
            onApiSettingsChange={setApiSettings}
            onSave={handleSaveApiSettings}
            onSelectProvider={handleSelectApiProvider}
          />
        </div>
      </header>

      {activePage === "notes" && (
        <section className="app-grid">
        <aside className="sidebar">
          <section className="card panel-card">
            <div className="card-header">
              <div>
                <p className="section-kicker">开始</p>
                <h2>生成学习笔记</h2>
              </div>
              <Sparkles size={18} aria-hidden="true" />
            </div>

            <form className="video-form" onSubmit={handleGenerateVideoNotes}>
              <div className="field">
                <Label.Root className="field-label" htmlFor="video-url">
                  <LinkIcon size={15} aria-hidden="true" />
                  B 站视频链接
                </Label.Root>
                <input
                  id="video-url"
                  className="input"
                  value={videoUrl}
                  onChange={(event) => setVideoUrl(event.target.value)}
                  placeholder="https://www.bilibili.com/video/BV..."
                />
              </div>

              <div className="field">
                <Label.Root className="field-label">笔记风格</Label.Root>
                <div className="style-grid">
                  {videoNoteStyles.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      className={`style-card ${videoNoteStyle === style.id ? "active" : ""}`}
                      onClick={() => setVideoNoteStyle(style.id)}
                      disabled={isGeneratingVideoNotes}
                    >
                      <strong>{style.label}</strong>
                      <span>{style.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="action-grid">
                <button className="button button-primary" type="submit" disabled={isGeneratingVideoNotes || !canGenerateVideoNotes}>
                  {isGeneratingVideoNotes ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
                  {isGeneratingVideoNotes ? "生成中" : "生成笔记"}
                </button>
                <button className="button button-outline" type="button" onClick={handleDownloadMarkdown} disabled={!videoNotes?.markdown}>
                  <Download size={17} aria-hidden="true" />
                  下载 MD
                </button>
              </div>
            </form>
          </section>

          {videoJob && (
            <section className={`card progress-card ${videoJob.status}`}>
              <div className="progress-title">
                <div>
                  <strong>{videoJob.stage}</strong>
                  <p>{videoJob.message}</p>
                </div>
                <span>{Math.round(videoJob.progress)}%</span>
              </div>
              <Progress.Root className="progress-root" value={videoJob.progress}>
                <Progress.Indicator
                  className="progress-indicator"
                  style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, videoJob.progress))}%)` }}
                />
              </Progress.Root>
            </section>
          )}

          {message && <p className="status-message">{message}</p>}

          <section className="card info-card">
            <div className="card-header compact">
              <h2>当前笔记</h2>
              <FileText size={17} aria-hidden="true" />
            </div>
            {videoNotes ? (
              <dl className="meta-list">
                <div>
                  <dt>标题</dt>
                  <dd>{videoNotes.title}</dd>
                </div>
                <div>
                  <dt>文本来源</dt>
                  <dd>{videoNotes.subtitleLabel} · {videoNotes.segmentCount} 段</dd>
                </div>
                <div>
                  <dt>笔记风格</dt>
                  <dd>{getVideoNoteStyleLabel(videoNotes.noteStyle)}</dd>
                </div>
                <div>
                  <dt>BV 号</dt>
                  <dd>{videoNotes.bvid}</dd>
                </div>
              </dl>
            ) : (
              <p className="empty-state">等待生成或从历史载入。</p>
            )}
          </section>

          <section className="card history-card">
            <div className="card-header compact">
              <div>
                <h2>历史记录</h2>
                <p>{videoNotesHistory.length}/12</p>
              </div>
              <History size={17} aria-hidden="true" />
            </div>
            <div className="history-list">
              {videoNotesHistory.length === 0 ? (
                <p className="empty-state">生成后的笔记会保存在这里。</p>
              ) : (
                videoNotesHistory.map((item) => (
                  <article className="history-item" key={item.id}>
                    <button type="button" className="history-main" onClick={() => handleLoadVideoNotesHistory(item)}>
                      <strong>{item.notes.title}</strong>
                      <span>{formatDate(item.createdAt)} · {getVideoNoteStyleLabel(item.noteStyle)} · {item.notes.bvid}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`删除 ${item.notes.title}`}
                      onClick={() => handleDeleteVideoNotesHistory(item.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </article>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="main-workspace">
          <section className="card notes-card">
            <div className="notes-toolbar">
              <div>
                <p className="section-kicker">笔记</p>
                <h2>{videoNotes?.title || "视频学习笔记"}</h2>
              </div>
              <div className="action-row">
                <button
                  className="button button-outline"
                  type="button"
                  onClick={handleRefineToKnowledge}
                  disabled={!videoNotes?.markdown || isRefiningKnowledge}
                >
                  {isRefiningKnowledge ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                  {isRefiningKnowledge ? "提炼中" : "存入知识库"}
                </button>
                <button className="button button-outline" type="button" onClick={handleOpenVideoNotesInReader} disabled={!videoNotes?.markdown}>
                  <BookOpen size={16} aria-hidden="true" />
                  阅读器
                </button>
                <button className="button button-secondary" type="button" onClick={handleCopyMarkdown} disabled={!videoNotes?.markdown || isCopying}>
                  {isCopying ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}
                  {isCopying ? "复制中" : "复制"}
                </button>
              </div>
            </div>
            <textarea
              className="markdown-output"
              value={videoNotes?.markdown || ""}
              readOnly
              placeholder="生成后的 Markdown 笔记会显示在这里。"
            />
          </section>

          <section className="bottom-grid">
            <section className="card qa-card">
              <div className="card-header compact">
                <h2>问这个视频</h2>
                <MessageCircle size={17} aria-hidden="true" />
              </div>
              <form className="qa-form" onSubmit={handleAskVideoQuestion}>
                <textarea
                  className="textarea"
                  value={videoQuestion}
                  onChange={(event) => setVideoQuestion(event.target.value)}
                  placeholder="先生成或载入笔记，再问：这段内容怎么理解？重点是什么？"
                  disabled={!videoNotes?.markdown || isAskingVideoQuestion}
                />
                <div className="question-chip-row">
                  {videoQuestionSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setVideoQuestion(suggestion)}
                      disabled={!videoNotes?.markdown || isAskingVideoQuestion}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <button className="button button-primary" type="submit" disabled={!canAskVideoQuestion || isAskingVideoQuestion}>
                  {isAskingVideoQuestion ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <SendHorizontal size={17} aria-hidden="true" />}
                  {isAskingVideoQuestion ? "回答中" : "提问"}
                </button>
              </form>
              <div className="answer-box">
                {videoAnswer ? <pre>{videoAnswer}</pre> : <p>回答会显示在这里。</p>}
              </div>
            </section>

            <section className="card flashcard-panel">
              <div className="card-header compact">
                <div>
                  <h2>复习卡片 / Anki</h2>
                  <p>{videoFlashcards.length} 张</p>
                </div>
                <Brain size={17} aria-hidden="true" />
              </div>
              <div className="action-grid">
                <button
                  className="button button-primary"
                  type="button"
                  onClick={handleGenerateFlashcards}
                  disabled={!videoNotes?.markdown || isGeneratingFlashcards}
                >
                  {isGeneratingFlashcards ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Brain size={17} aria-hidden="true" />}
                  {isGeneratingFlashcards ? "生成中" : "生成卡片"}
                </button>
                <button
                  className="button button-outline"
                  type="button"
                  onClick={handleDownloadFlashcardsCsv}
                  disabled={videoFlashcards.length === 0}
                >
                  <Download size={17} aria-hidden="true" />
                  导出 CSV
                </button>
              </div>
              <div className="flashcard-list">
                {videoFlashcards.length === 0 ? (
                  <p className="empty-state">生成后的复习卡片会显示在这里。</p>
                ) : (
                  videoFlashcards.map((item, index) => (
                    <article className="flashcard-item" key={`${item.question}-${index}`}>
                      <div className="flashcard-index">{index + 1}</div>
                      <div>
                        <strong>{item.question}</strong>
                        <p>{item.answer}</p>
                        <span>{item.difficulty} · {item.tags.join(" / ")} · {item.source || "当前视频"}</span>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </section>
        </section>
      </section>
      )}

      {activePage === "knowledge" && (
        <KnowledgePage
          items={knowledgeItems}
          selected={knowledgeSelected}
          query={knowledgeQuery}
          isLoading={isKnowledgeLoading}
          isRefiningKnowledge={isRefiningKnowledge}
          error={knowledgeError}
          notice={knowledgeNotice}
          hasVideoNotes={Boolean(videoNotes?.markdown)}
          onQueryChange={setKnowledgeQuery}
          onRefresh={() => loadKnowledgeList()}
          onSelect={handleSelectKnowledge}
          onRefine={handleRefineToKnowledge}
          onImport={handleImportMarkdownFile}
          onDelete={handleDeleteKnowledge}
          onOpenInReader={handleOpenKnowledgeInReader}
          onSave={handleSaveKnowledgeEdit}
        />
      )}

      {activePage === "reader" && (
        <ReaderPage
          doc={readerDoc}
          isCopying={isCopyingReader}
          preferences={readerPreferences}
          onPreferencesChange={setReaderPreferences}
          onBack={() => setActivePage(readerDoc?.sourceLabel === "知识库" ? "knowledge" : "notes")}
          onCopy={handleCopyReaderMarkdown}
          onDownload={handleDownloadReaderMarkdown}
        />
      )}
    </main>
  );
}

const TIMELINE_MIN_PIXELS_PER_DAY = 8;
const TIMELINE_MAX_PIXELS_PER_DAY = 560;
const TIMELINE_DEFAULT_PIXELS_PER_DAY = 240;
const TIMELINE_NODE_SPACING = 240;

function clampTimelineZoom(value: number) {
  return Math.min(TIMELINE_MAX_PIXELS_PER_DAY, Math.max(TIMELINE_MIN_PIXELS_PER_DAY, value));
}

function formatTimelineZoom(value: number) {
  return `${Math.round(value)}px/天`;
}

function KnowledgeTimeline({
  items,
  selectedId,
  onSelect
}: {
  items: Array<Omit<KnowledgeEntry, "markdown">>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pixelsPerDay, setPixelsPerDay] = useState(TIMELINE_DEFAULT_PIXELS_PER_DAY);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(() => new Set());
  const [minimapDragging, setMinimapDragging] = useState(false);
  const [viewport, setViewport] = useState({ left: 0, width: 100 });
  const pendingAnchorRef = useRef<{ contentX: number; pointerX: number } | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const minimapDragRef = useRef<{ startX: number; startRatio: number } | null>(null);
  const dragState = useRef({
    startX: 0,
    startY: 0,
    lastY: 0,
    startScroll: 0,
    moved: false,
    downNodeId: null as string | null,
    mode: null as "pan" | "zoom" | null
  });

  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [items]
  );

  const selectedItem = useMemo(
    () => sorted.find((item) => item.id === selectedId) || null,
    [sorted, selectedId]
  );

  const dayGroups = useMemo(() => {
    const groups = new Map<string, Array<Omit<KnowledgeEntry, "markdown">>>();
    for (const item of sorted) {
      const key = dayKey(item.createdAt);
      const list = groups.get(key) || [];
      list.push(item);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      items,
      count: items.length,
      isCluster: items.length >= 3
    }));
  }, [sorted]);

  const monthCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of sorted) {
      const key = monthKey(item.createdAt);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [sorted]);

  const activeMonthKey = useMemo(() => {
    if (selectedItem) {
      return monthKey(selectedItem.createdAt);
    }
    if (sorted.length > 0) {
      return monthKey(sorted[sorted.length - 1].createdAt);
    }
    return null;
  }, [selectedItem, sorted]);

  const range = useMemo(() => {
    if (sorted.length === 0) {
      return { startTime: Date.now(), totalDays: 1 };
    }
    const times = sorted.map((item) => new Date(item.createdAt).getTime());
    const minDate = new Date(Math.min(...times));
    const maxDate = new Date(Math.max(...times));
    const start = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
    return {
      startTime: start.getTime(),
      totalDays: Math.max(1, (end.getTime() - start.getTime()) / 86400000)
    };
  }, [sorted]);

  const fitPixelsPerDay = useMemo(() => {
    if (sorted.length < 2) {
      return Math.max(TIMELINE_MIN_PIXELS_PER_DAY, Math.min(TIMELINE_DEFAULT_PIXELS_PER_DAY, 1180 / range.totalDays));
    }
    let minDayGap = Infinity;
    for (let index = 1; index < sorted.length; index += 1) {
      const gap =
        (new Date(sorted[index].createdAt).getTime() - new Date(sorted[index - 1].createdAt).getTime()) / 86400000;
      minDayGap = Math.min(minDayGap, Math.max(1, gap));
    }
    return Math.max(
      TIMELINE_MIN_PIXELS_PER_DAY,
      Math.min(TIMELINE_DEFAULT_PIXELS_PER_DAY, TIMELINE_NODE_SPACING / minDayGap)
    );
  }, [range, sorted]);

  useEffect(() => {
    setPixelsPerDay(fitPixelsPerDay);
  }, [fitPixelsPerDay]);

  const trackWidth = useMemo(
    () => Math.max(820, range.totalDays * pixelsPerDay + 160),
    [range.totalDays, pixelsPerDay]
  );

  useEffect(() => {
    updateViewport();
    const el = trackRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(updateViewport);
    observer.observe(el);
    return () => observer.disconnect();
  }, [trackWidth, pixelsPerDay, sorted.length]);

  const rangeLabel = useMemo(() => {
    if (sorted.length === 0) {
      return "暂无时间范围";
    }
    const times = sorted.map((item) => new Date(item.createdAt).getTime());
    const first = new Date(Math.min(...times));
    const last = new Date(Math.max(...times));
    return `${first.getFullYear()}年${first.getMonth() + 1}月${first.getDate()}日 - ${last.getFullYear()}年${last.getMonth() + 1}月${last.getDate()}日`;
  }, [sorted]);

  const monthBands = useMemo(() => {
    const bands: Array<{ key: string; left: number; width: number; label: string }> = [];
    const cursor = new Date(range.startTime);
    const endTime = range.startTime + range.totalDays * 86400000;
    while (cursor.getTime() < endTime) {
      const bandStart = cursor.getTime();
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const bandEnd = Math.min(next.getTime(), endTime);
      bands.push({
        key: `${cursor.getFullYear()}-${cursor.getMonth() + 1}`,
        left: ((bandStart - range.startTime) / 86400000 / range.totalDays) * 100,
        width: ((bandEnd - bandStart) / 86400000 / range.totalDays) * 100,
        label: `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
      });
      cursor.setTime(next.getTime());
    }
    return bands;
  }, [range]);

  const todayMarker = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(range.startTime);
    const end = new Date(range.startTime + range.totalDays * 86400000);
    if (today < start || today >= end) {
      return null;
    }
    return {
      left: ((today.getTime() - range.startTime) / 86400000 / range.totalDays) * 100,
      label: `${today.getMonth() + 1}月${today.getDate()}日`
    };
  }, [range]);

  const tickStepDays = useMemo(() => {
    const candidates = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 365];
    return candidates.find((step) => step * pixelsPerDay >= 64) ?? 365;
  }, [pixelsPerDay]);

  const ticks = useMemo(() => {
    const list: Array<{ time: number; label: string; major: boolean }> = [];
    const endTime = range.startTime + range.totalDays * 86400000;
    const cursor = new Date(range.startTime);
    while (cursor.getTime() < endTime) {
      const isMonthStart = cursor.getDate() === 1;
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      const day = cursor.getDate();
      let label = "";
      let major = false;
      if (tickStepDays <= 5) {
        major = isMonthStart || cursor.getDay() === 0;
        label = isMonthStart
          ? `${year}年${month}月`
          : major
            ? `${month}月${day}日`
            : "";
      } else if (tickStepDays <= 14) {
        major = isMonthStart || cursor.getDay() === 0 || (cursor.getDate() - 1) % 7 === 0;
        label = major
          ? isMonthStart
            ? `${year}年${month}月`
            : `${month}月${day}日`
          : "";
      } else if (tickStepDays <= 45) {
        major = true;
        label = `${year}年${month}月${day}日`;
      } else if (tickStepDays <= 120) {
        major = true;
        label = `${year}年${month}月`;
      } else {
        major = true;
        label = `${year}年`;
      }
      list.push({ time: cursor.getTime(), label, major });
      cursor.setTime(cursor.getTime() + tickStepDays * 86400000);
    }
    return list;
  }, [range, tickStepDays]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || !pendingAnchorRef.current) {
      return;
    }
    el.scrollLeft = pendingAnchorRef.current.contentX - pendingAnchorRef.current.pointerX;
    pendingAnchorRef.current = null;
  }, [pixelsPerDay, trackWidth]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    const nodes = el.querySelectorAll<HTMLElement>(".timeline-node:not(.timeline-cluster-child)");
    if (nodes.length === 0) {
      return;
    }
    const last = nodes[nodes.length - 1] as HTMLElement;
    el.scrollLeft = Math.max(0, last.offsetLeft - 140);
  }, [items.length]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || !selectedId) {
      return;
    }
    const node = el.querySelector(`.timeline-node[data-id="${selectedId}"]`) as HTMLElement | null;
    if (!node) {
      return;
    }
    const cluster = node.closest(".timeline-cluster") as HTMLElement | null;
    const anchor = cluster || node;
    el.scrollTo({
      left: Math.max(0, anchor.offsetLeft + anchor.offsetWidth / 2 - el.clientWidth / 2),
      behavior: "smooth"
    });
  }, [selectedId]);

  function getLeftPercent(value: string) {
    const endTime = range.startTime + range.totalDays * 86400000;
    const time = Math.min(Math.max(new Date(value).getTime(), range.startTime), endTime);
    return ((time - range.startTime) / 86400000 / range.totalDays) * 100;
  }

  function updateViewport() {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) {
      setViewport({ left: 0, width: 100 });
      return;
    }
    setViewport({
      left: (el.scrollLeft / maxScroll) * 100,
      width: (el.clientWidth / el.scrollWidth) * 100
    });
  }

  function scrollToDateValue(value: string) {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    const time = Math.min(Math.max(new Date(value).getTime(), range.startTime), range.startTime + range.totalDays * 86400000);
    const left = Math.max(0, ((time - range.startTime) / 86400000) * pixelsPerDay - 140);
    el.scrollTo({ left, behavior: "smooth" });
  }

  function scrollToMonthKey(key: string) {
    const firstItem = sorted.find((item) => monthKey(item.createdAt) === key);
    if (firstItem) {
      scrollToDateValue(firstItem.createdAt);
      return;
    }
    const band = monthBands.find((item) => item.key === key);
    if (band) {
      scrollToDateValue(new Date(range.startTime + (band.left / 100) * range.totalDays * 86400000).toISOString());
    }
  }

  function handleMinimapPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const map = minimapRef.current;
    const el = trackRef.current;
    if (!map || !el) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest(".timeline-month-chip")) {
      return;
    }
    const rect = map.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    minimapDragRef.current = { startX: event.clientX, startRatio: ratio };
    setMinimapDragging(true);
    map.setPointerCapture(event.pointerId);
    el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth);
  }

  function handleMinimapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = minimapDragRef.current;
    const map = minimapRef.current;
    const el = trackRef.current;
    if (!drag || !map || !el) {
      return;
    }
    const rect = map.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, drag.startRatio + (event.clientX - drag.startX) / rect.width));
    el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth);
  }

  function handleMinimapPointerUp() {
    minimapDragRef.current = null;
    setMinimapDragging(false);
  }

  function applyZoom(nextValue: number, contentX?: number, pointerX?: number) {
    const next = clampTimelineZoom(nextValue);
    if (contentX !== undefined && pointerX !== undefined) {
      pendingAnchorRef.current = { contentX, pointerX };
    }
    setPixelsPerDay(next);
  }

  function zoomBy(factor: number) {
    const el = trackRef.current;
    const pointerX = el ? el.clientWidth / 2 : 0;
    const contentX = el ? el.scrollLeft + pointerX : 0;
    applyZoom(pixelsPerDay * factor, contentX, pointerX);
  }

  function resetZoom() {
    const el = trackRef.current;
    const pointerX = el ? el.clientWidth / 2 : 0;
    const contentX = el ? el.scrollLeft + pointerX : 0;
    applyZoom(fitPixelsPerDay, contentX, pointerX);
  }

  function scrollToLatest() {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    const nodes = el.querySelectorAll<HTMLElement>(".timeline-node:not(.timeline-cluster-child)");
    const last = nodes[nodes.length - 1] as HTMLElement | undefined;
    if (!last) {
      return;
    }
    el.scrollTo({
      left: Math.max(0, last.offsetLeft - 140),
      behavior: "smooth"
    });
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const contentX = el.scrollLeft + pointerX;
      applyZoom(clampTimelineZoom(pixelsPerDay * Math.pow(1.0016, -event.deltaY)), contentX, pointerX);
      return;
    }
    el.scrollLeft += event.deltaX + event.deltaY;
  }

  function handleTrackKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    const el = trackRef.current;
    if (!el) {
      return;
    }
    const nodes = Array.from(el.querySelectorAll<HTMLButtonElement>(".timeline-node:not(.timeline-cluster-child)"));
    if (nodes.length === 0) {
      return;
    }
    const currentIndex = nodes.findIndex((node) => node === document.activeElement);
    if (currentIndex < 0) {
      return;
    }
    const nextIndex =
      event.key === "ArrowRight"
        ? Math.min(nodes.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
    const target = nodes[nextIndex];
    target.focus();
    const targetId = target.getAttribute("data-id");
    if (targetId) {
      onSelect(targetId);
    }
    el.scrollTo({
      left: Math.max(0, target.offsetLeft + target.offsetWidth / 2 - el.clientWidth / 2),
      behavior: "smooth"
    });
    event.preventDefault();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    const target = event.target as HTMLElement;
    const node = target.closest(".timeline-node");
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      startScroll: el.scrollLeft,
      moved: false,
      downNodeId: node?.getAttribute("data-id") || null,
      mode: null
    };
    setDragging(true);
    el.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const el = trackRef.current;
    if (!el || !dragging) {
      return;
    }
    const deltaX = event.clientX - dragState.current.startX;
    const deltaY = event.clientY - dragState.current.startY;
    if (!dragState.current.mode) {
      if (Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) {
        return;
      }
      dragState.current.mode = Math.abs(deltaX) >= Math.abs(deltaY) ? "pan" : "zoom";
      dragState.current.moved = true;
      dragState.current.lastY = event.clientY;
    }
    if (dragState.current.mode === "pan") {
      el.scrollLeft = dragState.current.startScroll - deltaX;
      return;
    }
    const rect = el.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const contentX = el.scrollLeft + pointerX;
    const zoomDelta = dragState.current.lastY - event.clientY;
    dragState.current.lastY = event.clientY;
    const next = clampTimelineZoom(pixelsPerDay * Math.pow(1.0016, zoomDelta));
    if (Math.abs(next - pixelsPerDay) > 0.01) {
      applyZoom(next, contentX, pointerX);
    }
  }

  function handlePointerUp() {
    setDragging(false);
  }

  const showFullMonthLabels = monthBands.length <= 18;
  const showShortMonthLabels = monthBands.length <= 40;

  if (items.length === 0) {
    return (
      <div className="timeline-wrap empty">
        <div className="empty-panel">
          <History size={36} aria-hidden="true" />
          <h2>知识时间轴</h2>
          <p>添加知识后，这里会按创建时间展示你沉淀了哪些内容。</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`timeline-wrap ${dragging ? "dragging" : ""}`}>
      <div className="timeline-toolbar">
        <div className="timeline-range" aria-label="时间范围">
          <span className="timeline-count">{sorted.length} 条知识</span>
          <i />
          <span>{rangeLabel}</span>
        </div>
        <div className="timeline-actions">
          {selectedItem && (
            <span className="timeline-selected-date" title={selectedItem.title}>
              <CalendarDays size={14} aria-hidden="true" />
              <span>{formatLongDate(selectedItem.createdAt)}</span>
            </span>
          )}
          <div className="timeline-zoom" role="group" aria-label="时间轴缩放">
            <button
              className="icon-button"
              type="button"
              onClick={() => zoomBy(1 / 1.25)}
              disabled={pixelsPerDay <= TIMELINE_MIN_PIXELS_PER_DAY + 0.1}
              title="缩小时间轴"
              aria-label="缩小时间轴"
            >
              <ZoomOut size={15} aria-hidden="true" />
            </button>
            <span>{formatTimelineZoom(pixelsPerDay)}</span>
            <button
              className="icon-button"
              type="button"
              onClick={() => zoomBy(1.25)}
              disabled={pixelsPerDay >= TIMELINE_MAX_PIXELS_PER_DAY - 0.1}
              title="放大时间轴"
              aria-label="放大时间轴"
            >
              <ZoomIn size={15} aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" onClick={resetZoom} title="重置缩放" aria-label="重置缩放">
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          </div>
          <button className="icon-button timeline-locate" type="button" onClick={scrollToLatest} title="定位到最新知识" aria-label="定位到最新知识">
            <LocateFixed size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        className="timeline-track"
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onScroll={updateViewport}
        onKeyDown={handleTrackKeyDown}
        onClick={() => {
          const wasDragging = dragState.current.moved;
          const id = dragState.current.downNodeId;
          dragState.current.moved = false;
          dragState.current.downNodeId = null;
          dragState.current.mode = null;
          if (id && !wasDragging) {
            onSelect(id);
          }
        }}
      >
        <div className="timeline-inner" style={{ width: `${trackWidth}px` }}>
          <div className="timeline-months" aria-hidden="true">
            {monthBands.map((band) => (
              <span className="timeline-month-band" key={band.key} style={{ left: `${band.left}%`, width: `${band.width}%` }}>
                {band.label}
              </span>
            ))}
          </div>
          {dayGroups.map((group) => (
            <span
              className="timeline-stem"
              key={`stem-${group.key}`}
              style={{ left: `${getLeftPercent(group.items[0].createdAt)}%` }}
              aria-hidden="true"
            />
          ))}
          <div className="timeline-line" />
          <div className="timeline-scale" aria-hidden="true">
            <div className="timeline-ruler-line" />
            {ticks.map((tick) => {
              const left = ((tick.time - range.startTime) / 86400000 / range.totalDays) * 100;
              return (
                <span className={`timeline-tick ${tick.major ? "major" : ""}`} key={tick.time} style={{ left: `${left}%` }}>
                  <i />
                  {tick.label && <span>{tick.label}</span>}
                </span>
              );
            })}
          </div>
          {todayMarker && (
            <div className="timeline-today" style={{ left: `${todayMarker.left}%` }} aria-hidden="true">
              <span>今天 {todayMarker.label}</span>
            </div>
          )}
          {dayGroups.map((group, groupIndex) => {
            const left = getLeftPercent(group.items[0].createdAt);
            if (group.isCluster) {
              const primary = group.items[group.items.length - 1];
              const primaryParts = getDateParts(primary.createdAt);
              const isOpen =
                expandedClusters.has(group.key) || group.items.some((item) => item.id === selectedId);
              return (
                <div
                  className={`timeline-cluster ${isOpen ? "open" : ""}`}
                  key={group.key}
                  style={{ left: `${left}%` }}
                >
                  <button
                    type="button"
                    data-id={primary.id}
                    className={`timeline-node timeline-cluster-card ${selectedId === primary.id ? "active" : ""} ${hoveredId === primary.id ? "hovered" : ""} ${pixelsPerDay < 52 ? "dense" : ""}`}
                    style={{ animationDelay: `${groupIndex * 70}ms` }}
                    title={`${primary.title} · ${formatLongDate(primary.createdAt)}`}
                    aria-pressed={selectedId === primary.id}
                    aria-expanded={isOpen}
                    aria-label={`${primary.title}，共 ${group.count} 条知识，${formatLongDate(primary.createdAt)}`}
                    onPointerEnter={() => setHoveredId(primary.id)}
                    onPointerLeave={() => setHoveredId(null)}
                    onFocus={() => setHoveredId(primary.id)}
                    onBlur={() => setHoveredId(null)}
                    onClick={() => {
                      onSelect(primary.id);
                      setExpandedClusters((current) => {
                        const next = new Set(current);
                        if (next.has(group.key)) {
                          next.delete(group.key);
                        } else {
                          next.add(group.key);
                        }
                        return next;
                      });
                    }}
                  >
                    <span className="timeline-dot" />
                    <span className="timeline-cluster-badge">{group.count} 条</span>
                    <span className="timeline-date">
                      <b>{primaryParts.year}</b>
                      <span>{primaryParts.month}月{primaryParts.day}日</span>
                    </span>
                    <strong>{primary.title}</strong>
                    <span className="timeline-summary">{primary.summary || "暂无摘要"}</span>
                    <span className="timeline-tags">{primary.tags.slice(0, 2).join(" / ") || "知识"}</span>
                  </button>
                  {isOpen && (
                    <div className="timeline-cluster-pop" role="group" aria-label="同一天的知识">
                      {group.items.map((item, childIndex) => (
                        <button
                          key={item.id}
                          type="button"
                          data-id={item.id}
                          className={`timeline-node timeline-cluster-child ${selectedId === item.id ? "active" : ""}`}
                          title={`${item.title} · ${formatLongDate(item.createdAt)}`}
                          aria-pressed={selectedId === item.id}
                          onClick={() => onSelect(item.id)}
                          onPointerEnter={() => setHoveredId(item.id)}
                          onPointerLeave={() => setHoveredId(null)}
                          onFocus={() => setHoveredId(item.id)}
                          onBlur={() => setHoveredId(null)}
                        >
                          <span className="timeline-child-index">{childIndex + 1}</span>
                          <span className="timeline-child-copy">
                            <strong>{item.title}</strong>
                            <small>{item.tags.slice(0, 2).join(" / ") || "知识"}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return group.items.map((item, index) => {
              const dateParts = getDateParts(item.createdAt);
              return (
                <button
                  key={item.id}
                  type="button"
                  data-id={item.id}
                  className={`timeline-node ${selectedId === item.id ? "active" : ""} ${hoveredId === item.id ? "hovered" : ""} ${index % 2 === 1 ? "below" : ""} ${pixelsPerDay < 52 ? "dense" : ""}`}
                  style={{
                    left: `${left}%`,
                    animationDelay: `${groupIndex * 70 + index * 40}ms`
                  }}
                  title={`${item.title} · ${formatLongDate(item.createdAt)}`}
                  aria-pressed={selectedId === item.id}
                  aria-label={`${item.title}，${formatLongDate(item.createdAt)}`}
                  onPointerEnter={() => setHoveredId(item.id)}
                  onPointerLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(item.id)}
                  onBlur={() => setHoveredId(null)}
                >
                  <span className="timeline-dot" />
                  <span className="timeline-date">
                    <b>{dateParts.year}</b>
                    <span>{dateParts.month}月{dateParts.day}日</span>
                  </span>
                  <strong>{item.title}</strong>
                  <span className="timeline-summary">{item.summary || "暂无摘要"}</span>
                  <span className="timeline-tags">{item.tags.slice(0, 2).join(" / ") || "知识"}</span>
                </button>
              );
            });
          })}
        </div>
      </div>
      <div
        className={`timeline-minimap ${minimapDragging ? "dragging" : ""}`}
        ref={minimapRef}
        role="navigation"
        aria-label="月份快速导航"
        onPointerDown={handleMinimapPointerDown}
        onPointerMove={handleMinimapPointerMove}
        onPointerUp={handleMinimapPointerUp}
        onPointerCancel={handleMinimapPointerUp}
      >
        {monthBands.map((band) => {
          const count = monthCounts[band.key] || 0;
          const label = showFullMonthLabels
            ? band.label
            : showShortMonthLabels
              ? band.label.replace(/^\d+年/, "")
              : "";
          return (
            <button
              type="button"
              key={band.key}
              className={`timeline-month-chip ${activeMonthKey === band.key ? "active" : ""} ${count > 0 ? "has-items" : ""}`}
              style={{ left: `${band.left}%`, width: `${band.width}%` }}
              title={`${band.label}${count > 0 ? ` · ${count} 条知识` : ""}`}
              aria-label={`${band.label}${count > 0 ? `，${count} 条知识` : ""}`}
              onClick={() => scrollToMonthKey(band.key)}
            >
              {label && <span>{label}</span>}
              {count > 0 && <b>{count}</b>}
            </button>
          );
        })}
        {viewport.width < 99.5 && (
          <div
            className="timeline-minimap-thumb"
            style={{ left: `${viewport.left}%`, width: `${viewport.width}%` }}
            role="slider"
            tabIndex={0}
            aria-label="时间轴视图位置"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(viewport.left)}
            onKeyDown={(event) => {
              const el = trackRef.current;
              if (!el) {
                return;
              }
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                const direction = event.key === "ArrowLeft" ? -1 : 1;
                el.scrollLeft += direction * Math.max(120, el.clientWidth * 0.2);
                event.preventDefault();
              }
            }}
          />
        )}
      </div>
      <p className="timeline-hint">
        <MoveHorizontal size={14} aria-hidden="true" />
        月份条点击跳转 · 左右拖动平移 · 上下拖动缩放 · Ctrl + 滚轮缩放 · 点击条目查看详情
      </p>
    </div>
  );
}
function KnowledgePage({
  items,
  selected,
  query,
  isLoading,
  isRefiningKnowledge,
  error,
  notice,
  hasVideoNotes,
  onQueryChange,
  onRefresh,
  onSelect,
  onRefine,
  onImport,
  onDelete,
  onOpenInReader,
  onSave
}: {
  items: Array<Omit<KnowledgeEntry, "markdown">>;
  selected: KnowledgeEntry | null;
  query: string;
  isLoading: boolean;
  isRefiningKnowledge: boolean;
  error: string;
  notice: string;
  hasVideoNotes: boolean;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  onRefine: () => void;
  onImport: (file: File) => void;
  onDelete: (id: string) => void;
  onOpenInReader: (id: string) => void;
  onSave: (entry: KnowledgeEntry) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "timeline">("list");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return items;
    }
    return items.filter((item) => {
      const searchable = [
        item.title,
        item.summary,
        item.sourceTitle,
        item.bvid,
        ...item.tags
      ].join(" ").toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [items, query]);

  useEffect(() => {
    if (selected && !editing) {
      setDraftTitle(selected.title);
      setDraftSummary(selected.summary);
      setDraftTags(selected.tags.join(", "));
      setDraftMarkdown(selected.markdown);
    }
  }, [selected?.id, editing]);

  async function handleSaveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) {
      return;
    }
    setIsSavingEdit(true);
    try {
      await onSave({
        ...selected,
        title: draftTitle.trim() || selected.title,
        summary: draftSummary.trim(),
        tags: draftTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        markdown: draftMarkdown
      });
      setEditing(false);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingEdit(false);
    }
  }

  return (
    <section className={`knowledge-layout ${viewMode === "timeline" ? "timeline-view" : ""}`}>
      <aside className={`knowledge-sidebar ${viewMode === "timeline" ? "timeline-sidebar" : ""}`}>
        <div className="knowledge-toolbar">
          <div className="view-mode-switch" role="group" aria-label="知识库视图">
            <button
              type="button"
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
            >
              <Library size={15} aria-hidden="true" />
              列表
            </button>
            <button
              type="button"
              className={viewMode === "timeline" ? "active" : ""}
              onClick={() => setViewMode("timeline")}
            >
              <History size={15} aria-hidden="true" />
              时间轴
            </button>
          </div>
          <div className="knowledge-search">
            <Search size={16} aria-hidden="true" />
            <input
              className="input"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索标题、标签、摘要"
            />
          </div>
          <div className="action-row">
            <button className="button button-primary" type="button" onClick={onRefine} disabled={!hasVideoNotes || isRefiningKnowledge}>
              {isRefiningKnowledge ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
              {isRefiningKnowledge ? "提炼中" : "提炼笔记"}
            </button>
            <button className="button button-outline" type="button" onClick={() => fileInputRef.current?.click()}>
              <Import size={16} aria-hidden="true" />
              导入 MD
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,text/markdown"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onImport(file);
                }
                event.target.value = "";
              }}
            />
            <button className="icon-button" type="button" onClick={onRefresh} disabled={isLoading} aria-label="刷新知识库">
              <RefreshCw className={isLoading ? "spin" : ""} size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {notice && <p className="status-message">{notice}</p>}
        {error && <p className="error-message">{error}</p>}

        {viewMode === "timeline" ? (
          <KnowledgeTimeline items={filteredItems} selectedId={selected?.id || null} onSelect={onSelect} />
        ) : (
          <div className="knowledge-list">
            {isLoading && items.length === 0 ? (
              <p className="empty-state">正在读取知识库...</p>
            ) : filteredItems.length === 0 ? (
              <p className="empty-state">还没有知识条目。可以提炼当前视频笔记，或导入一份 .md 文件。</p>
            ) : (
              filteredItems.map((item) => (
                <article className={`knowledge-item ${selected?.id === item.id ? "active" : ""}`} key={item.id}>
                  <button className="knowledge-item-main" type="button" onClick={() => onSelect(item.id)}>
                    <strong>{item.title}</strong>
                    <p>{item.summary}</p>
                    <div className="tag-row">
                      {item.tags.slice(0, 4).map((tag) => (
                        <span className="tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <span>{formatDate(item.updatedAt)} · {item.sourceTitle || item.bvid || "知识库"}</span>
                  </button>
                  <div className="knowledge-item-actions">
                    <button className="icon-button" type="button" aria-label="阅读" onClick={() => onOpenInReader(item.id)}>
                      <BookOpen size={15} aria-hidden="true" />
                    </button>
                    <button className="icon-button danger" type="button" aria-label="删除" onClick={() => onDelete(item.id)}>
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </aside>

      <section className="knowledge-detail">
        {!selected ? (
          <div className="empty-panel">
            <Library size={40} aria-hidden="true" />
            <h2>知识库</h2>
            <p>选择一个知识条目，或提炼当前视频笔记。知识会保存在本机，方便长期沉淀和复习。</p>
          </div>
        ) : editing ? (
          <form className="knowledge-edit-form" onSubmit={handleSaveEdit}>
            <div className="knowledge-detail-header">
              <div>
                <p className="section-kicker">编辑</p>
                <h2>编辑知识</h2>
              </div>
            </div>
            <div className="field">
              <Label.Root className="field-label" htmlFor="knowledge-title">
                标题
              </Label.Root>
              <input id="knowledge-title" className="input" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
            </div>
            <div className="field">
              <Label.Root className="field-label" htmlFor="knowledge-summary">
                摘要
              </Label.Root>
              <textarea id="knowledge-summary" className="textarea" value={draftSummary} onChange={(event) => setDraftSummary(event.target.value)} rows={4} />
            </div>
            <div className="field">
              <Label.Root className="field-label" htmlFor="knowledge-tags">
                标签（逗号分隔）
              </Label.Root>
              <input id="knowledge-tags" className="input" value={draftTags} onChange={(event) => setDraftTags(event.target.value)} />
            </div>
            <div className="field">
              <Label.Root className="field-label" htmlFor="knowledge-markdown">
                Markdown 内容
              </Label.Root>
              <textarea id="knowledge-markdown" className="textarea markdown-edit" value={draftMarkdown} onChange={(event) => setDraftMarkdown(event.target.value)} />
            </div>
            <div className="action-row">
              <button className="button button-primary" type="submit" disabled={isSavingEdit}>
                {isSavingEdit ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                {isSavingEdit ? "保存中" : "保存"}
              </button>
              <button className="button button-outline" type="button" onClick={() => setEditing(false)}>
                取消
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="knowledge-detail-header">
              <div>
                <p className="section-kicker">知识详情</p>
                <h2>{selected.title}</h2>
              </div>
              <div className="action-row">
                <button className="button button-secondary" type="button" onClick={() => onOpenInReader(selected.id)}>
                  <BookOpen size={16} aria-hidden="true" />
                  阅读
                </button>
                <button className="button button-outline" type="button" onClick={() => setEditing(true)}>
                  <Pencil size={16} aria-hidden="true" />
                  编辑
                </button>
                <button className="icon-button danger" type="button" aria-label="删除" onClick={() => onDelete(selected.id)}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>

            <p className="knowledge-summary">{selected.summary}</p>
            <div className="tag-row">
              {selected.tags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>

            {selected.concepts.length > 0 && (
              <div className="concept-grid">
                {selected.concepts.map((concept) => (
                  <article className="concept-item" key={concept.name}>
                    <strong>{concept.name}</strong>
                    <p>{concept.explanation}</p>
                  </article>
                ))}
              </div>
            )}

            <div className="knowledge-source">
              {selected.sourceUrl ? (
                <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} aria-hidden="true" />
                  {selected.sourceUrl}
                </a>
              ) : (
                <span>本地导入</span>
              )}
              <span>{formatDate(selected.updatedAt)} · {selected.bvid || "无 BV 号"}</span>
            </div>

            <div className="markdown-preview knowledge-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.markdown}</ReactMarkdown>
            </div>
          </>
        )}
      </section>
    </section>
  );
}

function ReaderPage({
  doc,
  isCopying,
  preferences,
  onPreferencesChange,
  onBack,
  onCopy,
  onDownload
}: {
  doc: { title: string; markdown: string; sourceLabel?: string; sourceUrl?: string } | null;
  isCopying: boolean;
  preferences: ReaderPreferences;
  onPreferencesChange: React.Dispatch<React.SetStateAction<ReaderPreferences>>;
  onBack: () => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const theme = readerThemeColors[preferences.theme];
  const readerStyle = {
    "--reader-bg": theme.bg,
    "--reader-fg": theme.fg,
    "--reader-muted": theme.muted,
    "--reader-border": theme.border,
    "--reader-toolbar": theme.toolbar,
    "--reader-font": readerFonts[preferences.fontFamily],
    "--reader-size": `${preferences.fontSize}px`,
    "--reader-line-height": String(preferences.lineHeight),
    "--reader-wallpaper-opacity": String(preferences.wallpaperOpacity)
  } as React.CSSProperties;

  function updatePreference(patch: Partial<ReaderPreferences>) {
    onPreferencesChange((current) => ({ ...current, ...patch }));
  }

  return (
    <section className="reader-page" style={readerStyle}>
      {preferences.wallpaper !== "none" && (
        <div
          className={`reader-wallpaper ${preferences.wallpaper}`}
          style={preferences.wallpaper === "photo" ? { backgroundImage: `url(${lightNovelWallpaper})` } : undefined}
          aria-hidden="true"
        />
      )}

      <div className="reader-toolbar">
        <button className="button button-outline" type="button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回
        </button>
        <div className="reader-title">
          <p className="section-kicker">{doc?.sourceLabel || "Markdown 阅读器"}</p>
          <h2>{doc?.title || "未打开文档"}</h2>
        </div>
        <div className="action-row">
          {doc?.sourceUrl && (
            <a className="button button-outline" href={doc.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} aria-hidden="true" />
              原视频
            </a>
          )}
          <button className="button button-outline" type="button" onClick={() => setShowSettings((value) => !value)}>
            <Settings2 size={16} aria-hidden="true" />
            阅读设置
          </button>
          <button className="button button-secondary" type="button" onClick={onCopy} disabled={!doc?.markdown || isCopying}>
            {isCopying ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}
            {isCopying ? "复制中" : "复制"}
          </button>
          <button className="button button-outline" type="button" onClick={onDownload} disabled={!doc?.markdown}>
            <Download size={16} aria-hidden="true" />
            下载 MD
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="reader-settings">
          <div className="reader-settings-head">
            <strong>阅读器外观</strong>
            <button
              className="button button-outline"
              type="button"
              onClick={() => onPreferencesChange({ ...defaultReaderPreferences })}
            >
              <RotateCcw size={14} aria-hidden="true" />
              恢复默认
            </button>
          </div>
          <div className="reader-setting-row">
            <label>主题</label>
            <div className="segmented" role="group" aria-label="阅读主题">
              {([
                ["light", "明亮"],
                ["sepia", "羊皮纸"],
                ["night", "夜间"],
                ["paper", "纸张"]
              ] as Array<[ReaderPreferences["theme"], string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={preferences.theme === value ? "active" : ""}
                  onClick={() => updatePreference({ theme: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="reader-setting-row">
            <label>字体</label>
            <div className="segmented" role="group" aria-label="阅读字体">
              {([
                ["system", "默认"],
                ["serif", "衬线"],
                ["sans", "黑体"],
                ["mono", "等宽"]
              ] as Array<[ReaderPreferences["fontFamily"], string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={preferences.fontFamily === value ? "active" : ""}
                  onClick={() => updatePreference({ fontFamily: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="reader-setting-row">
            <label>
              字号 <span>{preferences.fontSize}px</span>
            </label>
            <input
              className="range-input"
              type="range"
              min={13}
              max={22}
              step={1}
              value={preferences.fontSize}
              onChange={(event) => updatePreference({ fontSize: Number(event.target.value) })}
            />
          </div>
          <div className="reader-setting-row">
            <label>
              行距 <span>{preferences.lineHeight.toFixed(1)}</span>
            </label>
            <input
              className="range-input"
              type="range"
              min={1.4}
              max={2.2}
              step={0.1}
              value={preferences.lineHeight}
              onChange={(event) => updatePreference({ lineHeight: Number(event.target.value) })}
            />
          </div>
          <div className="reader-setting-row">
            <label>壁纸</label>
            <div className="segmented" role="group" aria-label="阅读壁纸">
              {([
                ["none", "无"],
                ["soft", "柔和"],
                ["photo", "图片"]
              ] as Array<[ReaderPreferences["wallpaper"], string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={preferences.wallpaper === value ? "active" : ""}
                  onClick={() => updatePreference({ wallpaper: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="reader-setting-row">
            <label>
              壁纸透明度 <span>{Math.round(preferences.wallpaperOpacity * 100)}%</span>
            </label>
            <input
              className="range-input"
              type="range"
              min={0.04}
              max={0.5}
              step={0.02}
              value={preferences.wallpaperOpacity}
              disabled={preferences.wallpaper === "none"}
              onChange={(event) => updatePreference({ wallpaperOpacity: Number(event.target.value) })}
            />
          </div>
        </div>
      )}

      <article className="reader-card">
        {doc?.markdown ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.markdown}</ReactMarkdown>
          </div>
        ) : (
          <div className="empty-panel">
            <BookOpen size={40} aria-hidden="true" />
            <h2>阅读器</h2>
            <p>从视频笔记或知识库打开 Markdown，这里会渲染成适合阅读的排版。</p>
          </div>
        )}
      </article>
    </section>
  );
}
function SettingsDialog({
  apiSettings,
  apiKeyInput,
  isSavingSettings,
  onApiKeyInputChange,
  onApiSettingsChange,
  onSave,
  onSelectProvider
}: {
  apiSettings: ApiSettings | null;
  apiKeyInput: string;
  isSavingSettings: boolean;
  onApiKeyInputChange: (value: string) => void;
  onApiSettingsChange: React.Dispatch<React.SetStateAction<ApiSettings | null>>;
  onSave: (event: React.FormEvent) => void;
  onSelectProvider: (provider: ApiSettings["provider"]) => void;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="button button-outline" type="button">
          <Settings2 size={16} aria-hidden="true" />
          API 设置
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-header">
            <div>
              <Dialog.Title>API 设置</Dialog.Title>
              <Dialog.Description>切换 DeepSeek、中转站或 OpenAI 兼容接口。</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="icon-button neutral" type="button" aria-label="关闭设置">
                <X size={16} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {apiSettings ? (
            <form className="settings-form" onSubmit={onSave}>
              <div className="api-provider-grid" role="group" aria-label="API 提供方">
                {apiProviderPresets.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className={apiSettings.provider === provider.id ? "active" : ""}
                    onClick={() => onSelectProvider(provider.id)}
                    disabled={isSavingSettings}
                  >
                    {apiSettings.provider === provider.id && <Check size={14} aria-hidden="true" />}
                    {provider.label}
                  </button>
                ))}
              </div>

              <div className="field">
                <Label.Root className="field-label" htmlFor="api-key">
                  <KeyRound size={15} aria-hidden="true" />
                  API Key
                </Label.Root>
                <input
                  id="api-key"
                  className="input"
                  type="password"
                  value={apiKeyInput}
                  onChange={(event) => onApiKeyInputChange(event.target.value)}
                  placeholder={apiSettings.apiKeySet ? "已保存，留空不更改" : "粘贴 API Key"}
                  disabled={isSavingSettings}
                />
              </div>

              <div className="field">
                <Label.Root className="field-label" htmlFor="base-url">
                  Base URL
                </Label.Root>
                <input
                  id="base-url"
                  className="input"
                  value={apiSettings.baseUrl}
                  onChange={(event) =>
                    onApiSettingsChange((current) =>
                      current ? { ...current, provider: "custom", baseUrl: event.target.value } : current
                    )
                  }
                  placeholder="https://api.deepseek.com 或中转站 /v1 地址"
                  disabled={isSavingSettings}
                />
              </div>

              <div className="settings-row">
                <div className="field">
                  <Label.Root className="field-label" htmlFor="model">
                    模型
                  </Label.Root>
                  <input
                    id="model"
                    className="input"
                    value={apiSettings.model}
                    onChange={(event) =>
                      onApiSettingsChange((current) => (current ? { ...current, model: event.target.value } : current))
                    }
                    placeholder="deepseek-v4-flash"
                    disabled={isSavingSettings}
                  />
                </div>

                <div className="field">
                  <Label.Root className="field-label">接口模式</Label.Root>
                  <Select.Root
                    value={apiSettings.apiMode}
                    onValueChange={(value) =>
                      onApiSettingsChange((current) =>
                        current
                          ? { ...current, apiMode: value as ApiSettings["apiMode"] }
                          : current
                      )
                    }
                    disabled={isSavingSettings}
                  >
                    <Select.Trigger className="select-trigger" aria-label="接口模式">
                      <Select.Value />
                      <Select.Icon>
                        <ChevronDown size={15} aria-hidden="true" />
                      </Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className="select-content" position="popper">
                        <Select.Viewport>
                          <Select.Item className="select-item" value="chat_completions">
                            <Select.ItemText>Chat Completions</Select.ItemText>
                          </Select.Item>
                          <Select.Item className="select-item" value="responses">
                            <Select.ItemText>Responses</Select.ItemText>
                          </Select.Item>
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>
              </div>

              <button className="button button-primary" type="submit" disabled={isSavingSettings}>
                {isSavingSettings ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                {isSavingSettings ? "保存中" : "保存设置"}
              </button>
            </form>
          ) : (
            <p className="empty-state">正在读取设置。</p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
