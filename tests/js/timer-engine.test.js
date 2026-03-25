import test from "node:test";
import assert from "node:assert/strict";

import { MODES, TIMER_STATUSES } from "../../app/static/js/config.js";
import {
  createDefaultTimerState,
  pauseTimer,
  resumeTimer,
  skipTimer,
  startTimer,
  syncTimer,
} from "../../app/static/js/timer-engine.js";

const settings = {
  focusDurationMinutes: 25,
  shortBreakDurationMinutes: 5,
  longBreakDurationMinutes: 30,
  soundNotifications: true,
  browserNotifications: false,
  defaultVolume: 65,
};

test("timer advances from focus to break and back to focus with countdowns", () => {
  const startedAt = 1_000_000;
  let timer = createDefaultTimerState(settings, startedAt);

  ({ timer } = startTimer(timer, startedAt, settings));
  ({ timer } = syncTimer(timer, startedAt + 25 * 60 * 1000, settings));

  assert.equal(timer.status, TIMER_STATUSES.transition);
  assert.equal(timer.pendingMode, MODES.shortBreak);
  assert.equal(timer.sessionsCompleted, 1);

  ({ timer } = syncTimer(timer, startedAt + 25 * 60 * 1000 + 5_000, settings));
  assert.equal(timer.mode, MODES.shortBreak);
  assert.equal(timer.status, TIMER_STATUSES.running);

  ({ timer } = syncTimer(timer, startedAt + 25 * 60 * 1000 + 5_000 + 5 * 60 * 1000 + 5_000, settings));
  assert.equal(timer.mode, MODES.focus);
  assert.equal(timer.status, TIMER_STATUSES.running);
});

test("skip creates a manual transition without incrementing sessions", () => {
  const now = 50_000;
  let timer = createDefaultTimerState(settings, now);

  ({ timer } = skipTimer(timer, now, settings));

  assert.equal(timer.status, TIMER_STATUSES.transition);
  assert.equal(timer.pendingMode, MODES.shortBreak);
  assert.equal(timer.sessionsCompleted, 0);
});

test("pause and resume preserve remaining time", () => {
  const now = 200_000;
  let timer = createDefaultTimerState(settings, now);

  ({ timer } = startTimer(timer, now, settings));
  ({ timer } = pauseTimer(timer, now + 60_000, settings));
  const remainingAfterPause = timer.remainingMs;

  ({ timer } = resumeTimer(timer, now + 75_000, settings));

  assert.equal(timer.status, TIMER_STATUSES.running);
  assert.equal(timer.endsAt, now + 75_000 + remainingAfterPause);
});
