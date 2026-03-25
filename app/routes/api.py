from flask import Blueprint, current_app, jsonify, request

from app.services.validators import clamp_requested_results, validate_search_query
from app.services.youtube import YouTubeServiceError, resolve_media_input, search_youtube

api_bp = Blueprint("api", __name__, url_prefix="/api")


@api_bp.get("/health")
def health():
    return jsonify({"status": "ok", "service": "pomodoro"})


@api_bp.get("/youtube/search")
def youtube_search():
    validation = validate_search_query(request.args.get("q", ""))
    if not validation.valid:
        return jsonify({"available": False, "results": [], "message": validation.message}), 400

    api_key = current_app.config.get("YOUTUBE_API_KEY", "")
    if not api_key:
        return jsonify(
            {
                "available": False,
                "results": [],
                "message": "YouTube search is disabled until YOUTUBE_API_KEY is configured. You can still paste a YouTube URL.",
            }
        )

    max_results = clamp_requested_results(request.args.get("limit"))

    try:
        results = search_youtube(validation.value, api_key=api_key, max_results=max_results)
    except YouTubeServiceError as exc:
        return jsonify({"available": False, "results": [], "message": str(exc)}), 502

    return jsonify({"available": True, "results": results, "message": None})


@api_bp.get("/media/resolve")
def resolve_media():
    raw_url = request.args.get("url", "")
    media = resolve_media_input(raw_url, api_key=current_app.config.get("YOUTUBE_API_KEY", ""))

    if media is None:
        return jsonify({"ok": False, "error": "Enter a valid YouTube video or playlist URL."}), 400

    return jsonify({"ok": True, "media": media})
