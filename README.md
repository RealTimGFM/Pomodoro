# Pomodoro Flow

Pomodoro Flow is a polished Flask + vanilla JavaScript Pomodoro app built for real daily use and portfolio presentation. The timer is the center of the product, while YouTube support is integrated as a secondary focus aid. Everything persists locally in the browser with `localStorage`; there is no database and no account system in this version.

## Highlights

- Reliable Pomodoro flow with focus, short break, and long break modes
- Large central timer with session counter, current mode, active task, and now-playing summary
- 5-second countdown before every automatic session transition
- Background-tab and refresh-safe timer behavior using persisted timestamps
- Lightweight task list with one active task
- YouTube URL loading plus optional in-app YouTube search
- Embedded YouTube player with app-level volume control
- Sound notifications and browser notifications when permission is available
- Light and dark theme support
- Local-first persistence with graceful recovery after browser reopen
- Render-ready deployment config

## Stack

- Backend: Flask
- Frontend: plain JavaScript, HTML, CSS
- Persistence: browser `localStorage`
- Testing: `pytest` for Flask/backend logic and `node:test` for browser-state modules

## Project structure

```text
.
|-- app.py
|-- app/
|   |-- __init__.py
|   |-- config.py
|   |-- routes/
|   |-- services/
|   |-- static/
|   |   |-- css/
|   |   `-- js/
|   `-- templates/
|-- tests/
|   |-- js/
|   |-- conftest.py
|   |-- test_routes.py
|   |-- test_validators.py
|   `-- test_youtube_service.py
|-- README.md
|-- EXPLANATION.md
|-- FutureImprovement.txt
|-- requirements.txt
|-- package.json
`-- render.yaml
```

## Local setup

### 1. Create and activate a virtual environment

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

macOS / Linux:

```bash
python -m venv .venv
source .venv/bin/activate
```

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3. Optional: configure environment variables

Copy `.env.example` to `.env` and set values as needed.

```env
SECRET_KEY=change-me
YOUTUBE_API_KEY=
```

`YOUTUBE_API_KEY` is optional.

- If it is configured, in-app YouTube search works.
- If it is not configured, the app still works fully for timer/tasks and still accepts pasted YouTube links.

### 4. Run the app

```bash
python app.py
```

Open `http://127.0.0.1:5000`.

## Tests

### Backend and Flask tests

```bash
pytest
```

### Frontend logic tests

These use Node's built-in test runner, so no npm install is required.

```bash
npm run test:frontend
```

If Node is not installed locally, the Python tests still cover the Flask routes, validation, and YouTube parsing logic.

## YouTube search setup

The app uses the YouTube Data API for search and optional metadata lookup.

1. Create a YouTube Data API key in Google Cloud.
2. Set `YOUTUBE_API_KEY` in `.env`.
3. Restart the Flask server.

If the key is missing, search returns a clear message instead of breaking the rest of the product.

## Deployment on Render

This repo includes `render.yaml` for a Render web service.

### Render steps

1. Push the project to GitHub.
2. Create a new Render Blueprint deployment or a new Web Service from the repo.
3. Confirm the service uses:
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn app:app`
4. Set `YOUTUBE_API_KEY` only if you want in-app search.
5. Deploy.

### Notes for Render

- No database is required.
- All user data remains in the browser, so deployments are stateless.
- The app can be redeployed without data migration because state is stored client-side.

## Known platform limitations

- Browser notifications depend on user permission and browser support.
- Browser audio autoplay rules can require the user to click inside the embedded YouTube player once before audio can resume automatically.
- Embedded YouTube UI can be minimized only within official iframe parameters; the app does not attempt unsupported ad-blocking or UI-hiding behavior.
- When the browser is fully closed, media cannot physically continue playing in the background. The app restores the timer state and the last practical playback snapshot when reopened.

## Portfolio notes

- The architecture is intentionally Flask-native and scalable for future API, database, or auth work.
- The timer/session logic is separated into testable browser modules.
- Media search is optional infrastructure rather than a hard dependency.

See `EXPLANATION.md` for the architectural walkthrough and `FutureImprovement.txt` for deferred roadmap items.
