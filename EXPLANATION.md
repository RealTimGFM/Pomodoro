# Architecture Explanation

## Overview

Pomodoro Flow uses Flask as a very thin shell and pushes real product behavior into browser JavaScript. The backend only renders pages, serves static assets, and exposes a tiny health endpoint. The app intentionally avoids a database, authentication, or any media-resolving backend.

## Why Flask stays thin

Flask is responsible for:

- serving the home page
- serving the settings page
- serving static CSS and JS
- returning `/api/health`

Flask is not responsible for:

- timer state
- task state
- theme state
- settings persistence
- SoundCloud URL resolution
- playback commands

That keeps deployment simple and keeps the repo aligned with a frontend-first product architecture.

## Browser-owned state

The browser owns:

- the timer engine
- local persistence
- SoundCloud widget control
- tasks
- theme
- settings
- notifications
- UI status messages

The main state shape lives in `localStorage` and includes timer, tasks, active task, and media state. Settings are stored separately so they can be shared cleanly between pages.

## Timer reliability

The timer uses a timestamp-based model rather than trusting `setInterval` alone.

Important pieces:

- `endsAt` stores the absolute target timestamp for the current session
- `transitionEndsAt` stores the absolute target timestamp for the five-second transition countdown
- `syncTimer()` recalculates the real timer state from `Date.now()`

That means the UI can recover cleanly after:

- a page refresh
- the browser tab going into the background
- interval throttling
- short periods of inactivity

The interval is only there to repaint the UI. Timestamps are the source of truth.

## SoundCloud playback layer

`soundcloud-controller.js` wraps the official SoundCloud Widget API in browser JavaScript.

It handles:

- widget script loading
- compact embed URL generation
- widget readiness
- play and pause commands
- next and previous support when playlists expose navigation
- volume updates
- state snapshots for persistence and UI sync

The app uses only the official widget embed for playback. It does not attempt to extract stream URLs or build a custom SoundCloud player backend.

## Timer and media coordination

The home page coordinates timer events and media events.

Rules implemented in the browser:

- focus starts can trigger play or resume
- breaks pause SoundCloud
- manual pause during focus disables automatic resume
- manual play during focus enables automatic resume
- playlist navigation stays secondary to the timer

If the SoundCloud source finishes and another playlist item is available, the app moves forward. If not, the timer continues running and the media stays stopped.

## Autoplay limitations

Autoplay can fail after reload because browsers often require a prior user gesture for embedded audio. That is expected. The app restores the saved SoundCloud source anyway and surfaces a clear message so the user understands why sound did not begin automatically.

This is a browser policy constraint, not a timer bug.

## Testing strategy

Python tests cover:

- home page
- settings page
- `/api/health`

Node tests cover:

- timer engine behavior
- storage sanitization
- SoundCloud helper logic

The live SoundCloud widget is not browser-tested in CI because that would turn a clean unit test suite into a fragile network-coupled integration suite.
