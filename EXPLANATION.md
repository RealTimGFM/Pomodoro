# Architecture and Logic Notes

## Product shape

This project is designed as a local-first productivity app, not a demo toy. The app keeps the Pomodoro timer as the primary surface and treats YouTube as a supporting feature that can be absent without breaking the main workflow.

## Backend structure

- `app/__init__.py`
  Creates the Flask app, registers blueprints, and applies basic response security headers.
- `app/routes/pages.py`
  Serves the Home and Settings pages.
- `app/routes/api.py`
  Serves lightweight JSON endpoints for health checks, YouTube search, and pasted-media resolution.
- `app/services/validators.py`
  Holds reusable input validation helpers for query handling.
- `app/services/youtube.py`
  Owns YouTube URL parsing, optional metadata lookup, and search integration with the YouTube Data API.

The backend stays intentionally small because there is no server-side user state in this version.

## Frontend structure

- `app/static/js/config.js`
  Shared constants and defaults.
- `app/static/js/timer-engine.js`
  Pure session-flow logic: start, pause, resume, reset, skip, finish, and time-based catch-up.
- `app/static/js/storage.js`
  `localStorage` serialization, sanitization, and default-state helpers.
- `app/static/js/media-controller.js`
  Wrapper around the YouTube IFrame API for loading, pausing, resuming, snapshotting, and volume updates.
- `app/static/js/notifications.js`
  Browser notification and sound helpers.
- `app/static/js/home.js`
  UI orchestration for the dashboard.
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
- reopening the browser can recover the correct phase as far as the browser can realistically know

## Session-transition design

Every automatic session boundary uses a 5-second transition state.

Flow example:

1. Focus ends.
2. The app enters a `transition` state for 5 seconds.
3. A notification sound/browser notification is triggered if enabled.
4. Break mode begins.

The same model is reused for break-to-focus transitions. Manual skip also uses the same transition state so the UX stays consistent, while media side effects wait until the next session actually starts.

## Why long breaks work without a "4 sessions" rule

This version intentionally avoids the standard "every fourth session" rule. Instead, the user sets the next break type directly on the Home screen:

- short break
- long break

That keeps the behavior explicit and matches the product requirement without inventing hidden rules.

## Task model

Tasks are intentionally lightweight:

- add
- mark done
- remove
- choose one active task

There is no database and no project hierarchy in v1. The active task is surfaced near the timer so the timer always has clear context.

## YouTube integration approach

Two different media paths are supported:

1. Paste a YouTube URL
2. Search YouTube inside the app

### Pasted URLs

Pasted links are validated by the Flask backend so only accepted YouTube video or playlist links are used.

### Search

Search uses the YouTube Data API only when `YOUTUBE_API_KEY` is configured. If the key is missing:

- the timer still works
- pasted links still work
- search fails gracefully with a clear message

This keeps search optional infrastructure, not a single point of failure.

## Media behavior decisions

- Single videos are configured to loop, which naturally covers the "shorter than the focus session" requirement.
- Music is paused on break start and resumed on focus start from the last known snapshot when practical.
- Skip does not change playback at click time; playback changes happen when the next session actually begins.
- The app stores realistic playback metadata such as current time, current title, playlist index, source metadata, and volume.

## Local persistence model

Persisted client-side state includes:

- timer/session state
- remaining time or deadline timestamps
- current mode
- next break preference
- session counter
- tasks
- active task
- selected media
- playback snapshot
- settings
- theme preference

Because storage is local to the browser, the app is stateless on the server and easy to deploy.

## Validation and security

This version uses simple but real safeguards:

- backend query validation for YouTube search
- backend validation for pasted YouTube URLs
- security response headers in Flask
- no hardcoded API keys
- optional `.env` loading
- no server-side persistence

## Testing approach

Python tests cover:

- Flask routes
- API behavior
- validation helpers
- YouTube URL parsing/search service behavior

JavaScript tests cover:

- timer/session engine behavior
- localStorage/state sanitization behavior

That split keeps the important logic testable without introducing a large frontend framework.
