# Pomodoro Flow

Pomodoro Flow is a SoundCloud-first Pomodoro web app built with a thin Flask shell and browser-owned product logic. The timer is the hero, tasks stay lightweight, theme and settings persist in `localStorage`, and the official SoundCloud widget handles playback during focus and break sessions.

## Product shape

- Large central Pomodoro timer with focus, short break, and long break modes
- Timestamp-driven timer engine that survives refreshes and background tabs
- Five-second transition countdown between automatic session changes
- Lightweight task list with one active task
- SoundCloud track or playlist URL loading through the official widget API
- Timer-controlled playback:
  - focus starts -> play
  - breaks start -> pause
  - later focus sessions -> resume when appropriate
- Local persistence for settings, timer state, tasks, theme, and the selected SoundCloud source

## Tech stack

- Flask for page serving and `/api/health`
- Vanilla JavaScript modules for timer, tasks, storage, notifications, theme, and SoundCloud control
- No database
- No authentication
- No queue backend

## Local setup

1. Create a virtual environment and install Python dependencies:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

2. Run the Flask app:

```bash
python app.py
```

3. Open `http://127.0.0.1:5000`.

## Frontend tests

Run the Flask route tests:

```bash
pytest
```

Run the browser-module tests:

```bash
npm run test:frontend
```

The Node tests cover the timer engine, storage sanitization, and SoundCloud controller helpers. They do not attempt to browser-test the live SoundCloud network widget.

## SoundCloud-first behavior

- Paste a SoundCloud track URL or playlist URL on the home page.
- The app loads the official SoundCloud widget embed in a compact panel.
- The timer remains fully usable even when no media is loaded.
- The app does not rip, proxy, extract, or download SoundCloud audio.
- V1 is intentionally SoundCloud-first. There is no YouTube workflow in the main web app.

## Autoplay caveat

Modern browsers sometimes block autoplay inside embedded players, especially after a reload. Pomodoro Flow restores the saved SoundCloud source when possible and shows a clear status message if playback needs one manual click first:

`Browser blocked autoplay. Press play once and future timer control will work better.`

## Persistence model

Everything is stored locally in the browser with `localStorage`:

- Timer state
- Settings
- Tasks
- Theme
- Current SoundCloud URL
- Media title and playback-related state

No database is required for local use or for deployment.

## Render deployment

This repo includes a `render.yaml` for a simple Flask deployment.

Render uses:

- `pip install -r requirements.txt`
- `gunicorn app:app`

Only `SECRET_KEY` is configured as an environment variable by default because the app does not need a media API backend.

## Project structure

```text
app.py
app/
  __init__.py
  config.py
  routes/
    __init__.py
    api.py
    pages.py
  static/
    css/
      styles.css
    js/
      config.js
      home.js
      notifications.js
      settings.js
      soundcloud-controller.js
      storage.js
      theme.js
      timer-engine.js
  templates/
    base.html
    home.html
    settings.html
tests/
  conftest.py
  test_routes.py
  js/
    soundcloud-controller.test.js
    storage.test.js
    timer-engine.test.js
README.md
EXPLANATION.md
FutureImprovement.txt
requirements.txt
package.json
render.yaml
runtime.txt
```
