export const STORAGE_KEYS = Object.freeze({
  appState: "pomodoro-flow.app-state",
  settings: "pomodoro-flow.settings",
  theme: "pomodoro-flow.theme",
});

export const MODES = Object.freeze({
  focus: "focus",
  shortBreak: "short_break",
  longBreak: "long_break",
});

export const TIMER_STATUSES = Object.freeze({
  idle: "idle",
  running: "running",
  paused: "paused",
  transition: "transition",
});

export const MEDIA_STATUSES = Object.freeze({
  idle: "idle",
  loading: "loading",
  ready: "ready",
  playing: "playing",
  paused: "paused",
  ended: "ended",
  error: "error",
});

export const MODE_LABELS = Object.freeze({
  [MODES.focus]: "Focus",
  [MODES.shortBreak]: "Short break",
  [MODES.longBreak]: "Long break",
});

export const DEFAULT_SETTINGS = Object.freeze({
  focusDurationMinutes: 25,
  shortBreakDurationMinutes: 5,
  longBreakDurationMinutes: 30,
  soundNotifications: true,
  browserNotifications: false,
  defaultVolume: 65,
});

export const TRANSITION_SECONDS = 5;
export const TRANSITION_MS = TRANSITION_SECONDS * 1000;
export const SOUNDCLOUD_WIDGET_SCRIPT_SRC = "https://w.soundcloud.com/player/api.js";
export const SOUNDCLOUD_EMBED_BASE = "https://w.soundcloud.com/player/";
export const AUTOPLAY_BLOCKED_MESSAGE =
  "Browser blocked autoplay. Press play once and future timer control will work better.";

export function getModeDurationMinutes(mode, settings = DEFAULT_SETTINGS) {
  switch (mode) {
    case MODES.shortBreak:
      return settings.shortBreakDurationMinutes;
    case MODES.longBreak:
      return settings.longBreakDurationMinutes;
    case MODES.focus:
    default:
      return settings.focusDurationMinutes;
  }
}

export function getModeDurationMs(mode, settings = DEFAULT_SETTINGS) {
  return getModeDurationMinutes(mode, settings) * 60 * 1000;
}
