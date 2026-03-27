# Pomodoro Flow

Pomodoro Flow is a polished Flask + vanilla JavaScript Pomodoro app built for real daily use and portfolio presentation. The timer is the center of the product; background audio is an optional focus aid. Everything persists locally in the browser with `localStorage` — there is no database and no account system.

## Highlights

- Reliable Pomodoro flow with focus, short break, and long break modes
- Large central timer with session counter, current mode, active task, and now-playing summary
- 5-second countdown before every automatic session transition
- Background-tab and refresh-safe timer behavior using persisted timestamps
- Lightweight task list with one active task
- Background audio via local file upload or direct audio URL (.mp3, .wav, .ogg, .m4a, .webm)
- Audio loops during focus sessions, pauses on break, resumes on focus
- Direct audio URLs are restored after refresh; local files require reselection (browser limitation)
- Sound notifications and browser notifications when permission is available
- Light and dark theme support
- Local-first persistence with graceful recovery after browser reopen
- Render-ready deployment config

## Stack

- Backend: Flask
- Frontend: plain JavaScript, HTML, CSS
- Persistence: browser `localStorage`
- Testing: `pytest` for Flask routes and `node:test` for browser-state modules

## Project structure

```text
.
|-- app.py
|-- app/
|   |-- __init__.py
|   |-- config.py
|   |-- routes/
|   |-- static/
|   |   |-- css/
|   `-- js/
|   `-- templates/
|-- tests/
|   |-- js/
|   |-- conftest.py
|   |-- test_routes.py
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

Create a `.env` file in the project root:

```env
SECRET_KEY=change-me
```

`SECRET_KEY` is optional locally — the app falls back to a development default.

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

These use Node's built-in test runner — no npm install required.

```bash
npm run test:frontend
```

## Audio support

The app accepts two audio source types:

1. **Direct audio URL** — paste a link ending in `.mp3`, `.wav`, `.ogg`, `.m4a`, `.webm`, or similar. The URL is validated in the browser and persisted across refreshes.
2. **Local file upload** — select any audio file from your device. The file plays immediately but cannot be silently restored after a page refresh (browser limitation). The app shows a clear prompt to reselect it.

Audio behavior:
- Audio loops during focus sessions by default.
- Audio pauses automatically when a break starts.
- Audio resumes automatically when the next focus session starts, if it was playing before the break.
- If the user manually pauses audio during focus, it will not force-resume on the next cycle.
- The timer works fully with no audio selected.

## Deployment on Render

This repo includes `render.yaml` for a Render web service.

### Render steps

1. Push the project to GitHub.
2. Create a new Render Blueprint deployment or a new Web Service from the repo.
3. Confirm the service uses:
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn app:app`
4. Deploy.

### Notes for Render

- No database is required.
- All user data stays in the browser — deployments are stateless.
- The app can be redeployed without data migration.

## Known platform limitations

- Browser notifications depend on user permission and browser support.
- Browser autoplay policy may require the user to interact with the page before audio plays automatically for the first time.
- Local audio files cannot be restored after a page refresh — the app shows a clear message and prompts reselection.
- When the browser is fully closed, audio stops. The timer state and audio URL selection are restored when the app is reopened.

## Portfolio notes

- The architecture is intentionally Flask-native and ready for future API, database, or auth work.
- The timer and session logic is separated into testable browser modules.
- The audio layer is decoupled behind a controller interface, making it straightforward to add new providers later.

See `EXPLANATION.md` for the architectural walkthrough and `FutureImprovement.txt` for deferred roadmap items.
