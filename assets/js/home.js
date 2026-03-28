import { AUTOPLAY_BLOCKED_MESSAGE, DEFAULT_SETTINGS, MEDIA_STATUSES, MODES, MODE_LABELS, TIMER_STATUSES } from "./config.js";
import { makeSortable } from "./drag-sort.js";
import { DrawerController } from "./drawers.js";
import { playNotificationSound, sendBrowserNotification, stopNotificationSound } from "./notifications.js";
import { OnboardingTour } from "./onboarding.js";
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
import {
  createDefaultMediaState,
  loadAppState,
  loadSettings,
  loadUiState,
  sanitizeTask,
  saveAppState,
  saveUiState,
} from "./storage.js";
import { ToastManager } from "./toast-ui.js";

let settings = loadSettings(window.localStorage);
const state = loadAppState(window.localStorage, settings);
let uiState = loadUiState(window.localStorage);
let mediaStatusMessage = "Load a track or playlist to let the timer steer playback.";
let suppressManualPauseResumeReset = false;
let editingTaskId = null;

const elements = {
  appLayout: document.getElementById("app-layout"),
  drawerColumn: document.getElementById("drawer-column"),
  drawerBackdrop: document.getElementById("drawer-backdrop"),
  drawerTriggers: [...document.querySelectorAll("[data-drawer-trigger]")],
  drawerPanels: [...document.querySelectorAll("[data-drawer-panel]")],
  currentMode: document.getElementById("current-mode"),
  currentTask: document.getElementById("current-task"),
  nowPlaying: document.getElementById("now-playing"),
  modeSelector: document.getElementById("mode-selector"),
  nextBreakSelector: document.getElementById("next-break-selector"),
  timerLabel: document.getElementById("timer-label"),
  timerDetail: document.getElementById("timer-detail"),
  timeDisplay: document.getElementById("time-display"),
  progressValue: document.getElementById("timer-progress-value"),
  countdownBanner: document.getElementById("countdown-banner"),
  countdownSeconds: document.getElementById("countdown-seconds"),
  sessionCount: document.getElementById("session-count"),
  nextBreakLabel: document.getElementById("next-break-label"),
  timerStatus: document.getElementById("timer-status"),
  startButton: document.getElementById("start-button"),
  pauseResumeButton: document.getElementById("pause-resume-button"),
  pauseResumeLabel: document.querySelector("[data-pause-resume-label]"),
  resetButton: document.getElementById("reset-button"),
  skipButton: document.getElementById("skip-button"),
  soundcloudForm: document.getElementById("soundcloud-form"),
  soundcloudUrlInput: document.getElementById("soundcloud-url-input"),
  soundcloudLoadButton: document.getElementById("soundcloud-load-button"),
  soundcloudTitle: document.getElementById("soundcloud-title"),
  soundcloudKind: document.getElementById("soundcloud-kind"),
  soundcloudStatus: document.getElementById("soundcloud-status"),
  soundcloudAlert: document.getElementById("soundcloud-alert"),
  soundcloudStatePill: document.getElementById("soundcloud-state-pill"),
  soundcloudWidget: document.getElementById("soundcloud-widget"),
  soundcloudPlaceholder: document.getElementById("soundcloud-placeholder"),
  soundcloudToggleButton: document.getElementById("soundcloud-toggle-button"),
  soundcloudToggleLabel: document.querySelector("[data-soundcloud-toggle-label]"),
  soundcloudPreviousButton: document.getElementById("soundcloud-previous-button"),
  soundcloudNextButton: document.getElementById("soundcloud-next-button"),
  soundcloudNavRow: document.getElementById("soundcloud-nav-row"),
  clearSoundcloudButton: document.getElementById("clear-soundcloud-button"),
  soundcloudVolumeRange: document.getElementById("soundcloud-volume-range"),
  soundcloudVolumeValue: document.getElementById("soundcloud-volume-value"),
  musicEmbedDetails: document.getElementById("music-embed-details"),
  taskForm: document.getElementById("task-form"),
  taskInput: document.getElementById("task-input"),
  taskList: document.getElementById("task-list"),
  doneTaskList: document.getElementById("done-task-list"),
  taskEmptyState: document.getElementById("task-empty-state"),
  activeTaskSummary: document.getElementById("active-task-summary"),
  completeTaskButton: document.getElementById("complete-task-button"),
  doneTasksSection: document.getElementById("done-tasks-section"),
  doneTasksDetails: document.getElementById("done-tasks-details"),
  doneTaskCount: document.getElementById("done-task-count"),
  doneTaskEmpty: document.getElementById("done-task-empty"),
  toastRegion: document.getElementById("toast-region"),
  onboardingRoot: document.getElementById("onboarding-root"),
};

