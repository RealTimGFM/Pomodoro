import { DEFAULT_SETTINGS, MODES, MODE_LABELS, TIMER_STATUSES, TRANSITION_MS } from "./config.js";

export function createDefaultTimerState(settings = DEFAULT_SETTINGS, now = Date.now()) {
  return {
    mode: MODES.focus,
    status: TIMER_STATUSES.idle,
    remainingMs: getModeDurationMs(MODES.focus, settings),
    endsAt: null,
    startedAt: null,
    pendingMode: null,
    transitionEndsAt: null,
    transitionFromMode: null,
    sessionsCompleted: 0,
    nextBreakMode: MODES.shortBreak,
    updatedAt: now,
  };
}

export function getModeDurationMs(mode, settings = DEFAULT_SETTINGS) {
  switch (mode) {
    case MODES.shortBreak:
      return settings.shortBreakDurationMinutes * 60 * 1000;
    case MODES.longBreak:
      return settings.longBreakDurationMinutes * 60 * 1000;
    case MODES.focus:
    default:
      return settings.focusDurationMinutes * 60 * 1000;
  }
}

export function getDisplayMs(timer, now, settings = DEFAULT_SETTINGS) {
  const synced = sanitizeTimerState(timer, settings);
  if (synced.status === TIMER_STATUSES.running && typeof synced.endsAt === "number") {
    return Math.max(0, synced.endsAt - now);
  }
  if (synced.status === TIMER_STATUSES.transition && typeof synced.transitionEndsAt === "number") {
    return Math.max(0, synced.transitionEndsAt - now);
  }
  return Math.max(0, synced.remainingMs || getModeDurationMs(synced.mode, settings));
}

export function getProgress(timer, now, settings = DEFAULT_SETTINGS) {
  const synced = sanitizeTimerState(timer, settings);
  if (synced.status === TIMER_STATUSES.transition) {
    const remaining = getDisplayMs(synced, now, settings);
    return 1 - remaining / TRANSITION_MS;
  }

  const duration = getModeDurationMs(synced.mode, settings);
  const remaining = getDisplayMs(synced, now, settings);
  return duration === 0 ? 0 : 1 - remaining / duration;
}

export function getTimerPresentation(timer, now, settings = DEFAULT_SETTINGS) {
  const synced = sanitizeTimerState(timer, settings);
  return {
    displayMs: getDisplayMs(synced, now, settings),
    progress: Math.min(1, Math.max(0, getProgress(synced, now, settings))),
    modeLabel: MODE_LABELS[synced.mode] || "Focus",
    upcomingLabel: synced.pendingMode ? MODE_LABELS[synced.pendingMode] || "Next session" : null,
    isTransition: synced.status === TIMER_STATUSES.transition,
    statusLabel: getStatusLabel(synced.status),
  };
}

