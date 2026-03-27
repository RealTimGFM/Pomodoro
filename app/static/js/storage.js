import { DEFAULT_SETTINGS, STORAGE_KEYS, TIMER_STATUSES } from "./config.js";
import { createDefaultTimerState, sanitizeTimerState } from "./timer-engine.js";

export function readJSON(storage, key, fallback) {
  try {
    const rawValue = storage.getItem(key);
    if (!rawValue) {
      return fallback;
    }
    return JSON.parse(rawValue);
  } catch (error) {
    return fallback;
  }
}

export function writeJSON(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

export function sanitizeSettings(rawSettings = {}) {
  return {
    focusDurationMinutes: clampInteger(rawSettings.focusDurationMinutes, 1, 180, DEFAULT_SETTINGS.focusDurationMinutes),
    shortBreakDurationMinutes: clampInteger(
      rawSettings.shortBreakDurationMinutes,
      1,
      90,
      DEFAULT_SETTINGS.shortBreakDurationMinutes,
    ),
    longBreakDurationMinutes: clampInteger(rawSettings.longBreakDurationMinutes, 1, 180, DEFAULT_SETTINGS.longBreakDurationMinutes),
    soundNotifications: typeof rawSettings.soundNotifications === "boolean" ? rawSettings.soundNotifications : DEFAULT_SETTINGS.soundNotifications,
    browserNotifications:
      typeof rawSettings.browserNotifications === "boolean"
        ? rawSettings.browserNotifications
        : DEFAULT_SETTINGS.browserNotifications,
    defaultVolume: clampInteger(rawSettings.defaultVolume, 0, 100, DEFAULT_SETTINGS.defaultVolume),
  };
}

export function loadSettings(storage = window.localStorage) {
  return sanitizeSettings(readJSON(storage, STORAGE_KEYS.settings, DEFAULT_SETTINGS));
}

export function saveSettings(storage = window.localStorage, settings) {
  writeJSON(storage, STORAGE_KEYS.settings, sanitizeSettings(settings));
}

export function createDefaultMediaState(settings = DEFAULT_SETTINGS) {
  return {
    selection: null,
    title: "",
    sourceTitle: "",
    channelTitle: "",
    currentTime: 0,
    playlistIndex: 0,
    currentVideoId: "",
    volume: settings.defaultVolume,
    status: TIMER_STATUSES.idle,
    shouldResumeOnFocus: false,
  };
}

export function createDefaultAppState(settings = DEFAULT_SETTINGS) {
  return {
    version: 1,
    timer: createDefaultTimerState(settings),
    tasks: [],
    activeTaskId: null,
    media: createDefaultMediaState(settings),
  };
}

export function sanitizeAppState(rawState = {}, settings = DEFAULT_SETTINGS) {
  const tasks = Array.isArray(rawState.tasks) ? rawState.tasks.map(sanitizeTask).filter(Boolean) : [];
  const activeTaskId = tasks.some((task) => task.id === rawState.activeTaskId && !task.done) ? rawState.activeTaskId : null;

  return {
    version: 1,
    timer: sanitizeTimerState(rawState.timer, settings),
    tasks,
    activeTaskId,
    media: sanitizeMediaState(rawState.media, settings),
  };
}

export function loadAppState(storage = window.localStorage, settings = DEFAULT_SETTINGS) {
  return sanitizeAppState(readJSON(storage, STORAGE_KEYS.appState, createDefaultAppState(settings)), settings);
}

export function saveAppState(storage = window.localStorage, appState, settings = DEFAULT_SETTINGS) {
  writeJSON(storage, STORAGE_KEYS.appState, sanitizeAppState(appState, settings));
}

export function loadTheme(storage = window.localStorage) {
  const value = storage.getItem(STORAGE_KEYS.theme);
  return value === "light" || value === "dark" ? value : "system";
}

export function saveTheme(storage = window.localStorage, theme) {
  if (theme === "light" || theme === "dark") {
    storage.setItem(STORAGE_KEYS.theme, theme);
    return;
  }
  storage.removeItem(STORAGE_KEYS.theme);
}

export function sanitizeTask(rawTask) {
  if (!rawTask || typeof rawTask !== "object") {
    return null;
  }

  const title = `${rawTask.title || ""}`.trim();
  if (!title) {
    return null;
  }

  return {
    id: typeof rawTask.id === "string" && rawTask.id ? rawTask.id : generateId("task"),
    title: title.slice(0, 120),
    done: Boolean(rawTask.done),
    createdAt: Number.isFinite(rawTask.createdAt) ? rawTask.createdAt : Date.now(),
  };
}

export function sanitizeMediaState(rawMedia = {}, settings = DEFAULT_SETTINGS) {
  const fallback = createDefaultMediaState(settings);
  return {
    selection: sanitizeSelection(rawMedia.selection),
    title: typeof rawMedia.title === "string" ? rawMedia.title : "",
    sourceTitle: typeof rawMedia.sourceTitle === "string" ? rawMedia.sourceTitle : "",
    channelTitle: typeof rawMedia.channelTitle === "string" ? rawMedia.channelTitle : "",
    currentTime: Number.isFinite(rawMedia.currentTime) ? Math.max(0, rawMedia.currentTime) : 0,
    playlistIndex: Number.isFinite(rawMedia.playlistIndex) ? Math.max(0, Math.floor(rawMedia.playlistIndex)) : 0,
    currentVideoId: typeof rawMedia.currentVideoId === "string" ? rawMedia.currentVideoId : "",
    volume: clampInteger(rawMedia.volume, 0, 100, fallback.volume),
    status: typeof rawMedia.status === "string" ? rawMedia.status : TIMER_STATUSES.idle,
    shouldResumeOnFocus: Boolean(rawMedia.shouldResumeOnFocus),
  };
}

function sanitizeSelection(rawSelection) {
  if (!rawSelection || typeof rawSelection !== "object") {
    return null;
  }

  if (rawSelection.provider === "url" && rawSelection.mediaType === "audio_url") {
    const sourceUrl = typeof rawSelection.sourceUrl === "string" ? rawSelection.sourceUrl.trim() : "";
    if (!sourceUrl) {
      return null;
    }
    return {
      provider: "url",
      mediaType: "audio_url",
      sourceUrl,
      title: typeof rawSelection.title === "string" ? rawSelection.title : "",
    };
  }

  if (
    rawSelection.provider === "youtube" &&
    (rawSelection.mediaType === "youtube_video" || rawSelection.mediaType === "youtube_playlist")
  ) {
    const sourceId = typeof rawSelection.sourceId === "string" ? rawSelection.sourceId.trim() : "";
    const normalizedUrl =
      typeof rawSelection.normalizedUrl === "string" && rawSelection.normalizedUrl.trim()
        ? rawSelection.normalizedUrl.trim()
        : typeof rawSelection.sourceUrl === "string"
          ? rawSelection.sourceUrl.trim()
          : "";

    if (!sourceId || !normalizedUrl) {
      return null;
    }

    const originalUrl =
      typeof rawSelection.originalUrl === "string" && rawSelection.originalUrl.trim()
        ? rawSelection.originalUrl.trim()
        : normalizedUrl;

    return {
      provider: "youtube",
      mediaType: rawSelection.mediaType,
      sourceId,
      sourceUrl: normalizedUrl,
      normalizedUrl,
      originalUrl,
      title: typeof rawSelection.title === "string" ? rawSelection.title : "",
      channelTitle: typeof rawSelection.channelTitle === "string" ? rawSelection.channelTitle : "",
    };
  }

  // Local file objects cannot survive a page refresh - clear them gracefully.
  // home.js detects this condition and shows a user-facing message.
  return null;
}

function clampInteger(value, minimum, maximum, fallback) {
  const numericValue = Number.parseInt(value, 10);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, numericValue));
}

function generateId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
