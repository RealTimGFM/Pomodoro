def test_home_route_renders_dashboard(client):
    response = client.get("/")

    assert response.status_code == 200
    assert b"Pomodoro Flow" in response.data
    assert b'id="time-display"' in response.data


def test_settings_route_renders_preferences(client):
    response = client.get("/settings")

    assert response.status_code == 200
    assert b"Make the timer fit your actual routine" in response.data


def test_health_route_returns_ok(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.get_json() == {"status": "ok", "service": "pomodoro"}


def test_youtube_search_endpoint_is_removed(client):
    response = client.get("/api/youtube/search?q=study music")

    assert response.status_code == 404


def test_media_resolve_accepts_valid_youtube_video_url(client):
    response = client.get("/api/media/resolve?url=https://youtu.be/dQw4w9WgXcQ")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["media"]["provider"] == "youtube"
    assert payload["media"]["mediaType"] == "youtube_video"
    assert payload["media"]["sourceId"] == "dQw4w9WgXcQ"


def test_media_resolve_prefers_video_for_watch_urls_with_playlist_context(client):
    response = client.get("/api/media/resolve?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890A&index=13")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["media"]["mediaType"] == "youtube_video"
    assert payload["media"]["sourceId"] == "dQw4w9WgXcQ"


def test_media_resolve_accepts_valid_youtube_playlist_url(client):
    response = client.get("/api/media/resolve?url=https://www.youtube.com/playlist?list=PL1234567890A")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["media"]["mediaType"] == "youtube_playlist"
    assert payload["media"]["sourceId"] == "PL1234567890A"


def test_media_resolve_rejects_unembeddable_video_when_api_key_is_present(client, monkeypatch):
    client.application.config["YOUTUBE_API_KEY"] = "test-key"

    def fake_fetch_json(url, *, params):
        return {
            "items": [
                {
                    "id": "dQw4w9WgXcQ",
                    "status": {"embeddable": False},
                    "snippet": {"title": "Blocked video", "channelTitle": "Blocked channel"},
                }
            ]
        }

    monkeypatch.setattr("app.services.youtube._fetch_json", fake_fetch_json)

    response = client.get("/api/media/resolve?url=https://youtu.be/dQw4w9WgXcQ")
    payload = response.get_json()

    assert response.status_code == 400
    assert payload["ok"] is False
    assert payload["error"] == "That YouTube video cannot be embedded in this app."


def test_media_resolve_prefilters_playlist_to_first_embeddable_video_when_api_key_is_present(client, monkeypatch):
    client.application.config["YOUTUBE_API_KEY"] = "test-key"

    def fake_fetch_json(url, *, params):
        if "playlistItems" in url:
            return {
                "items": [
                    {"snippet": {"resourceId": {"videoId": "M7lc1UVf-VE"}}},
                    {"snippet": {"resourceId": {"videoId": "dQw4w9WgXcQ"}}},
                    {"snippet": {"resourceId": {"videoId": "3JZ_D3ELwOQ"}}},
                ]
            }

        return {
            "items": [
                {
                    "id": "dQw4w9WgXcQ",
                    "status": {"embeddable": False},
                    "snippet": {"title": "Blocked video", "channelTitle": "Blocked channel"},
                },
                {
                    "id": "3JZ_D3ELwOQ",
                    "status": {"embeddable": True},
                    "snippet": {"title": "Playable video", "channelTitle": "Open channel"},
                },
            ]
        }

    monkeypatch.setattr("app.services.youtube._fetch_json", fake_fetch_json)

    response = client.get("/api/media/resolve?url=https://www.youtube.com/playlist?list=PL1234567890A&index=2")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["media"]["mediaType"] == "youtube_playlist"
    assert payload["media"]["playlistIndex"] == 2
    assert payload["media"]["currentVideoId"] == "3JZ_D3ELwOQ"


def test_media_resolve_rejects_invalid_non_youtube_url(client):
    response = client.get("/api/media/resolve?url=https://example.com/not-a-track")
    payload = response.get_json()

    assert response.status_code == 400
    assert payload["ok"] is False
