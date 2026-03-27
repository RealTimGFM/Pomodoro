# Architecture and Logic Notes

## Product shape

This project is designed as a local-first productivity app, not a demo toy. The Pomodoro timer is the primary surface. Background audio is a supporting feature that can be absent without affecting the main workflow.

## Backend structure

- `app/__init__.py`
  Creates the Flask app, registers blueprints, and applies basic response security headers.
- `app/routes/pages.py`
  Serves the Home and Settings pages.
- `app/routes/api.py`
  Serves a single `/api/health` endpoint. All audio handling is client-side.

The backend stays small because there is no server-side user state. Audio URL validation is intentionally done in the browser to avoid unnecessary round-trips.

## Frontend structure

- `app/static/js/config.js`
  Shared constants and defaults.
- `app/static/js/timer-engine.js`
  Pure session-flow logic: start, pause, resume, reset, skip, finish, and time-based catch-up.
- `app/static/js/storage.js`
  `localStorage` serialization, sanitization, and default-state helpers.
- `app/static/js/media-controller.js`
  `AudioController` class wrapping `HTMLAudioElement`. Handles local file and direct URL loading, volume, looping, pause/resume, and snapshot capture.
- `app/static/js/notifications.js`
  Browser notification and sound helpers.
- `app/static/js/home.js`
  UI orchestration for the dashboard: timer, audio, and tasks.
- `app/static/js/settings.js`
  Settings-page form logic.
- `app/static/js/theme.js`
  Light/dark theme toggle behavior.

## Why the timer is reliable

The timer does not rely on `setInterval` alone for truth. Instead, it persists timestamps such as:

- current session mode
- current status
- `endsAt`
- `transitionEndsAt`
- next break preference
- completed focus session count

On every render tick and on app load, `syncTimer()` recalculates the correct state based on the current wall-clock time. That means:

- background-tab throttling does not drift the timer
- refreshes do not reset active sessions
- reopening the browser recovers the correct phase

## Session-transition design

Every automatic session boundary uses a 5-second transition state.

Flow example:

1. Focus ends.
2. The app enters a `transition` state for 5 seconds.
3. A notification sound/browser notification is triggered if enabled.
4. Break mode begins.

The same model is reused for break-to-focus transitions. Manual skip also uses the same transition state so the UX stays consistent.

## Why long breaks work without a "4 sessions" rule

This version intentionally avoids the standard "every fourth session" rule. Instead, the user sets the next break type directly on the Home screen. That keeps the behavior explicit and avoids hidden rules.

## Task model

Tasks are intentionally lightweight:

- add
- mark done
- remove
- choose one active task

There is no database and no project hierarchy. The active task is surfaced near the timer so the timer always has clear context.

## Audio integration approach

Two audio source types are supported in V1:

1. **Direct audio URL** — user pastes a link to an audio file. Validated in the browser by checking the URL protocol and file extension. Persisted to `localStorage` and restored after refresh.
2. **Local file upload** — user selects a file from their device. A `Blob URL` is created with `URL.createObjectURL()`. The Blob URL is valid only for the current page session; it cannot be restored after a page refresh. The app clears the selection on reload and shows a clear prompt to reselect.

`AudioController` wraps `HTMLAudioElement` and exposes:

- `load(selection, { autoplay, resumeState, volume })` — loads a new source, optionally seeks to a saved position and autoplays.
- `resume(resumeState)` — resumes playback, seeking if needed.
- `pause()` — pauses the element.
- `applyVolume(volume)` — updates volume (0–100 scale mapped to 0–1).
- `captureSnapshot()` — returns a plain state object with selection, title, currentTime, volume, and status.
- `clear()` — stops playback, releases the object URL if any, and resets state.

## Audio behavior decisions

- Audio loops during focus sessions by default (`el.loop = true`).
- Audio pauses when a break starts and resumes when the next focus session starts, if it was playing before the break.
- If the user manually pauses audio during a focus session, `shouldResumeOnFocus` becomes `false`, preventing unwanted forced resumes.
- If the user manually plays audio during a focus session, `shouldResumeOnFocus` becomes `true`.
- A 2-second sync loop runs while audio is playing to keep `currentTime` reasonably fresh in the persisted state.

## Local persistence model

Persisted client-side state includes:

- timer/session state
- remaining time or deadline timestamps
- current mode and next break preference
- session counter
- tasks and active task
- selected audio (URL type only — local file selections are cleared on reload)
- playback snapshot: currentTime, volume, shouldResumeOnFocus
- settings
- theme preference

Because storage is local to the browser, the server is stateless and easy to deploy.

## Validation and security

- Audio URL validation is done client-side: URL constructor check + file extension check against a known list.
- No audio content is proxied through the server.
- Security response headers are applied in Flask (Permissions-Policy, Referrer-Policy, X-Content-Type-Options, X-Frame-Options).
- No hardcoded secrets; optional `.env` loading.
- No server-side persistence.

## Testing approach

Python tests cover:

- Flask routes (home, settings, health)
- Removed YouTube endpoints returning 404

JavaScript tests cover:

- Timer/session engine behavior
- `localStorage`/state sanitization behavior
- `audio_url` selection restoration
- `local_file` selection cleared on reload

That split keeps the important logic testable without introducing a large frontend framework.
