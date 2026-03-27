from flask import Blueprint, render_template

pages_bp = Blueprint("pages", __name__)


def _template_context(page_name: str) -> dict:
    return {"page_name": page_name}


@pages_bp.get("/")
def home():
    return render_template("home.html", **_template_context("home"))


@pages_bp.get("/settings")
def settings():
    return render_template("settings.html", **_template_context("settings"))
