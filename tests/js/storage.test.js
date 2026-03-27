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

test("sanitizeAppState removes invalid tasks and unknown media providers", () => {
  const appState = sanitizeAppState({
    tasks: [{ title: " Valid task " }, { title: "   " }],
    activeTaskId: "missing-id",
    media: {
      selection: {
        provider: "spotify",
        mediaType: "track",
        sourceId: "123",
      },
    },
  });

  assert.equal(appState.tasks.length, 1);
  assert.equal(appState.activeTaskId, null);
  assert.equal(appState.media.selection, null);
});

test("sanitizeAppState restores a valid audio_url selection", () => {
  const appState = sanitizeAppState({
    media: {
      selection: {
        provider: "url",
        mediaType: "audio_url",
        sourceUrl: "https://example.com/track.mp3",
        title: "My track",
      },
      title: "My track",
      volume: 70,
      shouldResumeOnFocus: true,
    },
  });

  assert.ok(appState.media.selection !== null);
  assert.equal(appState.media.selection.provider, "url");
  assert.equal(appState.media.selection.mediaType, "audio_url");
  assert.equal(appState.media.selection.sourceUrl, "https://example.com/track.mp3");
  assert.equal(appState.media.selection.title, "My track");
  assert.equal(appState.media.volume, 70);
  assert.equal(appState.media.shouldResumeOnFocus, true);
});

test("sanitizeAppState restores a valid youtube video selection", () => {
  const appState = sanitizeAppState({
    media: {
      selection: {
        provider: "youtube",
        mediaType: "youtube_video",
        sourceId: "dQw4w9WgXcQ",
        sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        normalizedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title: "YouTube video",
      },
      title: "Current track",
      channelTitle: "Example channel",
      currentVideoId: "dQw4w9WgXcQ",
      volume: 55,
    },
  });

  assert.ok(appState.media.selection !== null);
  assert.equal(appState.media.selection.provider, "youtube");
  assert.equal(appState.media.selection.mediaType, "youtube_video");
  assert.equal(appState.media.selection.sourceId, "dQw4w9WgXcQ");
  assert.equal(appState.media.channelTitle, "Example channel");
  assert.equal(appState.media.currentVideoId, "dQw4w9WgXcQ");
});

test("sanitizeAppState restores a valid youtube playlist selection", () => {
  const appState = sanitizeAppState({
    media: {
      selection: {
        provider: "youtube",
        mediaType: "youtube_playlist",
        sourceId: "PL1234567890A",
        sourceUrl: "https://www.youtube.com/playlist?list=PL1234567890A",
        normalizedUrl: "https://www.youtube.com/playlist?list=PL1234567890A",
        title: "Playlist",
      },
      playlistIndex: 3,
    },
  });

  assert.ok(appState.media.selection !== null);
  assert.equal(appState.media.selection.mediaType, "youtube_playlist");
  assert.equal(appState.media.selection.sourceId, "PL1234567890A");
  assert.equal(appState.media.playlistIndex, 3);
});

test("sanitizeAppState clears local_file selection after refresh", () => {
  const appState = sanitizeAppState({
    media: {
      selection: {
        provider: "local",
        mediaType: "local_file",
        title: "song.mp3",
      },
      title: "song.mp3",
    },
  });

  // File objects cannot survive localStorage — selection must be null.
  assert.equal(appState.media.selection, null);
});

test("sanitizeAppState audio_url with empty sourceUrl returns null selection", () => {
  const appState = sanitizeAppState({
    media: {
      selection: {
        provider: "url",
        mediaType: "audio_url",
        sourceUrl: "   ",
        title: "Empty URL",
      },
    },
  });

  assert.equal(appState.media.selection, null);
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
  assert.equal(state.media.selection, null);
  assert.equal(state.media.channelTitle, "");
  assert.equal(state.media.playlistIndex, 0);
});