export function syncTimer(timer, now = Date.now(), settings = DEFAULT_SETTINGS) {
  let nextTimer = sanitizeTimerState(timer, settings);
  const events = [];

  for (let guard = 0; guard < 200; guard += 1) {
    if (nextTimer.status === TIMER_STATUSES.running && typeof nextTimer.endsAt === "number" && now >= nextTimer.endsAt) {
      const completedMode = nextTimer.mode;
      const pendingMode = completedMode === MODES.focus ? nextTimer.nextBreakMode : MODES.focus;
      const transitionEndsAt = nextTimer.endsAt + TRANSITION_MS;

      if (completedMode === MODES.focus) {
        nextTimer.sessionsCompleted += 1;
      }

      nextTimer.status = TIMER_STATUSES.transition;
      nextTimer.remainingMs = 0;
      nextTimer.pendingMode = pendingMode;
      nextTimer.transitionEndsAt = transitionEndsAt;
      nextTimer.transitionFromMode = completedMode;
      nextTimer.startedAt = null;
      nextTimer.endsAt = null;
      nextTimer.updatedAt = transitionEndsAt;

      events.push({
        type: "transition-started",
        manual: false,
        fromMode: completedMode,
        toMode: pendingMode,
        at: transitionEndsAt - TRANSITION_MS,
      });
      continue;
    }

    if (
      nextTimer.status === TIMER_STATUSES.transition &&
      typeof nextTimer.transitionEndsAt === "number" &&
      now >= nextTimer.transitionEndsAt
    ) {
      const nextMode = nextTimer.pendingMode || MODES.focus;
      const sessionStartAt = nextTimer.transitionEndsAt;

      nextTimer.mode = nextMode;
      nextTimer.status = TIMER_STATUSES.running;
      nextTimer.remainingMs = getModeDurationMs(nextMode, settings);
      nextTimer.startedAt = sessionStartAt;
      nextTimer.endsAt = sessionStartAt + nextTimer.remainingMs;
      nextTimer.pendingMode = null;
      nextTimer.transitionEndsAt = null;
      nextTimer.transitionFromMode = null;
      nextTimer.updatedAt = sessionStartAt;

      events.push({
        type: "session-started",
        mode: nextMode,
        at: sessionStartAt,
      });
      continue;
    }

    break;
  }

  return { timer: nextTimer, events };
}

export function startTimer(timer, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const { timer: synced, events } = syncTimer(timer, now, settings);
  if (synced.status === TIMER_STATUSES.running || synced.status === TIMER_STATUSES.transition) {
    return { timer: synced, events };
  }

  return {
    timer: {
      ...synced,
      status: TIMER_STATUSES.running,
      endsAt: now + Math.max(1000, synced.remainingMs),
      startedAt: now,
      updatedAt: now,
    },
    events,
  };
}

export function pauseTimer(timer, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const { timer: synced, events } = syncTimer(timer, now, settings);
  if (synced.status !== TIMER_STATUSES.running || typeof synced.endsAt !== "number") {
    return { timer: synced, events };
  }

  return {
    timer: {
      ...synced,
      status: TIMER_STATUSES.paused,
      remainingMs: Math.max(0, synced.endsAt - now),
      endsAt: null,
      startedAt: null,
      updatedAt: now,
    },
    events,
  };
}

export function resumeTimer(timer, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const { timer: synced, events } = syncTimer(timer, now, settings);
  if (synced.status !== TIMER_STATUSES.paused) {
    return { timer: synced, events };
  }

  return {
    timer: {
      ...synced,
      status: TIMER_STATUSES.running,
      endsAt: now + Math.max(1000, synced.remainingMs),
      startedAt: now,
      updatedAt: now,
    },
    events,
  };
}

export function resetTimer(timer, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const synced = sanitizeTimerState(timer, settings);
  const targetMode = synced.status === TIMER_STATUSES.transition ? synced.pendingMode || synced.mode : synced.mode;
  return {
    timer: {
      ...synced,
      mode: targetMode,
      status: TIMER_STATUSES.idle,
      remainingMs: getModeDurationMs(targetMode, settings),
      endsAt: null,
      startedAt: null,
      pendingMode: null,
      transitionEndsAt: null,
      transitionFromMode: null,
      updatedAt: now,
    },
    events: [],
  };
}

export function skipTimer(timer, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const { timer: synced, events } = syncTimer(timer, now, settings);
  if (synced.status === TIMER_STATUSES.transition) {
    return { timer: synced, events };
  }

  const nextMode = synced.mode === MODES.focus ? synced.nextBreakMode : MODES.focus;
  return {
    timer: {
      ...synced,
      status: TIMER_STATUSES.transition,
      remainingMs: 0,
      endsAt: null,
      startedAt: null,
      pendingMode: nextMode,
      transitionEndsAt: now + TRANSITION_MS,
      transitionFromMode: synced.mode,
      updatedAt: now,
    },
    events: [
      ...events,
      {
        type: "transition-started",
        manual: true,
        fromMode: synced.mode,
        toMode: nextMode,
        at: now,
      },
    ],
  };
}

