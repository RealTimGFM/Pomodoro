import { MODES, MODE_LABELS, STORAGE_KEYS, TIMER_STATUSES } from "./config.js";
import { MediaControllerRouter, isPlausibleAudioUrl, isYouTubeMediaSelection } from "./media-controller.js";
import { playNotificationSound, sendBrowserNotification } from "./notifications.js";
import {
  finishTimer,
  getDisplayMs,
  getModeDurationMs,
  getTimerPresentation,
  pauseTimer,
  resetTimer,
  resumeTimer,
  setMode,
  setNextBreakMode,
  skipTimer,
  startTimer,
  syncTimer,
} from "./timer-engine.js";
import {
  createDefaultMediaState,
  loadAppState,
  loadSettings,
  readJSON,
  saveAppState,
  sanitizeTask,
} from "./storage.js";

let settings = loadSettings(window.localStorage);
const state = loadAppState(window.localStorage, settings);
let messageTimeoutId = null;
let lastMediaPersistAt = 0;
let mediaNotice = "";

const elements = {
  currentMode: document.getElementById("current-mode"),
  currentTask: document.getElementById("current-task"),
  nowPlaying: document.getElementById("now-playing"),
  modeSelector: document.getElementById("mode-selector"),
  nextBreakSelector: document.getElementById("next-break-selector"),
  progressRing: document.getElementById("progress-ring"),
  timerLabel: document.getElementById("timer-label"),
  timerHint: document.getElementById("timer-hint"),
  timeDisplay: document.getElementById("time-display"),
  countdownBanner: document.getElementById("countdown-banner"),
  countdownSeconds: document.getElementById("countdown-seconds"),
  sessionCount: document.getElementById("session-count"),
  nextBreakLabel: document.getElementById("next-break-label"),
  timerStatus: document.getElementById("timer-status"),
  startButton: document.getElementById("start-button"),
  pauseButton: document.getElementById("pause-button"),
  resumeButton: document.getElementById("resume-button"),
  resetButton: document.getElementById("reset-button"),
  skipButton: document.getElementById("skip-button"),
  finishButton: document.getElementById("finish-button"),
  appMessage: document.getElementById("app-message"),
  mediaUrlForm: document.getElementById("media-url-form"),
  mediaUrlInput: document.getElementById("media-url-input"),
  localFileInput: document.getElementById("local-file-input"),
  mediaSourceTitle: document.getElementById("media-source-title"),
  clearMediaButton: document.getElementById("clear-media-button"),
  youtubePlayerShell: document.getElementById("youtube-player-shell"),
  playerPlaceholder: document.getElementById("player-placeholder"),
  volumeRange: document.getElementById("volume-range"),
  volumeValue: document.getElementById("volume-value"),
  audioStatus: document.getElementById("audio-status"),
  taskForm: document.getElementById("task-form"),
  taskInput: document.getElementById("task-input"),
  taskList: document.getElementById("task-list"),
  taskEmptyState: document.getElementById("task-empty-state"),
  activeTaskSummary: document.getElementById("active-task-summary"),
};

const mediaController = new MediaControllerRouter({
  audioElementId: "audio-player",
  youtubeElementId: "youtube-player",
  youtubePlaceholderElement: elements.playerPlaceholder,
  onSnapshot: (snapshot) => {
    handleMediaSnapshot(snapshot);
  },
  onError: (message) => {
    setMessage(message);
  },
});

function persistState() {
  saveAppState(window.localStorage, state, settings);
}

function applySettingsToIdleTimer() {
  if (state.timer.status === TIMER_STATUSES.idle) {
    state.timer.remainingMs = getModeDurationMs(state.timer.mode, settings);
  }
  if (!state.media.selection) {
    state.media.volume = settings.defaultVolume;
  }
}

function getActiveTask() {
  return state.tasks.find((task) => task.id === state.activeTaskId) || null;
}

