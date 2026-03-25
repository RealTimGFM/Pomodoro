import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "").strip()
    JSON_SORT_KEYS = False
    TEMPLATES_AUTO_RELOAD = True
