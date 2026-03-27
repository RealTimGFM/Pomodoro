import { AUTOPLAY_BLOCKED_MESSAGE, DEFAULT_SETTINGS, MEDIA_STATUSES, MODES, MODE_LABELS, TIMER_STATUSES } from "./config.js";
import { playNotificationSound, sendBrowserNotification, stopNotificationSound } from "./notifications.js";
import { detectSoundCloudUrlKind, isLikelySoundCloudUrl, normalizeSoundCloudUrl, SoundCloudController } from "./soundcloud-controller.js";
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
import { createDefaultMediaState, loadAppState, loadSettings, saveAppState, sanitizeTask } from "./storage.js";

let settings = loadSettings(window.localStorage);
const state = loadAppState(window.localStorage, settings);
let appMessageTimeoutId = null;
let mediaStatusMessage = "The app works perfectly well even if you never load media.";
let suppressManualPauseResumeReset = false;

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
  completeTaskButton: document.getElementById("complete-task-button"),
  appMessage: document.getElementById("app-message"),
  soundcloudForm: document.getElementById("soundcloud-form"),
  soundcloudUrlInput: document.getElementById("soundcloud-url-input"),
  soundcloudLoadButton: document.getElementById("soundcloud-load-button"),
  soundcloudTitle: document.getElementById("soundcloud-title"),
  soundcloudKind: document.getElementById("soundcloud-kind"),
  soundcloudStatus: document.getElementById("soundcloud-status"),
  soundcloudStatePill: document.getElementById("soundcloud-state-pill"),
  soundcloudWidget: document.getElementById("soundcloud-widget"),
  soundcloudPlaceholder: document.getElementById("soundcloud-placeholder"),
  soundcloudPlayButton: document.getElementById("soundcloud-play-button"),
  soundcloudPauseButton: document.getElementById("soundcloud-pause-button"),
  soundcloudPreviousButton: document.getElementById("soundcloud-previous-button"),
  soundcloudNextButton: document.getElementById("soundcloud-next-button"),
  clearSoundcloudButton: document.getElementById("clear-soundcloud-button"),
  soundcloudVolumeRange: document.getElementById("soundcloud-volume-range"),
  soundcloudVolumeValue: document.getElementById("soundcloud-volume-value"),
  taskForm: document.getElementById("task-form"),
  taskInput: document.getElementById("task-input"),
  taskList: document.getElementById("task-list"),
  taskEmptyState: document.getElementById("task-empty-state"),
  activeTaskSummary: document.getElementById("active-task-summary"),
};

const soundCloud = new SoundCloudController({
  iframe: elements.soundcloudWidget,
  placeholderElement: elements.soundcloudPlaceholder,
  onSnapshot: (snapshot, meta) => {
    void handleSoundCloudSnapshot(snapshot, meta);
  },
  onError: (message) => {
    setMediaStatus(message);
  },
});

function persistState() {
  saveAppState(window.localStorage, state, settings);
}

function applySettingsToIdleTimer() {
  if (state.timer.status === TIMER_STATUSES.idle) {
    state.timer.remainingMs = getModeDurationMs(state.timer.mode, settings);
  }

  if (!state.media.url) {
    state.media.volume = settings.defaultVolume;
  }
}

function getActiveTask() {
  return state.tasks.find((task) => task.id === state.activeTaskId) || null;
}

function setAppMessage(message, timeoutMs = 4200) {
  elements.appMessage.textContent = message || "";
  if (appMessageTimeoutId) {
    window.clearTimeout(appMessageTimeoutId);
  }

  if (message) {
    appMessageTimeoutId = window.setTimeout(() => {
      elements.appMessage.textContent = "";
    }, timeoutMs);
  }
}

function setMediaStatus(message) {
  mediaStatusMessage = message || "The app works perfectly well even if you never load media.";
  renderMediaPanel();
}

