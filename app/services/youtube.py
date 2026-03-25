from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests

YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
YOUTUBE_PLAYLISTS_URL = "https://www.googleapis.com/youtube/v3/playlists"
YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}


class YouTubeServiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class ParsedYouTubeMedia:
    provider: str
    media_type: str
    source_id: str
    original_url: str
    normalized_url: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "mediaType": self.media_type,
            "sourceId": self.source_id,
            "originalUrl": self.original_url,
            "normalizedUrl": self.normalized_url,
        }


def _normalize_possible_url(raw_value: str) -> str:
    value = (raw_value or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        return value
    if value.startswith(("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be")):
        return f"https://{value}"
    return value


def _valid_video_id(candidate: str) -> bool:
    return len(candidate) == 11 and all(character.isalnum() or character in {"-", "_"} for character in candidate)


def _valid_playlist_id(candidate: str) -> bool:
    return len(candidate) >= 10 and all(character.isalnum() or character in {"-", "_"} for character in candidate)


def parse_youtube_url(raw_value: str) -> ParsedYouTubeMedia | None:
    candidate_url = _normalize_possible_url(raw_value)
    if not candidate_url:
        return None

    parsed = urlparse(candidate_url)
    host = (parsed.netloc or "").lower()
    if host not in YOUTUBE_HOSTS:
        return None

    path_parts = [segment for segment in parsed.path.split("/") if segment]
    query = parse_qs(parsed.query)

    video_id = None
    playlist_id = None

    if host.endswith("youtu.be") and path_parts:
        video_id = path_parts[0]
    elif parsed.path == "/watch":
        if "list" in query:
            playlist_id = query["list"][0]
        elif "v" in query:
            video_id = query["v"][0]
    elif parsed.path == "/playlist" and "list" in query:
        playlist_id = query["list"][0]
    elif path_parts and path_parts[0] in {"shorts", "embed", "live", "v"} and len(path_parts) > 1:
        video_id = path_parts[1]

    if playlist_id and _valid_playlist_id(playlist_id):
        return ParsedYouTubeMedia(
            provider="youtube",
            media_type="playlist",
            source_id=playlist_id,
            original_url=candidate_url,
            normalized_url=f"https://www.youtube.com/playlist?list={playlist_id}",
        )

    if video_id and _valid_video_id(video_id):
        return ParsedYouTubeMedia(
            provider="youtube",
            media_type="video",
            source_id=video_id,
            original_url=candidate_url,
            normalized_url=f"https://www.youtube.com/watch?v={video_id}",
        )

    return None


def resolve_media_input(raw_value: str, *, api_key: str = "") -> dict[str, Any] | None:
    parsed = parse_youtube_url(raw_value)
    if parsed is None:
        return None

    media = parsed.to_dict()
    metadata = fetch_media_metadata(parsed, api_key=api_key) if api_key else {}
    media.update(metadata)
    return media


def search_youtube(query: str, *, api_key: str, max_results: int = 8) -> list[dict[str, Any]]:
    params = {
        "part": "snippet",
        "maxResults": max_results,
        "q": query,
        "type": "video,playlist",
        "videoEmbeddable": "true",
        "safeSearch": "moderate",
        "key": api_key,
    }

    payload = _fetch_json(YOUTUBE_SEARCH_URL, params=params)
    results: list[dict[str, Any]] = []

    for item in payload.get("items", []):
        identifier = item.get("id", {})
        snippet = item.get("snippet", {})
        if "videoId" in identifier:
            media_type = "video"
            source_id = identifier["videoId"]
            url = f"https://www.youtube.com/watch?v={source_id}"
        elif "playlistId" in identifier:
            media_type = "playlist"
            source_id = identifier["playlistId"]
            url = f"https://www.youtube.com/playlist?list={source_id}"
        else:
            continue

        thumbnails = snippet.get("thumbnails", {})
        thumbnail_url = (
            thumbnails.get("medium", {}) or thumbnails.get("default", {}) or thumbnails.get("high", {})
        ).get("url")

        results.append(
            {
                "provider": "youtube",
                "mediaType": media_type,
                "sourceId": source_id,
                "title": snippet.get("title", "Untitled"),
                "channelTitle": snippet.get("channelTitle", ""),
                "description": snippet.get("description", ""),
                "thumbnail": thumbnail_url,
                "normalizedUrl": url,
            }
        )

    return results


def fetch_media_metadata(parsed_media: ParsedYouTubeMedia, *, api_key: str) -> dict[str, Any]:
    if parsed_media.media_type == "video":
        payload = _fetch_json(
            YOUTUBE_VIDEOS_URL,
            params={"part": "snippet,contentDetails", "id": parsed_media.source_id, "key": api_key},
        )
    else:
        payload = _fetch_json(
            YOUTUBE_PLAYLISTS_URL,
            params={"part": "snippet,contentDetails", "id": parsed_media.source_id, "key": api_key},
        )

    items = payload.get("items", [])
    if not items:
        return {}

    snippet = items[0].get("snippet", {})
    thumbnails = snippet.get("thumbnails", {})
    thumbnail_url = (thumbnails.get("medium", {}) or thumbnails.get("default", {})).get("url")

    return {
        "title": snippet.get("title"),
        "channelTitle": snippet.get("channelTitle", ""),
        "thumbnail": thumbnail_url,
    }


def _fetch_json(url: str, *, params: dict[str, Any]) -> dict[str, Any]:
    try:
        response = requests.get(url, params=params, timeout=8)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise YouTubeServiceError("The YouTube request failed. Check the API key and network access.") from exc

    payload = response.json()
    if "error" in payload:
        message = payload["error"].get("message", "The YouTube API returned an error.")
        raise YouTubeServiceError(message)
    return payload
