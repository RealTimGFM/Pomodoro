from app.services.validators import clamp_requested_results, validate_search_query


def test_validate_search_query_trims_valid_input():
    result = validate_search_query("  deep work  ")

    assert result.valid is True
    assert result.value == "deep work"


def test_validate_search_query_requires_content():
    result = validate_search_query("   ")

    assert result.valid is False
    assert result.message == "Enter a search term to find YouTube videos or playlists."


def test_clamp_requested_results_enforces_bounds():
    assert clamp_requested_results("20") == 12
    assert clamp_requested_results("-1") == 1
    assert clamp_requested_results("bad") == 8
