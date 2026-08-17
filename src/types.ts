export type VideoNotesResult = {
  title: string;
  sourceUrl: string;
  bvid: string;
  cid: number;
  pageTitle: string;
  subtitleLabel: string;
  segmentCount: number;
  blockCount: number;
  truncated: boolean;
  noteStyle: VideoNoteStyle;
  markdown: string;
};

export type VideoFlashcard = {
  question: string;
  answer: string;
  tags: string[];
  source: string;
  difficulty: "基础" | "重点" | "易错" | "拓展";
};

export type VideoNoteStyle = "summary" | "classNotes" | "exam" | "glossary" | "timeline";

export type ApiSettings = {
  provider: "deepseek" | "custom" | "openai";
  apiKeySet: boolean;
  baseUrl: string;
  model: string;
  apiMode: "chat_completions" | "responses";
  envPath?: string;
};

export type SavedVideoNotes = {
  id: string;
  createdAt: string;
  sourceUrl: string;
  noteStyle: VideoNoteStyle;
  notes: VideoNotesResult;
};

export type VideoNotesJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  message: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  result: VideoNotesResult | null;
  error: {
    code: string;
    message: string;
  } | null;
};

export type KnowledgeConcept = {
  name: string;
  explanation: string;
};

export type KnowledgeEntry = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  concepts: KnowledgeConcept[];
  markdown: string;
  sourceUrl: string;
  bvid: string;
  sourceTitle: string;
  noteStyle: VideoNoteStyle;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeListResponse = {
  items: Array<Omit<KnowledgeEntry, "markdown">>;
};
