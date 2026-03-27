from flask import Blueprint, current_app, jsonify, request

from app.services.youtube import YouTubeResolveError, resolve_media_input

api_bp = Blueprint("api", __name__, url_prefix="/api")


@api_bp.get("/health")
def health():
    return jsonify({"status": "ok", "service": "pomodoro"})


@api_bp.get("/media/resolve")
def resolve_media():
    raw_url = request.args.get("url", "")
    try:
        media = resolve_media_input(raw_url, api_key=current_app.config.get("YOUTUBE_API_KEY", ""))
    except YouTubeResolveError as exc:
        return jsonify({"ok": False, "error": str(exc)}), exc.status_code

    if media is None:
        return jsonify({"ok": False, "error": "Enter a valid YouTube video or playlist URL."}), 400

    return jsonify({"ok": True, "media": media})
