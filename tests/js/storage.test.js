import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultAppState,
  loadTheme,
  sanitizeAppState,
  sanitizeSettings,
  saveTheme,
} from "../../app/static/js/storage.js";

class FakeStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, value);
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

test("sanitizeSettings clamps invalid numeric values", () => {
  const settings = sanitizeSettings({
    focusDurationMinutes: "500",
    shortBreakDurationMinutes: "0",
    longBreakDurationMinutes: "abc",
    defaultVolume: "-1",
    soundNotifications: false,
    browserNotifications: true,
  });

  assert.equal(settings.focusDurationMinutes, 180);
  assert.equal(settings.shortBreakDurationMinutes, 1);
  assert.equal(settings.longBreakDurationMinutes, 30);
  assert.equal(settings.defaultVolume, 0);
  assert.equal(settings.soundNotifications, false);
  assert.equal(settings.browserNotifications, true);
});

test("sanitizeAppState removes invalid tasks and keeps media state local-first", () => {
  const appState = sanitizeAppState({
    tasks: [{ title: " Valid task " }, { title: "   " }],
    activeTaskId: "missing-id",
    media: {
      url: "https://example.com/not-soundcloud",
      kind: "mixtape",
      status: "playing",
      volume: 101,
    },
  });

  assert.equal(appState.tasks.length, 1);
  assert.equal(appState.activeTaskId, null);
  assert.equal(appState.media.url, "https://example.com/not-soundcloud");
  assert.equal(appState.media.kind, "unknown");
  assert.equal(appState.media.volume, 100);
});

test("theme helpers persist a valid theme value", () => {
  const storage = new FakeStorage();
  saveTheme(storage, "dark");

  assert.equal(loadTheme(storage), "dark");

  saveTheme(storage, "system");
  assert.equal(loadTheme(storage), "system");
});

test("createDefaultAppState uses the default timer and media skeleton", () => {
  const state = createDefaultAppState();

  assert.equal(state.tasks.length, 0);
  assert.equal(state.activeTaskId, null);
  assert.equal(state.media.url, "");
  assert.equal(state.media.status, "idle");
});
