import { DEFAULT_SETTINGS, DEFAULT_UI_STATE, MEDIA_STATUSES, STORAGE_KEYS } from "./config.js";
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
    url: "",
    normalizedUrl: "",
    kind: "unknown",
    title: "",
    author: "",
    currentPositionMs: 0,
    currentIndex: 0,
    durationMs: 0,
    volume: settings.defaultVolume,
    status: MEDIA_STATUSES.idle,
    shouldResumeOnFocus: false,
    autoplayBlocked: false,
    canGoNext: false,
    canGoPrevious: false,
    lastError: "",
    loadedAt: null,
  };
}

export function createDefaultAppState(settings = DEFAULT_SETTINGS) {
  return {
    version: 2,
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
    version: 2,
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
  return value === "light" || value === "dark" || value === "study-time" ? value : "system";
}

export function saveTheme(storage = window.localStorage, theme) {
  if (theme === "light" || theme === "dark" || theme === "study-time") {
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
    url: typeof rawMedia.url === "string" ? rawMedia.url.trim().slice(0, 500) : "",
    normalizedUrl: typeof rawMedia.normalizedUrl === "string" ? rawMedia.normalizedUrl.trim().slice(0, 500) : "",
    kind: ["track", "playlist", "unknown"].includes(rawMedia.kind) ? rawMedia.kind : fallback.kind,
    title: typeof rawMedia.title === "string" ? rawMedia.title : "",
    author: typeof rawMedia.author === "string" ? rawMedia.author : "",
    currentPositionMs: Number.isFinite(rawMedia.currentPositionMs) ? Math.max(0, rawMedia.currentPositionMs) : 0,
    currentIndex: Number.isFinite(rawMedia.currentIndex) ? Math.max(0, Math.floor(rawMedia.currentIndex)) : 0,
    durationMs: Number.isFinite(rawMedia.durationMs) ? Math.max(0, rawMedia.durationMs) : 0,
    volume: clampInteger(rawMedia.volume, 0, 100, fallback.volume),
    status: Object.values(MEDIA_STATUSES).includes(rawMedia.status) ? rawMedia.status : MEDIA_STATUSES.idle,
    shouldResumeOnFocus: Boolean(rawMedia.shouldResumeOnFocus),
    autoplayBlocked: Boolean(rawMedia.autoplayBlocked),
    canGoNext: Boolean(rawMedia.canGoNext),
    canGoPrevious: Boolean(rawMedia.canGoPrevious),
    lastError: typeof rawMedia.lastError === "string" ? rawMedia.lastError : "",
    loadedAt: Number.isFinite(rawMedia.loadedAt) ? rawMedia.loadedAt : null,
  };
}

export function sanitizeUiState(rawState = {}) {
  const rawDrawers = rawState.drawers && typeof rawState.drawers === "object" ? rawState.drawers : {};
  const sanitizeDrawer = (name) => {
    const fallback = DEFAULT_UI_STATE.drawers[name];
    const rawDrawer = rawDrawers[name] && typeof rawDrawers[name] === "object" ? rawDrawers[name] : {};
    const pinned = typeof rawDrawer.pinned === "boolean" ? rawDrawer.pinned : fallback.pinned;
    const open = pinned ? true : typeof rawDrawer.open === "boolean" ? rawDrawer.open : fallback.open;

    return {
      open,
      pinned,
    };
  };

  return {
    onboardingCompleted:
      typeof rawState.onboardingCompleted === "boolean"
        ? rawState.onboardingCompleted
        : DEFAULT_UI_STATE.onboardingCompleted,
    doneTasksExpanded:
      typeof rawState.doneTasksExpanded === "boolean" ? rawState.doneTasksExpanded : DEFAULT_UI_STATE.doneTasksExpanded,
    musicEmbedExpanded:
      typeof rawState.musicEmbedExpanded === "boolean" ? rawState.musicEmbedExpanded : DEFAULT_UI_STATE.musicEmbedExpanded,
    drawers: {
      music: sanitizeDrawer("music"),
      tasks: sanitizeDrawer("tasks"),
    },
  };
}

export function loadUiState(storage = window.localStorage) {
  return sanitizeUiState(readJSON(storage, STORAGE_KEYS.ui, DEFAULT_UI_STATE));
}

export function saveUiState(storage = window.localStorage, uiState) {
  writeJSON(storage, STORAGE_KEYS.ui, sanitizeUiState(uiState));
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