function formatClock(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  const nextBreakLabel = MODE_LABELS[state.timer.nextBreakMode] || "Short break";
  const sessionDurationMs =
    state.timer.status === TIMER_STATUSES.transition ? 5000 : getModeDurationMs(state.timer.mode, settings);
  const remainingMs = getDisplayMs(state.timer, now, settings);
  const nowPlayingLabel = state.media.title || state.media.author || (state.media.url ? "SoundCloud loaded" : "Sound off");

  elements.currentMode.textContent = presentation.modeLabel;
  elements.currentTask.textContent = activeTask ? activeTask.title : "No active task selected";
  elements.nowPlaying.textContent = nowPlayingLabel;
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
  elements.completeTaskButton.textContent = activeTask ? "Complete active task" : "Done for now";

  for (const button of elements.modeSelector.querySelectorAll("[data-mode]")) {
    button.classList.toggle("is-active", button.dataset.mode === state.timer.mode);
    button.disabled = state.timer.status === TIMER_STATUSES.running || state.timer.status === TIMER_STATUSES.transition;
  }

  for (const button of elements.nextBreakSelector.querySelectorAll("[data-next-break]")) {
    button.classList.toggle("is-active", button.dataset.nextBreak === state.timer.nextBreakMode);
  }

  elements.startButton.disabled = state.timer.status === TIMER_STATUSES.running || state.timer.status === TIMER_STATUSES.transition;
  elements.pauseButton.disabled = state.timer.status !== TIMER_STATUSES.running;
  elements.resumeButton.disabled = state.timer.status !== TIMER_STATUSES.paused;
  elements.skipButton.disabled = state.timer.status === TIMER_STATUSES.transition;

  document.title =
    state.timer.status === TIMER_STATUSES.running || state.timer.status === TIMER_STATUSES.transition
      ? `${formatClock(presentation.displayMs)} | ${presentation.modeLabel} | Pomodoro Flow`
      : "Pomodoro Flow";
}

function getTimerLabelText() {
  if (state.timer.status === TIMER_STATUSES.transition && state.timer.pendingMode) {
    return `${MODE_LABELS[state.timer.pendingMode]} begins in a moment.`;
  }

  if (state.timer.mode === MODES.focus) {
    return state.timer.status === TIMER_STATUSES.paused ? "Paused, ready when you are." : "Stay with one thing.";
  }

  if (state.timer.mode === MODES.longBreak) {
    return "Let the longer reset actually feel spacious.";
  }

  return "The break stays part of the rhythm, not an accident.";
}

function getTimerHintText(sessionDurationMs, remainingMs) {
  if (state.timer.status === TIMER_STATUSES.transition && state.timer.pendingMode) {
    return `The next ${MODE_LABELS[state.timer.pendingMode].toLowerCase()} starts after the countdown.`;
  }

  const elapsedMinutes = Math.max(0, Math.round((sessionDurationMs - remainingMs) / 60000));
  const activeTask = getActiveTask();
  if (activeTask) {
    return `${activeTask.title} is the active task for this cycle. ${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} in so far.`;
  }

  return "This timer keeps its real source of truth in timestamps, so it survives refreshes and background tabs cleanly.";
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
  const hasSource = Boolean(state.media.url);
  const title = state.media.title || (hasSource ? "SoundCloud source loaded" : "No SoundCloud source loaded");
  const kindLabel = state.media.kind === "playlist" ? "Playlist" : state.media.kind === "track" ? "Track" : "Track or playlist";

  elements.soundcloudTitle.textContent = title;
  elements.soundcloudKind.textContent = hasSource
    ? `${kindLabel}${state.media.author ? ` | ${state.media.author}` : ""}`
    : "Add a track or playlist to keep the timer in control.";
  elements.soundcloudStatus.textContent = mediaStatusMessage;
  elements.soundcloudStatePill.textContent = formatMediaStatus(state.media.status);
  elements.soundcloudStatePill.dataset.state = state.media.status;
  elements.soundcloudVolumeRange.value = `${state.media.volume}`;
  elements.soundcloudVolumeValue.textContent = `${state.media.volume}%`;
  elements.soundcloudPlayButton.disabled = !hasSource;
  elements.soundcloudPauseButton.disabled = !hasSource;
  elements.soundcloudPreviousButton.disabled = !hasSource || !state.media.canGoPrevious;
  elements.soundcloudNextButton.disabled = !hasSource || !state.media.canGoNext;
  elements.clearSoundcloudButton.disabled = !hasSource;
}

function renderAll() {
  renderTimer();
  renderTasks();
  renderMediaPanel();
}