const toast = new ToastManager(elements.toastRegion);
const drawerController = new DrawerController({
  layout: elements.appLayout,
  column: elements.drawerColumn,
  backdrop: elements.drawerBackdrop,
  triggers: elements.drawerTriggers,
  panels: elements.drawerPanels,
  state: uiState,
  onChange: (nextState) => {
    uiState = {
      ...uiState,
      drawers: nextState.drawers,
    };
    persistUiState();
  },
});

const soundCloud = new SoundCloudController({
  iframe: elements.soundcloudWidget,
  placeholderElement: elements.soundcloudPlaceholder,
  onSnapshot: (snapshot, meta) => {
    void handleSoundCloudSnapshot(snapshot, meta);
  },
  onError: (message) => {
    setMediaStatus(message, { tone: "warning", toastMessage: message });
  },
});

makeSortable(elements.taskList, {
  onReorder: (orderedIds) => {
    reorderPendingTasks(orderedIds);
  },
});

function persistState() {
  saveAppState(window.localStorage, state, settings);
}

function persistUiState() {
  saveUiState(window.localStorage, uiState);
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

function setMediaStatus(message, { tone = "info", toastMessage = "" } = {}) {
  mediaStatusMessage = message || "Load a track or playlist to let the timer steer playback.";
  renderMediaPanel();
  if (toastMessage) {
    toast.show(toastMessage, {
      tone,
      duration: tone === "warning" ? 4200 : 3200,
    });
  }
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
  const nowPlayingLabel = state.media.title || state.media.author || (state.media.url ? "SoundCloud loaded" : "Nothing loaded");
  const showPause = state.timer.status === TIMER_STATUSES.running;
  const showResume = state.timer.status === TIMER_STATUSES.paused;

  elements.currentMode.textContent = presentation.modeLabel;
  elements.currentTask.textContent = activeTask ? activeTask.title : "No active task";
  elements.nowPlaying.textContent = nowPlayingLabel;
  elements.sessionCount.textContent = `${state.timer.sessionsCompleted}`;
  elements.nextBreakLabel.textContent = nextBreakLabel;
  elements.timerStatus.textContent = presentation.statusLabel;
  elements.timeDisplay.textContent = formatClock(presentation.displayMs);
  elements.timeDisplay.setAttribute(
    "datetime",
    `PT${Math.floor(remainingMs / 60000)}M${Math.ceil((remainingMs % 60000) / 1000)}S`,
  );
  elements.progressValue.style.inlineSize = `${presentation.progress * 100}%`;
  elements.timerLabel.textContent = getTimerLabelText();
  elements.timerDetail.textContent = getTimerDetailText(sessionDurationMs, remainingMs);
  elements.countdownBanner.hidden = !presentation.isTransition;
  elements.countdownSeconds.textContent = String(Math.max(0, Math.ceil(presentation.displayMs / 1000)));
  elements.completeTaskButton.textContent = activeTask ? "Complete active task" : "Clear active session";

  for (const button of elements.modeSelector.querySelectorAll("[data-mode]")) {
    button.classList.toggle("is-active", button.dataset.mode === state.timer.mode);
    button.disabled = state.timer.status === TIMER_STATUSES.running || state.timer.status === TIMER_STATUSES.transition;
  }

  for (const button of elements.nextBreakSelector.querySelectorAll("[data-next-break]")) {
    button.classList.toggle("is-active", button.dataset.nextBreak === state.timer.nextBreakMode);
  }

  elements.startButton.disabled = state.timer.status === TIMER_STATUSES.running || state.timer.status === TIMER_STATUSES.transition;
  elements.pauseResumeButton.disabled = !showPause && !showResume;
  elements.pauseResumeButton.dataset.mode = showPause ? "pause" : showResume ? "resume" : "idle";
  elements.pauseResumeLabel.textContent = showPause ? "Pause" : showResume ? "Resume" : "Pause";
  elements.skipButton.disabled = state.timer.status === TIMER_STATUSES.transition;

  document.title =
    state.timer.status === TIMER_STATUSES.running || state.timer.status === TIMER_STATUSES.transition
      ? `${formatClock(presentation.displayMs)} | ${presentation.modeLabel} | Pomodoro Flow`
      : "Pomodoro Flow";
}

function getTimerLabelText() {
  if (state.timer.status === TIMER_STATUSES.transition && state.timer.pendingMode) {
    return `${MODE_LABELS[state.timer.pendingMode]} begins in a moment`;
  }

  if (state.timer.mode === MODES.focus) {
    return state.timer.status === TIMER_STATUSES.paused ? "Paused and ready" : "One thing at a time";
  }

  if (state.timer.mode === MODES.longBreak) {
    return "Longer reset";
  }

  return "Short reset";
}

function getTimerDetailText(sessionDurationMs, remainingMs) {
  if (state.timer.status === TIMER_STATUSES.transition && state.timer.pendingMode) {
    return `Next: ${MODE_LABELS[state.timer.pendingMode]}.`;
  }

  const elapsedMinutes = Math.max(0, Math.round((sessionDurationMs - remainingMs) / 60000));
  const activeTask = getActiveTask();
  if (activeTask) {
    return `${activeTask.title}. ${elapsedMinutes} min in.`;
  }

  return "Timestamp-based timing stays accurate across refreshes and background tabs.";
}

function renderTasks() {
  const activeTask = getActiveTask();
  const pendingTasks = state.tasks.filter((task) => !task.done);
  const doneTasks = state.tasks.filter((task) => task.done);

  elements.activeTaskSummary.textContent = activeTask ? activeTask.title : "No active task";
  elements.taskEmptyState.hidden = state.tasks.length > 0;
  elements.doneTasksSection.hidden = doneTasks.length === 0;
  elements.doneTaskCount.textContent = String(doneTasks.length);
  elements.doneTaskEmpty.hidden = doneTasks.length > 0;
  elements.doneTasksDetails.open = uiState.doneTasksExpanded && doneTasks.length > 0;

  elements.taskList.innerHTML = pendingTasks.map((task) => renderTaskItem(task)).join("");
  elements.doneTaskList.innerHTML = doneTasks.map((task) => renderTaskItem(task)).join("");
  elements.completeTaskButton.disabled = state.timer.status === TIMER_STATUSES.transition;
}

function renderTaskItem(task) {
  const isActive = task.id === state.activeTaskId;
  const isEditing = task.id === editingTaskId;

  return `
    <li class="task-item ${isActive ? "is-active" : ""} ${task.done ? "is-done" : ""}" data-task-id="${escapeHtml(task.id)}" draggable="${task.done ? "false" : "true"
    }">
      <div class="task-item__handle" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M9 5h2v2H9zm4 0h2v2h-2zM9 11h2v2H9zm4 0h2v2h-2zM9 17h2v2H9zm4 0h2v2h-2z"></path></svg>
      </div>
      <label class="task-check">
        <input class="task-checkbox" type="checkbox" data-task-checkbox ${task.done ? "checked" : ""} aria-label="Mark ${escapeHtml(
      task.title,
    )} done">
        <span aria-hidden="true"></span>
      </label>
      <div class="task-item__body">
        ${isEditing
      ? `<input class="text-input task-item__edit-input" data-task-edit-input type="text" maxlength="120" value="${escapeHtml(
        task.title,
      )}" aria-label="Edit task text">`
      : `<span class="task-item__title">${escapeHtml(task.title)}</span>`
    }
        <div class="task-item__meta">
          ${isActive ? '<span class="mini-badge">Active</span>' : ""}
          ${task.done ? '<span class="mini-badge mini-badge--muted">Done</span>' : '<span class="mini-badge mini-badge--soft">Queued</span>'}
        </div>
      </div>
      <div class="task-item__actions">
        ${task.done
      ? ""
      : `<button class="icon-button icon-button--soft" type="button" data-task-action="activate" aria-label="${isActive ? "Task is active" : "Set as active task"
      }" title="${isActive ? "Active task" : "Set active"}">
                <svg viewBox="0 0 24 24"><path d="m12 2 2.7 6.2L21 9l-4.8 4.1 1.5 6.4L12 16.7 6.3 19.5l1.5-6.4L3 9l6.3-.8L12 2Z"></path></svg>
              </button>`
    }
        <button class="icon-button icon-button--soft" type="button" data-task-action="${isEditing ? "save" : "edit"
    }" aria-label="${isEditing ? "Save task" : "Edit task"}" title="${isEditing ? "Save" : "Edit"}">
          <svg viewBox="0 0 24 24"><path d="${isEditing
      ? "M9 16.2 4.8 12l1.4-1.4L9 13.4l8.6-8.6L19 6.2Z"
      : "M4 17.3V20h2.7l8-8-2.7-2.7-8 8ZM17.7 9c.4-.4.4-1 0-1.4l-1.3-1.3c-.4-.4-1-.4-1.4 0l-1 1 2.7 2.7 1-1Z"
    }"></path></svg>
        </button>
        ${isEditing
      ? `<button class="icon-button icon-button--soft" type="button" data-task-action="cancel" aria-label="Cancel editing" title="Cancel">
                <svg viewBox="0 0 24 24"><path d="m7.05 5.64 4.95 4.95 4.95-4.95 1.41 1.41L13.41 12l4.95 4.95-1.41 1.41L12 13.41l-4.95 4.95-1.41-1.41L10.59 12 5.64 7.05Z"></path></svg>
              </button>`
      : ""
    }
        <button class="icon-button icon-button--soft icon-button--danger" type="button" data-task-action="remove" aria-label="Delete task" title="Delete">
          <svg viewBox="0 0 24 24"><path d="M7 6h10l-1 14H8L7 6Zm3-3h4l1 2h4v2H5V5h4l1-2Z"></path></svg>
        </button>
      </div>
    </li>
  `;
}

function renderMediaPanel() {
  const hasSource = Boolean(state.media.url);
  const title = state.media.title || (hasSource ? "SoundCloud source loaded" : "No source loaded");
  const kindLabel = state.media.kind === "playlist" ? "Playlist" : state.media.kind === "track" ? "Track" : "Track or playlist";
  const isPlaying = state.media.status === MEDIA_STATUSES.playing;
  const showPlaylistControls = Boolean(state.media.canGoNext || state.media.canGoPrevious);
  const showAlert = Boolean(state.media.autoplayBlocked || state.media.status === MEDIA_STATUSES.error);

  elements.soundcloudTitle.textContent = title;
  elements.soundcloudKind.textContent = hasSource
    ? `${kindLabel}${state.media.author ? ` • ${state.media.author}` : ""}`
    : "Paste a SoundCloud URL to begin.";
  elements.soundcloudStatus.textContent = mediaStatusMessage;
  elements.soundcloudStatePill.textContent = formatMediaStatus(state.media.status);
  elements.soundcloudStatePill.dataset.state = state.media.status;
  elements.soundcloudVolumeRange.value = `${state.media.volume}`;
  elements.soundcloudVolumeValue.textContent = `${state.media.volume}%`;
  elements.soundcloudToggleButton.disabled = !hasSource;
  elements.soundcloudToggleLabel.textContent = isPlaying ? "Pause" : "Play";
  elements.soundcloudPreviousButton.disabled = !state.media.canGoPrevious;
  elements.soundcloudNextButton.disabled = !state.media.canGoNext;
  elements.soundcloudNavRow.hidden = !showPlaylistControls;
  elements.clearSoundcloudButton.disabled = !hasSource;
  elements.musicEmbedDetails.open = uiState.musicEmbedExpanded && hasSource;
  elements.soundcloudAlert.hidden = !showAlert;
  elements.soundcloudAlert.textContent = showAlert
    ? state.media.lastError || AUTOPLAY_BLOCKED_MESSAGE
    : "";
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
    setMediaStatus("SoundCloud is ready.");
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
    setMediaStatus("Moved to the next track.");
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

  setMediaStatus("Music paused for the break.");
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

  setMediaStatus("Music paused with the timer.");
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
  setMediaStatus(snapshot.autoplayBlocked ? AUTOPLAY_BLOCKED_MESSAGE : "Music playing for focus mode.");
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
      ? "Music restarted from the beginning."
      : "Music reset and will resume on the next focus session.",
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
      toast.show(`${MODE_LABELS[event.toMode]} starts in 5 seconds.`, { tone: "info", duration: 3200 });
    }

    if (event.type === "transition-started" && event.fromMode === MODES.focus) {
      await pauseMediaForBreak();
    }

    if (event.type === "session-started") {
      stopNotificationSound();
      if (event.mode === MODES.focus) {
        toast.show("Focus session started.", { tone: "success" });
        await resumeMediaForFocus();
      } else {
        toast.show(`${MODE_LABELS[event.mode]} started.`, { tone: "info" });
        await pauseMediaForBreak();
      }
    }
  }
}

async function applyTimerResult(result, toastMessage) {
  state.timer = result.timer;
  await handleTimerEvents(result.events);
  persistState();
  renderTimer();
  if (toastMessage) {
    toast.show(toastMessage, { tone: "success" });
  }
}

async function loadSoundCloudUrl(rawUrl) {
  if (!isLikelySoundCloudUrl(rawUrl)) {
    setMediaStatus("Paste a valid SoundCloud track or playlist URL.", {
      tone: "warning",
      toastMessage: "Paste a valid SoundCloud URL.",
    });
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
    setMediaStatus(snapshot.autoplayBlocked ? AUTOPLAY_BLOCKED_MESSAGE : "SoundCloud loaded.", {
      tone: snapshot.autoplayBlocked ? "warning" : "success",
      toastMessage: snapshot.autoplayBlocked ? AUTOPLAY_BLOCKED_MESSAGE : "SoundCloud loaded.",
    });
  } catch (error) {
    setMediaStatus(error.message || "The SoundCloud source could not be loaded.", {
      tone: "error",
      toastMessage: error.message || "The SoundCloud source could not be loaded.",
    });
  } finally {
    elements.soundcloudLoadButton.disabled = false;
    elements.soundcloudLoadButton.textContent = "Load";
  }
}

function addTask(rawTitle) {
  const task = sanitizeTask({ title: rawTitle });
  if (!task) {
    toast.show("Enter a task first.", { tone: "warning" });
    return;
  }

  state.tasks.unshift(task);
  if (!state.activeTaskId) {
    state.activeTaskId = task.id;
  }

  persistState();
  renderTasks();
  renderTimer();
  toast.show("Task added.", { tone: "success" });
}

function toggleTask(taskId, isDone, { silent = false } = {}) {
  const task = state.tasks.find((item) => item.id === taskId);

  state.tasks = state.tasks.map((item) =>
    item.id === taskId ? { ...item, done: isDone } : item,
  );

  if (isDone && state.activeTaskId === taskId) {
    state.activeTaskId = null;
  }

  if (isDone) {
    state.tasks = [...state.tasks.filter((item) => !item.done), ...state.tasks.filter((item) => item.done)];
    const result = setNextBreakMode(state.timer, MODES.longBreak);
    state.timer = result.timer;

    if (task && !silent) {
      toast.show(`"${task.title}" done. Next break set to long.`, { tone: "success", duration: 3600 });
    }
  } else if (task && !silent) {
    toast.show(`"${task.title}" moved back to active work.`, { tone: "info" });
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
  toast.show(`"${task.title}" is active.`, { tone: "info" });
}

function removeTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  state.tasks = state.tasks.filter((item) => item.id !== taskId);
  if (state.activeTaskId === taskId) {
    state.activeTaskId = null;
  }

  if (editingTaskId === taskId) {
    editingTaskId = null;
  }

  persistState();
  renderTasks();
  renderTimer();
  if (task) {
    toast.show(`Removed "${task.title}".`, { tone: "info" });
  }
}

function beginEditingTask(taskId) {
  editingTaskId = taskId;
  renderTasks();
  document.querySelector(`[data-task-id="${CSS.escape(taskId)}"] [data-task-edit-input]`)?.focus();
}

function saveEditedTask(taskId) {
  const input = document.querySelector(`[data-task-id="${CSS.escape(taskId)}"] [data-task-edit-input]`);
  const nextTask = sanitizeTask({
    ...state.tasks.find((item) => item.id === taskId),
    title: input?.value || "",
  });

  if (!nextTask) {
    toast.show("Task text cannot be empty.", { tone: "warning" });
    return;
  }

  state.tasks = state.tasks.map((item) => (item.id === taskId ? { ...item, title: nextTask.title } : item));
  editingTaskId = null;
  persistState();
  renderTasks();
  renderTimer();
  toast.show("Task updated.", { tone: "success" });
}

function cancelEditingTask() {
  editingTaskId = null;
  renderTasks();
}

function reorderPendingTasks(orderedIds) {
  const pendingTasks = state.tasks.filter((task) => !task.done);
  const pendingMap = new Map(pendingTasks.map((task) => [task.id, task]));
  const reorderedPending = orderedIds.map((id) => pendingMap.get(id)).filter(Boolean);
  const remainingPending = pendingTasks.filter((task) => !orderedIds.includes(task.id));
  const doneTasks = state.tasks.filter((task) => task.done);

  state.tasks = [...reorderedPending, ...remainingPending, ...doneTasks];
  persistState();
  renderTasks();
}

async function completeActiveTask() {
  const activeTask = getActiveTask();
  if (activeTask) {
    toggleTask(activeTask.id, true, { silent: true });
  }

  const result = finishTimer(state.timer, Date.now(), settings);
  state.timer = result.timer;
  if (state.media.url) {
    state.media.shouldResumeOnFocus = false;
    await soundCloud.pause();
  }

  persistState();
  renderAll();
  toast.show(activeTask ? "Active task completed." : "Session cleared.", { tone: "success" });
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
  drawerController.initialize();

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

  elements.pauseResumeButton.addEventListener("click", async () => {
    if (elements.pauseResumeButton.dataset.mode === "pause") {
      await applyTimerResult(pauseTimer(state.timer, Date.now(), settings), "Timer paused.");

      if (state.media.url) {
        await pauseMediaForTimerControl();
      }
      return;
    }

    if (elements.pauseResumeButton.dataset.mode === "resume") {
      await applyTimerResult(resumeTimer(state.timer, Date.now(), settings), "Timer resumed.");

      if (state.timer.mode === MODES.focus && state.media.url) {
        await resumeMediaForFocus({
          force: true,
          userInitiated: true,
        });
      }
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

  elements.soundcloudToggleButton.addEventListener("click", async () => {
    if (state.media.status === MEDIA_STATUSES.playing) {
      const snapshot = await soundCloud.pause();
      state.media = {
        ...state.media,
        ...snapshot,
        shouldResumeOnFocus: false,
      };
      setMediaStatus("SoundCloud is paused.", { tone: "info", toastMessage: "SoundCloud paused." });
      persistState();
      renderAll();
      return;
    }

    state.media.shouldResumeOnFocus = true;
    const snapshot = await soundCloud.play({ userInitiated: true });
    state.media = {
      ...state.media,
      ...snapshot,
      shouldResumeOnFocus: snapshot.status === MEDIA_STATUSES.playing ? true : state.media.shouldResumeOnFocus,
    };

    if (snapshot.status === MEDIA_STATUSES.playing) {
      setMediaStatus("SoundCloud is playing.", {
        tone: "success",
        toastMessage: "SoundCloud playing.",
      });
    } else if (snapshot.lastError) {
      setMediaStatus(snapshot.lastError, {
        tone: "warning",
        toastMessage: snapshot.lastError,
      });
    } else {
      setMediaStatus("Playback did not start. Open the player and press play once.", {
        tone: "warning",
        toastMessage: "Playback did not start.",
      });
    }

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
    setMediaStatus("Moved to the previous item.", { tone: "info", toastMessage: "Previous item." });
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
    setMediaStatus("Moved to the next item.", { tone: "info", toastMessage: "Next item." });
    persistState();
    renderAll();
  });

  elements.clearSoundcloudButton.addEventListener("click", () => {
    soundCloud.clear();
    state.media = createDefaultMediaState(settings);
    persistState();
    renderAll();
    setMediaStatus("SoundCloud cleared.", { tone: "info", toastMessage: "SoundCloud cleared." });
  });

  elements.soundcloudVolumeRange.addEventListener("input", async () => {
    const volume = Number.parseInt(elements.soundcloudVolumeRange.value, 10);
    state.media.volume = Number.isFinite(volume) ? volume : settings.defaultVolume;
    await soundCloud.setVolume(state.media.volume);
    persistState();
    renderMediaPanel();
  });

  elements.musicEmbedDetails.addEventListener("toggle", () => {
    uiState.musicEmbedExpanded = elements.musicEmbedDetails.open;
    persistUiState();
  });

  elements.taskForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addTask(elements.taskInput.value);
    elements.taskInput.value = "";
  });

  elements.taskList.addEventListener("change", handleTaskListChange);
  elements.doneTaskList.addEventListener("change", handleTaskListChange);

  elements.taskList.addEventListener("click", handleTaskListClick);
  elements.doneTaskList.addEventListener("click", handleTaskListClick);

  elements.taskList.addEventListener("keydown", handleTaskInputKeydown);
  elements.doneTaskList.addEventListener("keydown", handleTaskInputKeydown);

  elements.doneTasksDetails.addEventListener("toggle", () => {
    uiState.doneTasksExpanded = elements.doneTasksDetails.open;
    persistUiState();
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

function handleTaskListChange(event) {
  const checkbox = event.target.closest("[data-task-checkbox]");
  const taskItem = event.target.closest("[data-task-id]");
  if (!checkbox || !taskItem) {
    return;
  }

  toggleTask(taskItem.dataset.taskId, checkbox.checked);
}

function handleTaskListClick(event) {
  const button = event.target.closest("[data-task-action]");
  const taskItem = event.target.closest("[data-task-id]");
  if (!button || !taskItem) {
    return;
  }

  if (button.dataset.taskAction === "activate") {
    activateTask(taskItem.dataset.taskId);
    return;
  }

  if (button.dataset.taskAction === "edit") {
    beginEditingTask(taskItem.dataset.taskId);
    return;
  }

  if (button.dataset.taskAction === "save") {
    saveEditedTask(taskItem.dataset.taskId);
    return;
  }

  if (button.dataset.taskAction === "cancel") {
    cancelEditingTask();
    return;
  }

  if (button.dataset.taskAction === "remove") {
    removeTask(taskItem.dataset.taskId);
  }
}

function handleTaskInputKeydown(event) {
  const input = event.target.closest("[data-task-edit-input]");
  const taskItem = event.target.closest("[data-task-id]");
  if (!input || !taskItem) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    saveEditedTask(taskItem.dataset.taskId);
  }

  if (event.key === "Escape") {
    event.preventDefault();
    cancelEditingTask();
  }
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
      return "Issue";
    case MEDIA_STATUSES.idle:
    default:
      return "Idle";
  }
}

function initializeTour() {
  if (uiState.onboardingCompleted) {
    return;
  }

  const tour = new OnboardingTour({
    root: elements.onboardingRoot,
    onFinish: (completed) => {
      uiState.onboardingCompleted = completed || uiState.onboardingCompleted;
      persistUiState();
      document.querySelectorAll(".is-tour-target").forEach((element) => {
        element.classList.remove("is-tour-target");
      });
    },
    steps: [
      {
        target: "#mode-selector",
        title: "Choose a mode",
        body: "Pick focus, short break, or long break before you start.",
      },
      {
        target: "#start-button",
        title: "Start the session",
        body: "The timer stays accurate even if you switch tabs or refresh.",
      },
      {
        target: "#soundcloud-form",
        title: "Load music",
        body: "Paste a SoundCloud track or playlist when you want timer-led playback.",
        beforeFocus: () => drawerController.openForTour("music"),
      },
      {
        target: "#task-form",
        title: "Add one task",
        body: "Keep the list light. Set one task active for the current focus block.",
        beforeFocus: () => drawerController.openForTour("tasks"),
      },
    ],
  });

  window.setTimeout(() => {
    tour.start();
  }, 600);
}

async function initialize() {
  applySettingsToIdleTimer();
  const synced = syncTimer(state.timer, Date.now(), settings);
  state.timer = synced.timer;
  persistState();
  renderAll();
  bindEvents();
  initializeTour();

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
      setMediaStatus(error.message || "Saved SoundCloud source could not be restored.", {
        tone: "warning",
        toastMessage: error.message || "Saved SoundCloud source could not be restored.",
      });
    }
  }

  window.setInterval(() => {
    void tick();
  }, 300);
}

void initialize();