function formatClock(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function setMessage(message, timeoutMs = 4200) {
  elements.appMessage.textContent = message || "";
  if (messageTimeoutId) {
    window.clearTimeout(messageTimeoutId);
  }
  if (message) {
    messageTimeoutId = window.setTimeout(() => {
      elements.appMessage.textContent = "";
    }, timeoutMs);
  }
}

function escapeHtml(value) {
  return `${value || ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTimer() {
  const now = Date.now();
  const presentation = getTimerPresentation(state.timer, now, settings);
  const activeTask = getActiveTask();
  const nowPlaying = state.media.title || state.media.sourceTitle || "Timer only";
  const nextBreakLabel = MODE_LABELS[state.timer.nextBreakMode] || "Short break";
  const sessionDurationMs =
    state.timer.status === TIMER_STATUSES.transition ? 5000 : getModeDurationMs(state.timer.mode, settings);
  const remainingMs = getDisplayMs(state.timer, now, settings);

  elements.currentMode.textContent = presentation.modeLabel;
  elements.currentTask.textContent = activeTask ? activeTask.title : "No active task selected";
  elements.nowPlaying.textContent = nowPlaying;
  elements.sessionCount.textContent = `${state.timer.sessionsCompleted}`;
  elements.nextBreakLabel.textContent = nextBreakLabel;
  elements.timerStatus.textContent = presentation.statusLabel;
  elements.timeDisplay.textContent = formatClock(presentation.displayMs);
  elements.timeDisplay.setAttribute("datetime", `PT${Math.floor(remainingMs / 60000)}M${Math.ceil((remainingMs % 60000) / 1000)}S`);
  elements.progressRing.style.setProperty("--progress", `${presentation.progress}`);

  elements.timerLabel.textContent = getTimerLabelText();
  elements.timerHint.textContent = getTimerHintText(sessionDurationMs, remainingMs);

  elements.countdownBanner.classList.toggle("hidden", !presentation.isTransition);
  elements.countdownSeconds.textContent = String(Math.max(0, Math.ceil(presentation.displayMs / 1000)));

  for (const button of elements.modeSelector.querySelectorAll("[data-mode]")) {
    const isActive = button.dataset.mode === state.timer.mode;
    button.classList.toggle("is-active", isActive);
    button.disabled = state.timer.status === TIMER_STATUSES.running || state.timer.status === TIMER_STATUSES.transition;
  }

  for (const button of elements.nextBreakSelector.querySelectorAll("[data-next-break]")) {
    const isActive = button.dataset.nextBreak === state.timer.nextBreakMode;
    button.classList.toggle("is-active", isActive);
  }

  elements.startButton.disabled = state.timer.status === TIMER_STATUSES.running || state.timer.status === TIMER_STATUSES.transition;
  elements.pauseButton.disabled = state.timer.status !== TIMER_STATUSES.running;
  elements.resumeButton.disabled = state.timer.status !== TIMER_STATUSES.paused;
  elements.resetButton.disabled = false;
  elements.skipButton.disabled = state.timer.status === TIMER_STATUSES.transition;
  elements.finishButton.textContent = activeTask ? "Finish task" : "Done for now";
}

function getTimerLabelText() {
  if (state.timer.status === TIMER_STATUSES.transition && state.timer.pendingMode) {
    return `${MODE_LABELS[state.timer.pendingMode]} begins in a moment.`;
  }
  if (state.timer.mode === MODES.focus) {
    return state.timer.status === TIMER_STATUSES.paused ? "Paused, ready when you are." : "Stay with one thing.";
  }
  if (state.timer.mode === MODES.longBreak) {
    return "Take the longer reset when it actually helps.";
  }
  return "Let the break actually be a break.";
}

function getTimerHintText(sessionDurationMs, remainingMs) {
  if (state.timer.status === TIMER_STATUSES.transition && state.timer.pendingMode) {
    return `The next ${MODE_LABELS[state.timer.pendingMode].toLowerCase()} will begin after the countdown.`;
  }

  const elapsedMinutes = Math.max(0, Math.round((sessionDurationMs - remainingMs) / 60000));
  const activeTask = getActiveTask();
  if (activeTask) {
    return `${activeTask.title} is the active task for this cycle. ${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} in so far.`;
  }

  return "The timer stays fully usable even when no task or media is selected.";
}

function renderTasks() {
  const activeTask = getActiveTask();
  elements.activeTaskSummary.textContent = activeTask ? activeTask.title : "No task selected";
  elements.taskEmptyState.classList.toggle("hidden", state.tasks.length > 0);

  elements.taskList.innerHTML = state.tasks
    .map((task) => {
      const isActive = task.id === state.activeTaskId;
      return `
        <li class="task-item ${isActive ? "is-active" : ""} ${task.done ? "is-done" : ""}" data-task-id="${escapeHtml(task.id)}">
          <div class="task-item__main">
            <input class="task-checkbox" type="checkbox" data-task-checkbox ${task.done ? "checked" : ""} aria-label="Mark ${escapeHtml(task.title)} done">
            <span class="task-item__title">${escapeHtml(task.title)}</span>
          </div>
          <div class="task-item__actions">
            <button class="ghost-button ghost-button--compact" type="button" data-task-action="activate" ${task.done ? "disabled" : ""}>
              ${isActive ? "Active" : "Focus"}
            </button>
            <button class="ghost-button ghost-button--compact" type="button" data-task-action="remove">Remove</button>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderMediaPanel() {
  const selection = state.media.selection;
  elements.mediaSourceTitle.textContent = state.media.title || state.media.sourceTitle || (selection ? "Media loaded" : "No media selected");
  elements.volumeRange.value = `${state.media.volume}`;
  elements.volumeValue.textContent = `${state.media.volume}%`;
  elements.clearMediaButton.disabled = !selection;
  elements.youtubePlayerShell.classList.toggle("hidden", !isYouTubeMediaSelection(selection));
  elements.audioStatus.textContent = mediaNotice;
}

function renderAll() {
  renderTimer();
  renderTasks();
  renderMediaPanel();
}

function handleMediaSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  const activePlaybackDuringFocus =
    ["playing", "buffering"].includes(snapshot.status) &&
    state.timer.mode === MODES.focus &&
    state.timer.status === TIMER_STATUSES.running;
  const manualPauseDuringFocus =
    snapshot.status === "paused" && state.timer.mode === MODES.focus && state.timer.status === TIMER_STATUSES.running;

  state.media = {
    ...state.media,
    ...snapshot,
    selection: snapshot.selection ?? state.media.selection,
    volume: Number.isFinite(snapshot.volume) ? Math.round(snapshot.volume) : state.media.volume,
    shouldResumeOnFocus: manualPauseDuringFocus ? false : activePlaybackDuringFocus ? true : state.media.shouldResumeOnFocus,
  };

  renderTimer();
  renderMediaPanel();

  const now = Date.now();
  if (now - lastMediaPersistAt > 1400) {
    persistState();
    lastMediaPersistAt = now;
  }
}

function pauseMediaForBreak() {
  if (!state.media.selection) {
    return;
  }

  const beforePause = mediaController.captureSnapshot();
  mediaController.pause();
  const afterPause = mediaController.captureSnapshot();

  state.media = {
    ...state.media,
    ...afterPause,
    selection: state.media.selection,
    shouldResumeOnFocus: ["playing", "buffering"].includes(beforePause?.status),
  };
  persistState();
  renderMediaPanel();
  renderTimer();
}

async function resumeMediaForFocus({ force = false } = {}) {
  if (!state.media.selection) {
    return;
  }

  if (!force && !state.media.shouldResumeOnFocus) {
    return;
  }

  const snapshot = await mediaController.resume(state.media);
  if (snapshot) {
    state.media = {
      ...state.media,
      ...snapshot,
      selection: state.media.selection,
      shouldResumeOnFocus: false,
    };
    persistState();
    renderMediaPanel();
    renderTimer();
  }
}

async function handleTimerEvents(events) {
  if (!events.length) {
    return;
  }

  for (const event of events) {
    const isFreshNotification = Date.now() - event.at < 12_000;

    if (event.type === "transition-started" && !event.manual && isFreshNotification) {
      playNotificationSound(settings.soundNotifications);
      sendBrowserNotification(
        settings,
        `${MODE_LABELS[event.fromMode]} complete`,
        `${MODE_LABELS[event.toMode]} starts in 5 seconds.`,
      );

      if (event.fromMode === MODES.focus) {
        pauseMediaForBreak();
      }
    }

    if (event.type === "session-started") {
      if (event.mode === MODES.focus) {
        await resumeMediaForFocus();
      } else {
        pauseMediaForBreak();
      }
    }
  }
}

async function applyTimerResult(result, message) {
  state.timer = result.timer;
  await handleTimerEvents(result.events);
  persistState();
  renderTimer();
  if (message) {
    setMessage(message);
  }
}

function isSameMediaSelection(nextSelection, currentSelection) {
  if (!nextSelection || !currentSelection || nextSelection.mediaType !== currentSelection.mediaType) {
    return false;
  }

  if (nextSelection.mediaType === "audio_url") {
    return nextSelection.sourceUrl === currentSelection.sourceUrl;
  }

  if (nextSelection.mediaType === "youtube_video" || nextSelection.mediaType === "youtube_playlist") {
    return nextSelection.sourceId === currentSelection.sourceId;
  }

  return false;
}

async function selectMedia(selection, initialMediaState = null) {
  const timerIsRunningFocus = state.timer.mode === MODES.focus && state.timer.status === TIMER_STATUSES.running;
  const shouldAutoplay = true; const volume = Number.isFinite(state.media.volume) ? state.media.volume : settings.defaultVolume;
  const snapshot = await mediaController.load(selection, {
    autoplay: shouldAutoplay,
    resumeState: isSameMediaSelection(selection, state.media.selection) ? state.media : initialMediaState,
    volume,
  });

  state.media = {
    ...createDefaultMediaState(settings),
    ...snapshot,
    selection,
    sourceTitle: selection.title || snapshot?.sourceTitle || initialMediaState?.sourceTitle || "",
    title: snapshot?.title || initialMediaState?.title || selection.title || "",
    channelTitle: snapshot?.channelTitle || initialMediaState?.channelTitle || selection.channelTitle || "",
    playlistIndex: Number.isFinite(snapshot?.playlistIndex)
      ? snapshot.playlistIndex
      : Number.isFinite(initialMediaState?.playlistIndex)
        ? initialMediaState.playlistIndex
        : 0,
    currentVideoId: snapshot?.currentVideoId || initialMediaState?.currentVideoId || "",
    volume,
    shouldResumeOnFocus: true,
  };

  mediaNotice = "";
  if (selection.mediaType !== "local_file") {
    elements.localFileInput.value = "";
  }

  persistState();
  renderMediaPanel();
  renderTimer();
  setMessage(
    timerIsRunningFocus
      ? "Media loaded and playing for the current focus session."
      : "Media loaded and playing. It will still pause automatically during breaks."
  );
}

async function loadDirectAudioUrl(rawUrl) {
  const url = rawUrl.trim();
  if (!url) {
    setMessage("Paste a music link first.");
    return;
  }

  const filename = (() => {
    try {
      return new URL(url).pathname.split("/").pop().split("?")[0] || "Audio track";
    } catch {
      return "Audio track";
    }
  })();

  const selection = {
    provider: "url",
    mediaType: "audio_url",
    sourceUrl: url,
    title: filename,
  };

  try {
    await selectMedia(selection);
    elements.mediaUrlInput.value = "";
  } catch (error) {
    setMessage(error.message || "That URL could not be loaded as audio.");
  }
}

async function resolveAndLoadYouTubeUrl(rawUrl) {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    setMessage("Paste a music link first.");
    return;
  }

  try {
    const response = await fetch(`/api/media/resolve?url=${encodeURIComponent(trimmedUrl)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "That link could not be used.");
    }

    await selectMedia(payload.media, payload.media);
    elements.mediaUrlInput.value = "";
  } catch (error) {
    setMessage(error.message || "That link could not be used.");
  }
}

async function loadMediaUrl(rawUrl) {
  const url = rawUrl.trim();
  if (!url) {
    setMessage("Paste a music link first.");
    return;
  }

  if (isPlausibleAudioUrl(url)) {
    await loadDirectAudioUrl(url);
    return;
  }

  await resolveAndLoadYouTubeUrl(url);
}

async function loadLocalAudioFile(file) {
  if (!file) {
    return;
  }

  const selection = {
    provider: "local",
    mediaType: "local_file",
    file,
    title: file.name,
  };

  try {
    await selectMedia(selection);
  } catch (error) {
    setMessage(error.message || "The local file could not be loaded.");
  }
}

function addTask(rawTitle) {
  const task = sanitizeTask({ title: rawTitle });
  if (!task) {
    setMessage("Enter a task title first.");
    return;
  }

  state.tasks.unshift(task);
  if (!state.activeTaskId) {
    state.activeTaskId = task.id;
  }

  persistState();
  renderTasks();
  renderTimer();
  setMessage("Task added.");
}

function toggleTask(taskId, isDone) {
  state.tasks = state.tasks.map((task) => (task.id === taskId ? { ...task, done: isDone } : task));
  if (isDone && state.activeTaskId === taskId) {
    state.activeTaskId = null;
  }
  persistState();
  renderTasks();
  renderTimer();
}

function activateTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId && !item.done);
  if (!task) {
    return;
  }
  state.activeTaskId = taskId;
  persistState();
  renderTasks();
  renderTimer();
  setMessage(`"${task.title}" is now the active task.`);
}

function removeTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  state.tasks = state.tasks.filter((item) => item.id !== taskId);
  if (state.activeTaskId === taskId) {
    state.activeTaskId = null;
  }
  persistState();
  renderTasks();
  renderTimer();
  if (task) {
    setMessage(`Removed "${task.title}".`);
  }
}

async function finishCurrentTask() {
  const activeTask = getActiveTask();
  if (activeTask) {
    toggleTask(activeTask.id, true);
  }

  const result = finishTimer(state.timer, Date.now(), settings);
  state.timer = result.timer;

  if (state.media.selection) {
    mediaController.pause();
    const snapshot = mediaController.captureSnapshot();
    state.media = {
      ...state.media,
      ...snapshot,
      selection: state.media.selection,
      shouldResumeOnFocus: false,
    };
  }

  persistState();
  renderAll();
  setMessage(activeTask ? "Task marked complete and timer cycle finished." : "Timer cycle finished.");
}

async function tick() {
  const next = syncTimer(state.timer, Date.now(), settings);
  const stateChanged =
    next.timer.status !== state.timer.status ||
    next.timer.mode !== state.timer.mode ||
    next.timer.endsAt !== state.timer.endsAt ||
    next.timer.transitionEndsAt !== state.timer.transitionEndsAt ||
    next.timer.sessionsCompleted !== state.timer.sessionsCompleted;

  if (!stateChanged && !next.events.length) {
    renderTimer();
    return;
  }

  state.timer = next.timer;
  await handleTimerEvents(next.events);
  persistState();
  renderTimer();
}

function bindEvents() {
  elements.modeSelector.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) {
      return;
    }
    const result = setMode(state.timer, button.dataset.mode, Date.now(), settings);
    state.timer = result.timer;
    persistState();
    renderTimer();
  });

  elements.nextBreakSelector.addEventListener("click", (event) => {
    const button = event.target.closest("[data-next-break]");
    if (!button) {
      return;
    }
    const result = setNextBreakMode(state.timer, button.dataset.nextBreak);
    state.timer = result.timer;
    persistState();
    renderTimer();
  });

  elements.startButton.addEventListener("click", async () => {
    await applyTimerResult(startTimer(state.timer, Date.now(), settings), "Timer started.");
    if (state.timer.mode === MODES.focus && state.media.selection && state.media.shouldResumeOnFocus) {
      await resumeMediaForFocus({ force: true });
    }
  });

  elements.pauseButton.addEventListener("click", async () => {
    await applyTimerResult(pauseTimer(state.timer, Date.now(), settings), "Timer paused.");
  });

  elements.resumeButton.addEventListener("click", async () => {
    await applyTimerResult(resumeTimer(state.timer, Date.now(), settings), "Timer resumed.");
    if (state.timer.mode === MODES.focus && state.media.selection && state.media.shouldResumeOnFocus) {
      await resumeMediaForFocus({ force: true });
    }
  });

  elements.resetButton.addEventListener("click", async () => {
    await applyTimerResult(resetTimer(state.timer, Date.now(), settings), "Timer reset.");
  });

  elements.skipButton.addEventListener("click", async () => {
    await applyTimerResult(skipTimer(state.timer, Date.now(), settings), "Skipping to the next session.");
  });

  elements.finishButton.addEventListener("click", async () => {
    await finishCurrentTask();
  });

  elements.mediaUrlForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadMediaUrl(elements.mediaUrlInput.value);
  });

  elements.localFileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      await loadLocalAudioFile(file);
    }
  });

  elements.clearMediaButton.addEventListener("click", () => {
    mediaController.clear();
    state.media = createDefaultMediaState(settings);
    mediaNotice = "";
    elements.mediaUrlInput.value = "";
    elements.localFileInput.value = "";
    persistState();
    renderAll();
    setMessage("Media cleared. The timer can keep running on its own.");
  });

  elements.volumeRange.addEventListener("input", () => {
    const volume = Number.parseInt(elements.volumeRange.value, 10);
    state.media.volume = Number.isFinite(volume) ? volume : settings.defaultVolume;
    mediaController.applyVolume(state.media.volume);
    renderMediaPanel();
    persistState();
  });

  elements.taskForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addTask(elements.taskInput.value);
    elements.taskInput.value = "";
  });

  elements.taskList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-task-checkbox]");
    const taskItem = event.target.closest("[data-task-id]");
    if (!checkbox || !taskItem) {
      return;
    }
    toggleTask(taskItem.dataset.taskId, checkbox.checked);
  });

  elements.taskList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-task-action]");
    const taskItem = event.target.closest("[data-task-id]");
    if (!button || !taskItem) {
      return;
    }

    if (button.dataset.taskAction === "activate") {
      activateTask(taskItem.dataset.taskId);
      return;
    }

    if (button.dataset.taskAction === "remove") {
      removeTask(taskItem.dataset.taskId);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void tick();
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "pomodoro-flow.settings") {
      settings = loadSettings(window.localStorage);
      applySettingsToIdleTimer();
      persistState();
      renderAll();
    }
  });
}

async function initialize() {
  applySettingsToIdleTimer();
  const synced = syncTimer(state.timer, Date.now(), settings);
  state.timer = synced.timer;
  persistState();
  renderAll();
  bindEvents();

  // Check raw localStorage for a local file selection that sanitizeSelection already cleared.
  // We cannot restore the File object, so we show a user-facing message instead.
  const rawState = readJSON(window.localStorage, STORAGE_KEYS.appState, null);
  const hadLocalFile = rawState?.media?.selection?.mediaType === "local_file";

  if (state.media.selection) {
    const shouldAutoplay =
      state.timer.mode === MODES.focus &&
      state.timer.status === TIMER_STATUSES.running &&
      (["playing", "buffering"].includes(state.media.status) || state.media.shouldResumeOnFocus);

    try {
      await mediaController.load(state.media.selection, {
        autoplay: shouldAutoplay,
        resumeState: state.media,
        volume: state.media.volume,
      });
    } catch (error) {
      setMessage(error.message || "Saved media could not be restored.");
    }
  } else if (hadLocalFile) {
    mediaNotice = "Your local audio file needs to be selected again after refresh.";
    renderMediaPanel();
  }

  window.setInterval(() => {
    void tick();
  }, 300);
}

void initialize();