export function finishTimer(timer, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const synced = sanitizeTimerState(timer, settings);
  return {
    timer: {
      ...createDefaultTimerState(settings, now),
      sessionsCompleted: synced.sessionsCompleted,
      nextBreakMode: synced.nextBreakMode,
    },
    events: [{ type: "timer-finished", at: now }],
  };
}

export function setMode(timer, mode, now = Date.now(), settings = DEFAULT_SETTINGS) {
  const synced = sanitizeTimerState(timer, settings);
  if (synced.status === TIMER_STATUSES.running || synced.status === TIMER_STATUSES.transition) {
    return { timer: synced, events: [] };
  }

  return {
    timer: {
      ...synced,
      mode,
      status: TIMER_STATUSES.idle,
      remainingMs: getModeDurationMs(mode, settings),
      endsAt: null,
      startedAt: null,
      pendingMode: null,
      transitionEndsAt: null,
      transitionFromMode: null,
      updatedAt: now,
    },
    events: [],
  };
}

export function setNextBreakMode(timer, nextBreakMode) {
  const synced = sanitizeTimerState(timer);
  return {
    timer: {
      ...synced,
      nextBreakMode: nextBreakMode === MODES.longBreak ? MODES.longBreak : MODES.shortBreak,
    },
    events: [],
  };
}

export function sanitizeTimerState(rawTimer, settings = DEFAULT_SETTINGS) {
  const fallback = createDefaultTimerState(settings);
  if (!rawTimer || typeof rawTimer !== "object") {
    return fallback;
  }

  const mode = [MODES.focus, MODES.shortBreak, MODES.longBreak].includes(rawTimer.mode) ? rawTimer.mode : fallback.mode;
  const status = Object.values(TIMER_STATUSES).includes(rawTimer.status) ? rawTimer.status : fallback.status;
  const nextBreakMode =
    rawTimer.nextBreakMode === MODES.longBreak || rawTimer.nextBreakMode === MODES.shortBreak
      ? rawTimer.nextBreakMode
      : fallback.nextBreakMode;
  const durationMs = getModeDurationMs(mode, settings);

  return {
    mode,
    status,
    remainingMs: Number.isFinite(rawTimer.remainingMs) ? Math.max(0, rawTimer.remainingMs) : durationMs,
    endsAt: Number.isFinite(rawTimer.endsAt) ? rawTimer.endsAt : null,
    startedAt: Number.isFinite(rawTimer.startedAt) ? rawTimer.startedAt : null,
    pendingMode:
      rawTimer.pendingMode === MODES.focus || rawTimer.pendingMode === MODES.shortBreak || rawTimer.pendingMode === MODES.longBreak
        ? rawTimer.pendingMode
        : null,
    transitionEndsAt: Number.isFinite(rawTimer.transitionEndsAt) ? rawTimer.transitionEndsAt : null,
    transitionFromMode:
      rawTimer.transitionFromMode === MODES.focus ||
      rawTimer.transitionFromMode === MODES.shortBreak ||
      rawTimer.transitionFromMode === MODES.longBreak
        ? rawTimer.transitionFromMode
        : null,
    sessionsCompleted: Number.isFinite(rawTimer.sessionsCompleted) ? Math.max(0, Math.floor(rawTimer.sessionsCompleted)) : 0,
    nextBreakMode,
    updatedAt: Number.isFinite(rawTimer.updatedAt) ? rawTimer.updatedAt : fallback.updatedAt,
  };
}

export function getStatusLabel(status) {
  switch (status) {
    case TIMER_STATUSES.running:
      return "Running";
    case TIMER_STATUSES.paused:
      return "Paused";
    case TIMER_STATUSES.transition:
      return "Changing";
    case TIMER_STATUSES.idle:
    default:
      return "Idle";
  }
}
