from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests

YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}
YOUTUBE_PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems"
YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"


class YouTubeResolveError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ParsedYouTubeMedia:
    media_type: str
    source_id: str
    original_url: str
    normalized_url: str
    requested_index: int = 0

    def to_dict(self) -> dict[str, Any]:
        title = (
            "YouTube playlist"
            if self.media_type == "youtube_playlist"
            else "YouTube video"
        )
        payload = {
            "provider": "youtube",
            "mediaType": self.media_type,
            "sourceId": self.source_id,
            "sourceUrl": self.normalized_url,
            "normalizedUrl": self.normalized_url,
            "originalUrl": self.original_url,
            "title": title,
            "channelTitle": "",
            "currentVideoId": (
                self.source_id if self.media_type == "youtube_video" else ""
            ),
        }
        if self.media_type == "youtube_playlist":
            payload["playlistIndex"] = self.requested_index
        return payload


def resolve_media_input(raw_value: str, *, api_key: str = "") -> dict[str, Any] | None:
    parsed = parse_youtube_url(raw_value)
    if parsed is None:
        return None

    if not api_key:
        return parsed.to_dict()

    if parsed.media_type == "youtube_video":
        return _resolve_video_media(parsed, api_key=api_key)

    return _resolve_playlist_media(parsed, api_key=api_key)


def parse_youtube_url(raw_value: str) -> ParsedYouTubeMedia | None:
    candidate_url = _normalize_possible_url(raw_value)
    if not candidate_url:
        return None

    parsed = urlparse(candidate_url)
    host = (parsed.hostname or "").lower()
    if host not in YOUTUBE_HOSTS:
        return None

    path_parts = [segment for segment in parsed.path.split("/") if segment]
    query = parse_qs(parsed.query)
    playlist_id = _get_first_query_value(query, "list")
    requested_index = _get_requested_playlist_index(query)
    video_id = None

    if host.endswith("youtu.be") and path_parts:
        video_id = path_parts[0]
    elif parsed.path == "/watch":
        video_id = _get_first_query_value(query, "v")

        # For this app, a watch URL with list=... is playlist context.
        # The user wants the music flow, not strict single-video priority.
        if _valid_playlist_id(playlist_id):
            return _build_playlist_media(
                candidate_url, playlist_id, requested_index=requested_index
            )

        if _valid_video_id(video_id):
            return _build_video_media(candidate_url, video_id)
    elif parsed.path == "/playlist":
        playlist_id = _get_first_query_value(query, "list")
    elif (
        path_parts
        and path_parts[0] in {"shorts", "embed", "live", "v"}
        and len(path_parts) > 1
    ):
        video_id = path_parts[1]

    if _valid_playlist_id(playlist_id):
        return _build_playlist_media(
            candidate_url, playlist_id, requested_index=requested_index
        )

    if _valid_video_id(video_id):
        return _build_video_media(candidate_url, video_id)

    return None


def _resolve_video_media(
    parsed_media: ParsedYouTubeMedia, *, api_key: str
) -> dict[str, Any]:
    payload = _fetch_json(
        YOUTUBE_VIDEOS_URL,
        params={
            "part": "snippet,status",
            "id": parsed_media.source_id,
            "key": api_key,
        },
    )

    items = payload.get("items", [])
    if not items:
        raise YouTubeResolveError(
            "That YouTube video was not found, was removed, or is private."
        )

    item = items[0]
    if not item.get("status", {}).get("embeddable", False):
        raise YouTubeResolveError("That YouTube video cannot be embedded in this app.")

    media = parsed_media.to_dict()
    snippet = item.get("snippet", {})
    media["title"] = snippet.get("title") or media["title"]
    media["channelTitle"] = snippet.get("channelTitle", "")
    media["currentVideoId"] = parsed_media.source_id
    return media


