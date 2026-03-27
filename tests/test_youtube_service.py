import pytest

from app.services.youtube import (
    YOUTUBE_PLAYLIST_ITEMS_URL,
    YOUTUBE_VIDEOS_URL,
    YouTubeResolveError,
    parse_youtube_url,
    resolve_media_input,
)

VIDEO_ID_1 = "M7lc1UVf-VE"
VIDEO_ID_2 = "dQw4w9WgXcQ"
VIDEO_ID_3 = "3JZ_D3ELwOQ"
PLAYLIST_ID = "PL1234567890A"


@pytest.mark.parametrize(
    ("raw_url", "expected_type", "expected_id"),
    [
        (f"https://www.youtube.com/watch?v={VIDEO_ID_1}", "youtube_video", VIDEO_ID_1),
        (f"https://www.youtube.com/watch?v={VIDEO_ID_1}&list={PLAYLIST_ID}&index=13", "youtube_video", VIDEO_ID_1),
        (f"youtube.com/watch?list={PLAYLIST_ID}", "youtube_playlist", PLAYLIST_ID),
        (f"https://youtu.be/{VIDEO_ID_1}", "youtube_video", VIDEO_ID_1),
        (f"https://www.youtube.com/shorts/{VIDEO_ID_1}", "youtube_video", VIDEO_ID_1),
        (f"https://www.youtube.com/playlist?list={PLAYLIST_ID}", "youtube_playlist", PLAYLIST_ID),
    ],
)
def test_parse_youtube_url_supports_video_and_playlist_links(raw_url, expected_type, expected_id):
    parsed = parse_youtube_url(raw_url)

    assert parsed is not None
    assert parsed.media_type == expected_type
    assert parsed.source_id == expected_id


def test_parse_youtube_url_normalizes_playlist_index_to_zero_based():
    parsed = parse_youtube_url(f"https://www.youtube.com/playlist?list={PLAYLIST_ID}&index=3")

    assert parsed is not None
    assert parsed.media_type == "youtube_playlist"
    assert parsed.requested_index == 2


def test_resolve_media_input_returns_none_for_invalid_links():
    assert resolve_media_input("https://example.com/video") is None


def test_resolve_media_input_returns_normalized_media_payload_without_api_key():
    media = resolve_media_input(f"https://youtu.be/{VIDEO_ID_1}")

    assert media is not None
    assert media["provider"] == "youtube"
    assert media["mediaType"] == "youtube_video"
    assert media["sourceUrl"] == f"https://www.youtube.com/watch?v={VIDEO_ID_1}"


def test_resolve_media_input_validates_embeddable_video_when_api_key_is_present(monkeypatch):
    def fake_fetch_json(url, *, params):
        assert url == YOUTUBE_VIDEOS_URL
        assert params["id"] == VIDEO_ID_1
        return {
            "items": [
                {
                    "id": VIDEO_ID_1,
                    "status": {"embeddable": True},
                    "snippet": {"title": "Focus Track", "channelTitle": "Calm Channel"},
                }
            ]
        }

    monkeypatch.setattr("app.services.youtube._fetch_json", fake_fetch_json)

    media = resolve_media_input(f"https://youtu.be/{VIDEO_ID_1}", api_key="test-key")

    assert media is not None
    assert media["mediaType"] == "youtube_video"
    assert media["title"] == "Focus Track"
    assert media["channelTitle"] == "Calm Channel"
    assert media["currentVideoId"] == VIDEO_ID_1


def test_resolve_media_input_rejects_unembeddable_video_when_api_key_is_present(monkeypatch):
    def fake_fetch_json(url, *, params):
        assert url == YOUTUBE_VIDEOS_URL
        return {
            "items": [
                {
                    "id": VIDEO_ID_1,
                    "status": {"embeddable": False},
                    "snippet": {"title": "Blocked Video", "channelTitle": "Blocked Channel"},
                }
            ]
        }

    monkeypatch.setattr("app.services.youtube._fetch_json", fake_fetch_json)

    with pytest.raises(YouTubeResolveError, match="cannot be embedded"):
        resolve_media_input(f"https://youtu.be/{VIDEO_ID_1}", api_key="test-key")


def test_resolve_media_input_chooses_first_embeddable_playlist_video_from_requested_index(monkeypatch):
    def fake_fetch_json(url, *, params):
        if url == YOUTUBE_PLAYLIST_ITEMS_URL:
            return {
                "items": [
                    {"snippet": {"resourceId": {"videoId": VIDEO_ID_1}}},
                    {"snippet": {"resourceId": {"videoId": VIDEO_ID_2}}},
                    {"snippet": {"resourceId": {"videoId": VIDEO_ID_3}}},
                ]
            }

        if url == YOUTUBE_VIDEOS_URL:
            assert params["id"] == f"{VIDEO_ID_2},{VIDEO_ID_3}"
            return {
                "items": [
                    {
                        "id": VIDEO_ID_2,
                        "status": {"embeddable": False},
                        "snippet": {"title": "Blocked Video", "channelTitle": "Blocked Channel"},
                    },
                    {
                        "id": VIDEO_ID_3,
                        "status": {"embeddable": True},
                        "snippet": {"title": "Playable Video", "channelTitle": "Open Channel"},
                    },
                ]
            }

        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr("app.services.youtube._fetch_json", fake_fetch_json)

    media = resolve_media_input(
        f"https://www.youtube.com/playlist?list={PLAYLIST_ID}&index=2",
        api_key="test-key",
    )

    assert media is not None
    assert media["mediaType"] == "youtube_playlist"
    assert media["playlistIndex"] == 2
    assert media["currentVideoId"] == VIDEO_ID_3
    assert media["title"] == "Playable Video"
    assert media["channelTitle"] == "Open Channel"


def test_resolve_media_input_rejects_playlist_when_no_embeddable_videos_exist(monkeypatch):
    def fake_fetch_json(url, *, params):
        if url == YOUTUBE_PLAYLIST_ITEMS_URL:
            return {
                "items": [
                    {"snippet": {"resourceId": {"videoId": VIDEO_ID_1}}},
                    {"snippet": {"resourceId": {"videoId": VIDEO_ID_2}}},
                ]
            }

        if url == YOUTUBE_VIDEOS_URL:
            return {
                "items": [
                    {
                        "id": VIDEO_ID_1,
                        "status": {"embeddable": False},
                        "snippet": {"title": "Blocked One", "channelTitle": "Blocked Channel"},
                    },
                    {
                        "id": VIDEO_ID_2,
                        "status": {"embeddable": False},
                        "snippet": {"title": "Blocked Two", "channelTitle": "Blocked Channel"},
                    },
                ]
            }

        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr("app.services.youtube._fetch_json", fake_fetch_json)

    with pytest.raises(YouTubeResolveError, match="does not contain any embeddable videos"):
        resolve_media_input(f"https://www.youtube.com/playlist?list={PLAYLIST_ID}", api_key="test-key")
