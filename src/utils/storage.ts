import type { SavedVideoNotes } from "../types";

const VIDEO_NOTES_STORAGE_KEY = "learning-card-maker:video-notes-history";
const MAX_HISTORY = 12;

export function loadVideoNotesHistory(): SavedVideoNotes[] {
  try {
    const raw = window.localStorage.getItem(VIDEO_NOTES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveVideoNotesHistory(items: SavedVideoNotes[]) {
  window.localStorage.setItem(VIDEO_NOTES_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

export function addVideoNotesHistoryItem(item: SavedVideoNotes): SavedVideoNotes[] {
  const next = [item, ...loadVideoNotesHistory().filter((existing) => existing.id !== item.id)].slice(0, MAX_HISTORY);
  saveVideoNotesHistory(next);
  return next;
}