async function handleSoundCloudSnapshot(snapshot, meta = {}) {
  if (!snapshot) {
    return;
  }

  state.media = {
    ...state.media,
    ...snapshot,
    url: snapshot.url || state.media.url,
    normalizedUrl: snapshot.normalizedUrl || state.media.normalizedUrl,
    kind: snapshot.kind || state.media.kind,
    title: snapshot.title || state.media.title,
    author: snapshot.author || state.media.author,
  };

  if (meta.reason === "play" || meta.reason === "play-command" || meta.reason === "next-command" || meta.reason === "previous-command") {
    if (state.timer.mode === MODES.focus) {
      state.media.shouldResumeOnFocus = true;
    }
  }

  if (
    (meta.reason === "pause" || meta.reason === "pause-command") &&
    state.timer.mode === MODES.focus &&
    state.timer.status === TIMER_STATUSES.running &&
    !suppressManualPauseResumeReset
  ) {
    state.media.shouldResumeOnFocus = false;
  }

  if (snapshot.autoplayBlocked) {
    state.media.shouldResumeOnFocus = true;
    setMediaStatus(AUTOPLAY_BLOCKED_MESSAGE);
  } else if (snapshot.lastError) {
    setMediaStatus(snapshot.lastError);
  } else if (meta.reason === "ready" || meta.reason === "load-complete") {
    setMediaStatus("SoundCloud source restored and ready.");
  } else if (meta.reason === "play" || meta.reason === "play-command") {
    setMediaStatus("SoundCloud is playing.");
  } else if (meta.reason === "pause" || meta.reason === "pause-command") {
    setMediaStatus("SoundCloud is paused.");
  }

  if (meta.reason === "finish") {
    await handleFinishedMedia();
    return;
  }

  persistState();
  renderAll();
}

async function handleFinishedMedia() {
  if (!state.media.url) {
    return;
  }

  if (state.media.canGoNext) {
    const snapshot = await soundCloud.next();
    state.media = {
      ...state.media,
      ...snapshot,
      shouldResumeOnFocus: true,
    };
    setMediaStatus("SoundCloud advanced to the next item.");
  } else {
    await replayCurrentSoundCloudSource();
    return;
  }

  persistState();
  renderAll();
}

async function pauseMediaForBreak() {
  if (!state.media.url) {
    return;
  }

  const shouldResumeLater =
    state.media.status === MEDIA_STATUSES.playing || state.media.shouldResumeOnFocus;

  suppressManualPauseResumeReset = true;

  try {
    const snapshot = await soundCloud.pause();
    state.media = {
      ...state.media,
      ...snapshot,
      shouldResumeOnFocus: shouldResumeLater,
    };
  } finally {
    suppressManualPauseResumeReset = false;
  }

  setMediaStatus("SoundCloud paused for the break.");
  persistState();
  renderAll();
}

async function pauseMediaForTimerControl() {
  if (!state.media.url) {
    return;
  }

  const shouldResumeLater =
    state.timer.mode === MODES.focus &&
    (state.media.status === MEDIA_STATUSES.playing || state.media.shouldResumeOnFocus);

  suppressManualPauseResumeReset = true;

  try {
    const snapshot = await soundCloud.pause();
    state.media = {
      ...state.media,
      ...snapshot,
      shouldResumeOnFocus: shouldResumeLater,
    };
  } finally {
    suppressManualPauseResumeReset = false;
  }

  setMediaStatus("SoundCloud paused with the timer.");
  persistState();
  renderAll();
}
async function resumeMediaForFocus({ force = false, userInitiated = false } = {}) {
  if (!state.media.url) {
    return;
  }

  if (!force && !state.media.shouldResumeOnFocus) {
    return;
  }

  const snapshot = await soundCloud.play({ userInitiated });
  state.media = {
    ...state.media,
    ...snapshot,
    shouldResumeOnFocus: true,
  };
  setMediaStatus(snapshot.autoplayBlocked ? AUTOPLAY_BLOCKED_MESSAGE : "SoundCloud playing for focus mode.");
  persistState();
  renderAll();
}

async function replayCurrentSoundCloudSource() {
  const sourceUrl = state.media.normalizedUrl || state.media.url;
  if (!sourceUrl) {
    return;
  }

  const shouldAutoplay =
    state.timer.mode === MODES.focus &&
    state.timer.status === TIMER_STATUSES.running;

  const snapshot = await soundCloud.load(sourceUrl, {
    autoplay: shouldAutoplay,
    restorePositionMs: 0,
    volume: state.media.volume || settings.defaultVolume,
  });

  state.media = {
    ...state.media,
    ...snapshot,
    url: sourceUrl,
    normalizedUrl: sourceUrl,
    shouldResumeOnFocus: true,
  };

  setMediaStatus(
    shouldAutoplay
      ? "SoundCloud restarted from the beginning."
      : "SoundCloud reset to the beginning and will resume on the next focus session."
  );

  persistState();
  renderAll();
}