def _collect_embeddable_playlist_videos(
    playlist_id: str,
    *,
    requested_index: int,
    api_key: str,
    limit: int = 25,
) -> list[dict[str, Any]]:
    page_token = ""
    absolute_index = 0
    playable_items: list[dict[str, Any]] = []

    while len(playable_items) < limit:
        params = {
            "part": "snippet",
            "playlistId": playlist_id,
            "maxResults": 50,
            "key": api_key,
        }
        if page_token:
            params["pageToken"] = page_token

        payload = _fetch_json(YOUTUBE_PLAYLIST_ITEMS_URL, params=params)
        items = payload.get("items", [])

        if not items and absolute_index == 0:
            raise YouTubeResolveError("That YouTube playlist could not be loaded.")

        candidate_entries: list[tuple[int, str]] = []
        for item in items:
            item_index = absolute_index
            absolute_index += 1

            if item_index < requested_index:
                continue

            video_id = item.get("snippet", {}).get("resourceId", {}).get("videoId", "")
            if _valid_video_id(video_id):
                candidate_entries.append((item_index, video_id))

        if candidate_entries:
            payload = _fetch_json(
                YOUTUBE_VIDEOS_URL,
                params={
                    "part": "snippet,status",
                    "id": ",".join(video_id for _, video_id in candidate_entries),
                    "key": api_key,
                },
            )
            items_by_id = {
                item.get("id", ""): item for item in payload.get("items", [])
            }

            for absolute_playlist_index, video_id in candidate_entries:
                item = items_by_id.get(video_id)
                if not item:
                    continue
                if not item.get("status", {}).get("embeddable", False):
                    continue

                snippet = item.get("snippet", {})
                playable_items.append(
                    {
                        "videoId": video_id,
                        "absoluteIndex": absolute_playlist_index,
                        "title": snippet.get("title", ""),
                        "channelTitle": snippet.get("channelTitle", ""),
                    }
                )
                if len(playable_items) >= limit:
                    break

        page_token = payload.get("nextPageToken", "")
        if not page_token:
            break

    return playable_items


def _resolve_playlist_media(
    parsed_media: ParsedYouTubeMedia, *, api_key: str
) -> dict[str, Any]:
    playable_items = _collect_embeddable_playlist_videos(
        parsed_media.source_id,
        requested_index=parsed_media.requested_index,
        api_key=api_key,
        limit=25,
    )

    if not playable_items:
        raise YouTubeResolveError(
            "That YouTube playlist does not contain any embeddable videos from the requested starting point."
        )

    first_item = playable_items[0]
    media = parsed_media.to_dict()
    media["title"] = first_item["title"] or media["title"]
    media["channelTitle"] = first_item["channelTitle"]
    media["playlistIndex"] = 0
    media["currentVideoId"] = first_item["videoId"]
    media["queueVideoIds"] = [item["videoId"] for item in playable_items]
    return media


def _find_first_embeddable_playlist_video(
    candidate_entries: list[tuple[int, str]],
    *,
    api_key: str,
) -> tuple[int, dict[str, Any]] | None:
    payload = _fetch_json(
        YOUTUBE_VIDEOS_URL,
        params={
            "part": "snippet,status",
            "id": ",".join(video_id for _, video_id in candidate_entries),
            "key": api_key,
        },
    )
    items_by_id = {item.get("id", ""): item for item in payload.get("items", [])}

    for playlist_index, video_id in candidate_entries:
        item = items_by_id.get(video_id)
        if item and item.get("status", {}).get("embeddable", False):
            return playlist_index, item

    return None


def _fetch_json(url: str, *, params: dict[str, Any]) -> dict[str, Any]:
    try:
        response = requests.get(url, params=params, timeout=8)
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise YouTubeResolveError(
            "YouTube validation could not be completed right now.", status_code=502
        ) from exc

    if "error" in payload:
        message = payload["error"].get(
            "message", "YouTube validation could not be completed right now."
        )
        raise YouTubeResolveError(message, status_code=502)

    return payload


def _normalize_possible_url(raw_value: str) -> str:
    value = (raw_value or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        return value
    if value.startswith(
        (
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "music.youtube.com",
            "youtu.be",
        )
    ):
        return f"https://{value}"
    return value


def _get_first_query_value(query: dict[str, list[str]], key: str) -> str:
    values = query.get(key) or []
    return values[0].strip() if values else ""


def _get_requested_playlist_index(query: dict[str, list[str]]) -> int:
    raw_index = _get_first_query_value(query, "index")
    try:
        parsed_index = int(raw_index)
    except (TypeError, ValueError):
        return 0

    # YouTube playlist URLs expose item positions starting from 1, while the
    # embedded player and persisted local state use zero-based indices.
    return max(parsed_index - 1, 0)


def _build_video_media(original_url: str, video_id: str) -> ParsedYouTubeMedia:
    return ParsedYouTubeMedia(
        media_type="youtube_video",
        source_id=video_id,
        original_url=original_url,
        normalized_url=f"https://www.youtube.com/watch?v={video_id}",
    )


def _build_playlist_media(
    original_url: str, playlist_id: str, *, requested_index: int = 0
) -> ParsedYouTubeMedia:
    return ParsedYouTubeMedia(
        media_type="youtube_playlist",
        source_id=playlist_id,
        original_url=original_url,
        normalized_url=f"https://www.youtube.com/playlist?list={playlist_id}",
        requested_index=requested_index,
    )


def _valid_video_id(candidate: str) -> bool:
    return len(candidate) == 11 and all(
        character.isalnum() or character in {"-", "_"} for character in candidate
    )


def _valid_playlist_id(candidate: str) -> bool:
    return len(candidate) >= 10 and all(
        character.isalnum() or character in {"-", "_"} for character in candidate
    )
