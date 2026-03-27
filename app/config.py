import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    APP_NAME = "Pomodoro Flow"
    APP_TAGLINE = "A SoundCloud-first Pomodoro workspace with frontend-owned state."
    JSON_SORT_KEYS = False
    TEMPLATES_AUTO_RELOAD = True