async function handleTimerEvents(events) {
  for (const event of events) {
    const isFreshNotification = Date.now() - event.at < 12_000;

    if (event.type === "transition-started" && !event.manual && isFreshNotification) {
      playNotificationSound(settings.soundNotifications, 5000);
      sendBrowserNotification(
        settings,
        `${MODE_LABELS[event.fromMode]} complete`,
        `${MODE_LABELS[event.toMode]} starts in 5 seconds.`,
      );
    }

    if (event.type === "transition-started" && event.fromMode === MODES.focus) {
      await pauseMediaForBreak();
    }

    if (event.type === "session-started") {
      stopNotificationSound();
      if (event.mode === MODES.focus) {
        await resumeMediaForFocus();
      } else {
        await pauseMediaForBreak();
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
    setAppMessage(message);
  }
}

async function loadSoundCloudUrl(rawUrl) {
  if (!isLikelySoundCloudUrl(rawUrl)) {
    setMediaStatus("Paste a valid SoundCloud track or playlist URL.");
    return;
  }

  const normalizedUrl = normalizeSoundCloudUrl(rawUrl);
  const shouldAutoplay =
    state.timer.mode === MODES.focus &&
    state.timer.status === TIMER_STATUSES.running &&
    (state.media.shouldResumeOnFocus || state.media.status === MEDIA_STATUSES.idle);

  elements.soundcloudLoadButton.disabled = true;
  elements.soundcloudLoadButton.textContent = "Loading...";
  setMediaStatus("Loading the SoundCloud widget...");

  try {
    const snapshot = await soundCloud.load(normalizedUrl, {
      autoplay: shouldAutoplay,
      restorePositionMs: state.media.normalizedUrl === normalizedUrl ? state.media.currentPositionMs : 0,
      volume: state.media.volume || settings.defaultVolume,
    });

    state.media = {
      ...createDefaultMediaState(settings),
      ...snapshot,
      url: normalizedUrl,
      normalizedUrl,
      kind: detectSoundCloudUrlKind(normalizedUrl) || "unknown",
      shouldResumeOnFocus: true,
      volume: snapshot.volume || state.media.volume || settings.defaultVolume,
    };

    persistState();
    renderAll();
    elements.soundcloudUrlInput.value = "";
    setMediaStatus(snapshot.autoplayBlocked ? AUTOPLAY_BLOCKED_MESSAGE : "SoundCloud source loaded.");
  } catch (error) {
    setMediaStatus(error.message || "The SoundCloud source could not be loaded.");
  } finally {
    elements.soundcloudLoadButton.disabled = false;
    elements.soundcloudLoadButton.textContent = "Load";
  }
}

function addTask(rawTitle) {
  const task = sanitizeTask({ title: rawTitle });
  if (!task) {
    setAppMessage("Enter a task title first.");
    return;
  }

  state.tasks.unshift(task);
  if (!state.activeTaskId) {
    state.activeTaskId = task.id;
  }

  persistState();
  renderTasks();
  renderTimer();
  setAppMessage("Task added.");
}

function toggleTask(taskId, isDone) {
  const task = state.tasks.find((item) => item.id === taskId);

  state.tasks = state.tasks.map((item) =>
    item.id === taskId ? { ...item, done: isDone } : item
  );

  if (isDone && state.activeTaskId === taskId) {
    state.activeTaskId = null;
  }

  if (isDone) {
    const result = setNextBreakMode(state.timer, MODES.longBreak);
    state.timer = result.timer;

    if (task) {
      setAppMessage(`"${task.title}" marked done. Next break set to long break.`);
    }
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

  state.activeTaskId = task.id;
  persistState();
  renderTasks();
  renderTimer();
  setAppMessage(`"${task.title}" is now the active task.`);
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
    setAppMessage(`Removed "${task.title}".`);
  }
}

async function completeActiveTask() {
  const activeTask = getActiveTask();
  if (activeTask) {
    toggleTask(activeTask.id, true);
  }

  const result = finishTimer(state.timer, Date.now(), settings);
  state.timer = result.timer;
  if (state.media.url) {
    state.media.shouldResumeOnFocus = false;
    await soundCloud.pause();
  }

  persistState();
  renderAll();
  setAppMessage(activeTask ? "Active task marked complete." : "Timer reset for the next session.");
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

    if (state.timer.mode === MODES.focus && state.media.url) {
      await resumeMediaForFocus({
        force: true,
        userInitiated: true,
      });
    }
  });

  elements.pauseButton.addEventListener("click", async () => {
    await applyTimerResult(pauseTimer(state.timer, Date.now(), settings), "Timer paused.");

    if (state.media.url) {
      await pauseMediaForTimerControl();
    }
  });

  elements.resumeButton.addEventListener("click", async () => {
    await applyTimerResult(resumeTimer(state.timer, Date.now(), settings), "Timer resumed.");

    if (state.timer.mode === MODES.focus && state.media.url) {
      await resumeMediaForFocus({
        force: true,
        userInitiated: true,
      });
    }
  });

  elements.resetButton.addEventListener("click", async () => {
    await applyTimerResult(resetTimer(state.timer, Date.now(), settings), "Timer reset.");
  });

  elements.skipButton.addEventListener("click", async () => {
    await applyTimerResult(skipTimer(state.timer, Date.now(), settings), "Skipping to the next session.");
  });

  elements.completeTaskButton.addEventListener("click", async () => {
    await completeActiveTask();
  });

  elements.soundcloudForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadSoundCloudUrl(elements.soundcloudUrlInput.value);
  });

  elements.soundcloudPlayButton.addEventListener("click", async () => {
    state.media.shouldResumeOnFocus = true;
    const snapshot = await soundCloud.play({ userInitiated: true });
    state.media = {
      ...state.media,
      ...snapshot,
      shouldResumeOnFocus: true,
    };
    setMediaStatus("SoundCloud is playing.");
    persistState();
    renderAll();
  });

  elements.soundcloudPauseButton.addEventListener("click", async () => {
    const snapshot = await soundCloud.pause();
    state.media = {
      ...state.media,
      ...snapshot,
      shouldResumeOnFocus: false,
    };
    setMediaStatus("SoundCloud is paused.");
    persistState();
    renderAll();
  });

  elements.soundcloudPreviousButton.addEventListener("click", async () => {
    const snapshot = await soundCloud.previous();
    state.media = {
      ...state.media,
      ...snapshot,
      shouldResumeOnFocus: true,
    };
    setMediaStatus("Moved to the previous SoundCloud item.");
    persistState();
    renderAll();
  });

  elements.soundcloudNextButton.addEventListener("click", async () => {
    const snapshot = await soundCloud.next();
    state.media = {
      ...state.media,
      ...snapshot,
      shouldResumeOnFocus: true,
    };
    setMediaStatus("Moved to the next SoundCloud item.");
    persistState();
    renderAll();
  });

  elements.clearSoundcloudButton.addEventListener("click", () => {
    soundCloud.clear();
    state.media = createDefaultMediaState(settings);
    persistState();
    renderAll();
    setMediaStatus("SoundCloud cleared. The timer can keep running on its own.");
  });

  elements.soundcloudVolumeRange.addEventListener("input", async () => {
    const volume = Number.parseInt(elements.soundcloudVolumeRange.value, 10);
    state.media.volume = Number.isFinite(volume) ? volume : settings.defaultVolume;
    await soundCloud.setVolume(state.media.volume);
    persistState();
    renderMediaPanel();
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

  if (state.media.url) {
    const shouldAutoplay =
      state.timer.mode === MODES.focus &&
      state.timer.status === TIMER_STATUSES.running &&
      state.media.shouldResumeOnFocus;

    try {
      const snapshot = await soundCloud.load(state.media.url, {
        autoplay: shouldAutoplay,
        restorePositionMs: state.media.currentPositionMs,
        volume: state.media.volume || DEFAULT_SETTINGS.defaultVolume,
      });

      state.media = {
        ...state.media,
        ...snapshot,
      };
      setMediaStatus(snapshot.autoplayBlocked ? AUTOPLAY_BLOCKED_MESSAGE : "Saved SoundCloud source restored.");
      persistState();
      renderAll();
    } catch (error) {
      setMediaStatus(error.message || "Saved SoundCloud source could not be restored.");
    }
  }

  window.setInterval(() => {
    void tick();
  }, 300);
}

function formatMediaStatus(status) {
  switch (status) {
    case MEDIA_STATUSES.loading:
      return "Loading";
    case MEDIA_STATUSES.ready:
      return "Ready";
    case MEDIA_STATUSES.playing:
      return "Playing";
    case MEDIA_STATUSES.paused:
      return "Paused";
    case MEDIA_STATUSES.ended:
      return "Finished";
    case MEDIA_STATUSES.error:
      return "Error";
    case MEDIA_STATUSES.idle:
    default:
      return "Idle";
  }
}

void initialize();
