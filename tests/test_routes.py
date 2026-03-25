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


def test_youtube_search_gracefully_handles_missing_api_key(client):
    response = client.get("/api/youtube/search?q=study music")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["available"] is False
    assert payload["results"] == []


def test_youtube_search_validates_query_length(client):
    response = client.get("/api/youtube/search?q=a")
    payload = response.get_json()

    assert response.status_code == 400
    assert payload["message"] == "Search must be at least 2 characters."


def test_media_resolve_accepts_valid_youtube_video_url(client):
    response = client.get("/api/media/resolve?url=https://youtu.be/dQw4w9WgXcQ")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["media"]["mediaType"] == "video"
    assert payload["media"]["sourceId"] == "dQw4w9WgXcQ"


def test_media_resolve_rejects_invalid_url(client):
    response = client.get("/api/media/resolve?url=https://example.com/not-youtube")
    payload = response.get_json()

    assert response.status_code == 400
    assert payload["ok"] is False
