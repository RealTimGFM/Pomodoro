from unittest.mock import Mock

import pytest
import requests

from app.services.youtube import YouTubeServiceError, parse_youtube_url, resolve_media_input, search_youtube


@pytest.mark.parametrize(
    ("raw_url", "expected_type", "expected_id"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/playlist?list=PL1234567890A", "playlist", "PL1234567890A"),
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890A", "playlist", "PL1234567890A"),
    ],
)
def test_parse_youtube_url_supports_video_and_playlist_links(raw_url, expected_type, expected_id):
    parsed = parse_youtube_url(raw_url)

    assert parsed is not None
    assert parsed.media_type == expected_type
    assert parsed.source_id == expected_id


def test_resolve_media_input_returns_none_for_invalid_links():
    assert resolve_media_input("https://example.com/video") is None


def test_search_youtube_formats_search_results(monkeypatch):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "items": [
            {
                "id": {"videoId": "video12345A"},
                "snippet": {
                    "title": "Deep focus session",
                    "channelTitle": "Quiet Studio",
                    "description": "Instrumental only",
                    "thumbnails": {"medium": {"url": "https://i.ytimg.com/vi/video12345A/mqdefault.jpg"}},
                },
            },
            {
                "id": {"playlistId": "PL1234567890A"},
                "snippet": {
                    "title": "Study playlist",
                    "channelTitle": "Quiet Studio",
                    "description": "Loopable playlist",
                    "thumbnails": {"medium": {"url": "https://i.ytimg.com/vi/video12345A/mqdefault.jpg"}},
                },
            },
        ]
    }
    monkeypatch.setattr("app.services.youtube.requests.get", lambda *args, **kwargs: response)

    results = search_youtube("study", api_key="fake-key", max_results=2)

    assert len(results) == 2
    assert results[0]["mediaType"] == "video"
    assert results[1]["mediaType"] == "playlist"
    assert results[1]["normalizedUrl"].endswith("PL1234567890A")


def test_search_youtube_raises_service_error_on_network_failure(monkeypatch):
    def raise_error(*args, **kwargs):
        raise requests.RequestException("boom")

    monkeypatch.setattr("app.services.youtube.requests.get", raise_error)

    with pytest.raises(YouTubeServiceError):
        search_youtube("study", api_key="fake-key")
