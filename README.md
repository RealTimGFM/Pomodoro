# Pomodoro Flow

Pomodoro Flow is a static Pomodoro + SoundCloud web app built with plain HTML, CSS, and vanilla JavaScript. The root app is the source of truth, GitHub Pages is the main deployment target, and no backend is required.

## Features

- Timer-first home screen with focus, short break, and long break modes
- Timestamp-based timer engine that stays accurate across refreshes and background tabs
- SoundCloud music drawer with official widget playback, URL loading, volume, and playlist navigation when available
- Task drawer with active task support, edit, delete, mark done, and drag-and-drop reorder
- Full settings page for durations, notifications, and default volume
- Dark-first theme with polished light mode
- First-run onboarding and accessible toast feedback
- Local-first persistence across pages

## Project Structure

```text
index.html
settings.html
assets/
  css/
    styles.css
  icons/
    favicon.svg
  js/
    config.js
    drag-sort.js
    drawers.js
    home.js
    notifications.js
    onboarding.js
    settings.js
    soundcloud-controller.js
    storage.js
    theme.js
    timer-engine.js
    toast-ui.js
tests/
  js/
    soundcloud-controller.test.js
    storage.test.js
    timer-engine.test.js
package.json
README.md
```

## Local Preview

Use any simple static server from the repo root.

```bash
python -m http.server 8000
```

Then open `http://127.0.0.1:8000`.

If you prefer npm scripts:

```bash
npm run preview
```

## Frontend Tests

Run the frontend test suite with:

```bash
npm test
```

That runs the vanilla JS tests in `tests/js` for:

- timer engine behavior
- storage sanitization and persistence helpers
- SoundCloud URL and embed helpers

## GitHub Pages Deployment

1. Push the repo to GitHub.
2. Open `Settings -> Pages`.
3. Choose `Deploy from a branch`.
4. Select your main branch and `/ (root)`.
5. Save.

GitHub Pages will publish `index.html` from the repo root, and all asset links are already relative for static hosting.

## localStorage

Pomodoro Flow stores everything locally in the browser:

- timer state
- settings
- tasks and active task
- theme choice
- drawer UI state
- onboarding completion
- current SoundCloud URL and playback-related state

No server, database, or account system is involved.

## Notes

- The app uses the official SoundCloud widget in the browser.
- The timer still works fully without music loaded.
- Browser autoplay policies can block restored playback after reload; pressing play once re-enables timer-led control more reliably.
