def test_home_route_renders_soundcloud_dashboard(client):
    response = client.get("/")

    assert response.status_code == 200
    assert b"SoundCloud-first Pomodoro app" in response.data
    assert b'id="soundcloud-widget"' in response.data


def test_settings_route_renders_preferences(client):
    response = client.get("/settings")

    assert response.status_code == 200
    assert b"Tune the timer, notifications, and SoundCloud defaults" in response.data


def test_health_route_returns_ok(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.get_json() == {"status": "ok", "service": "pomodoro-flow", "media": "soundcloud"}
